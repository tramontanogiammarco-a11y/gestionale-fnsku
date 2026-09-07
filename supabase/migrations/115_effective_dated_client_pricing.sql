-- Effective-dated customer pricing keeps invoices recalculable after backdated changes.
create or replace function public.default_listino()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'fnsku', 0.10,
    'busta', 0,
    'nastratura', 0,
    'pluriball', 0,
    'bundle', 0,
    'inscatolamento', 0,
    'scatola_60', 0,
    'scatola_40', 0,
    'stoccaggio_slot', 0,
    'stoccaggio_pallet', 0,
    'entrata_pallet', 0,
    'entrata_scatola', 0,
    'sped_gls_nazionale_base', 5.90,
    'sped_gls_speciale_base', 8.90,
    'sped_gls_kg_extra', 0.65,
    'sped_brt_nazionale_base', 6.20,
    'sped_brt_speciale_base', 8.40,
    'sped_brt_kg_extra', 0.55,
    'sped_peso_volumetrico_divisore', 5000,
    'wms_order_base_fee', 0,
    'wms_extra_item_fee', 0,
    'wms_pack_scatola_piccola', 0,
    'wms_pack_scatola_media', 0,
    'wms_pack_scatola_grande', 0,
    'wms_pack_busta_corriere', 0,
    'iva', 22
  );
$$;

update public.clienti
set listino = public.default_listino() || coalesce(listino, '{}'::jsonb);

create table if not exists public.client_price_versions (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  price_key text not null check (price_key ~ '^[a-z0-9_]+$'),
  amount numeric not null check (amount >= 0),
  effective_from date not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cliente_id, price_key, effective_from)
);

create index if not exists client_price_versions_lookup_idx
  on public.client_price_versions(cliente_id, price_key, effective_from desc);

alter table public.client_price_versions enable row level security;

create policy "client_price_versions_read_own_or_staff"
on public.client_price_versions for select
using (public.owns_cliente(cliente_id));

create policy "client_price_versions_staff_write"
on public.client_price_versions for all
using (public.is_staff())
with check (public.is_staff());

grant select, insert, update, delete on public.client_price_versions to authenticated;

insert into public.client_price_versions (cliente_id, price_key, amount, effective_from)
select c.id, entry.key, (entry.value #>> '{}')::numeric, date '2000-01-01'
from public.clienti c
cross join lateral jsonb_each(public.default_listino() || coalesce(c.listino, '{}'::jsonb)) entry
where jsonb_typeof(entry.value) = 'number'
on conflict (cliente_id, price_key, effective_from) do nothing;

create or replace function public.seed_client_price_versions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.client_price_versions (cliente_id, price_key, amount, effective_from)
  select new.id, entry.key, (entry.value #>> '{}')::numeric, date '2000-01-01'
  from jsonb_each(public.default_listino() || coalesce(new.listino, '{}'::jsonb)) entry
  where jsonb_typeof(entry.value) = 'number'
  on conflict (cliente_id, price_key, effective_from) do nothing;
  return new;
end;
$$;

drop trigger if exists clienti_seed_price_versions on public.clienti;
create trigger clienti_seed_price_versions
after insert on public.clienti
for each row execute function public.seed_client_price_versions();

create or replace function public.save_client_price_version(
  p_cliente_id uuid,
  p_effective_from date,
  p_prices jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  if not exists (select 1 from public.clienti where id = p_cliente_id) then raise exception 'Cliente non trovato'; end if;
  if p_effective_from is null then raise exception 'Data di decorrenza obbligatoria'; end if;
  if jsonb_typeof(coalesce(p_prices, '{}'::jsonb)) <> 'object' then raise exception 'Formato prezzi non valido'; end if;
  if exists (
    select 1 from jsonb_each(coalesce(p_prices, '{}'::jsonb)) entry
    where entry.key !~ '^[a-z0-9_]+$'
      or jsonb_typeof(entry.value) <> 'number'
      or (entry.value #>> '{}')::numeric < 0
  ) then
    raise exception 'I prezzi devono essere numeri non negativi';
  end if;

  insert into public.client_price_versions (
    cliente_id, price_key, amount, effective_from, created_by, updated_at
  )
  select p_cliente_id, entry.key, (entry.value #>> '{}')::numeric,
    p_effective_from, auth.uid(), now()
  from jsonb_each(coalesce(p_prices, '{}'::jsonb)) entry
  on conflict (cliente_id, price_key, effective_from) do update set
    amount = excluded.amount,
    created_by = excluded.created_by,
    updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.save_client_price_version(uuid, date, jsonb) from public;
grant execute on function public.save_client_price_version(uuid, date, jsonb) to authenticated;

create or replace function public.client_price_at(
  p_cliente_id uuid,
  p_price_key text,
  p_at date,
  p_fallback numeric default 0
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_amount numeric;
begin
  if not public.owns_cliente(p_cliente_id) then raise exception 'Listino non accessibile'; end if;
  select amount into v_amount
  from public.client_price_versions
  where cliente_id = p_cliente_id
    and price_key = p_price_key
    and effective_from <= coalesce(p_at, current_date)
  order by effective_from desc
  limit 1;

  if found then return v_amount; end if;
  select coalesce((listino ->> p_price_key)::numeric, p_fallback)
  into v_amount from public.clienti where id = p_cliente_id;
  return coalesce(v_amount, p_fallback);
end;
$$;

revoke all on function public.client_price_at(uuid, text, date, numeric) from public;
grant execute on function public.client_price_at(uuid, text, date, numeric) to authenticated;

alter table public.client_carrier_rates
  add column if not exists effective_from date not null default date '2000-01-01';

drop index if exists public.client_carrier_rates_lookup_idx;
create index client_carrier_rates_lookup_idx
  on public.client_carrier_rates(cliente_id, effective_from desc, carrier, weight_from_kg, weight_to_kg);

create or replace function public.replace_client_carrier_rates(
  p_cliente_id uuid,
  p_rules jsonb,
  p_effective_from date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;
  if not exists (select 1 from public.clienti where id = p_cliente_id) then raise exception 'Cliente non trovato'; end if;
  if p_effective_from is null then raise exception 'Data di decorrenza obbligatoria'; end if;
  if jsonb_typeof(coalesce(p_rules, '[]'::jsonb)) <> 'array' then raise exception 'Formato tariffario non valido'; end if;

  delete from public.client_carrier_rates
  where cliente_id = p_cliente_id and effective_from = p_effective_from;

  insert into public.client_carrier_rates (
    cliente_id, carrier, service, zone_name, weight_from_kg, weight_to_kg,
    price, surcharge, postal_codes, provinces, priority, effective_from
  )
  select
    p_cliente_id,
    lower(rule->>'carrier'),
    coalesce(nullif(trim(rule->>'service'), ''), 'Standard 24/48h'),
    coalesce(nullif(trim(rule->>'zone_name'), ''), 'Nazionale'),
    (rule->>'weight_from_kg')::numeric,
    (rule->>'weight_to_kg')::numeric,
    (rule->>'price')::numeric,
    coalesce((rule->>'surcharge')::numeric, 0),
    case
      when lower(coalesce(rule->>'zone_name', '')) like '%disagiat%'
        and coalesce(jsonb_array_length(rule->'postal_codes'), 0) = 0
      then array(
        select postal_code from public.carrier_postal_zones
        where carrier = lower(rule->>'carrier') and zone_code = 'disagiata' and active
        order by postal_code
      )
      else coalesce(array(select jsonb_array_elements_text(rule->'postal_codes')), '{}')
    end,
    coalesce(array(select jsonb_array_elements_text(rule->'provinces')), '{}'),
    coalesce((rule->>'priority')::integer, 0),
    p_effective_from
  from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) rule;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.replace_client_carrier_rates(uuid, jsonb, date) from public;
grant execute on function public.replace_client_carrier_rates(uuid, jsonb, date) to authenticated;

create or replace function public.replace_client_carrier_rates(p_cliente_id uuid, p_rules jsonb)
returns integer
language sql
security definer
set search_path = public
as $$
  select public.replace_client_carrier_rates(p_cliente_id, p_rules, current_date);
$$;

alter table public.wms_billing_storage_months
  add column if not exists slot_quantity integer not null default 0 check (slot_quantity >= 0),
  add column if not exists slot_unit_price_snapshot numeric not null default 0 check (slot_unit_price_snapshot >= 0);

-- Operational packaging snapshots use the price currently in force.
create or replace function public.register_wms_packaging(
  p_session_ids uuid[],
  p_barcode text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_packaging public.wms_packaging_types%rowtype;
  v_count integer;
  v_now timestamptz := now();
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;

  select * into v_packaging from public.wms_packaging_types
  where upper(barcode) = upper(trim(p_barcode)) and active for update;
  if not found then raise exception 'Imballaggio non riconosciuto'; end if;

  select count(*) into v_count
  from public.wms_packing_sessions s
  where s.id = any(p_session_ids)
    and s.stato = 'in_attesa_imballaggio'
    and not exists (select 1 from public.wms_order_packaging_usage u where u.session_id = s.id);

  if v_count = 0 then raise exception 'Nessun ordine attende la scansione dell''imballaggio'; end if;
  if v_packaging.stock_quantity < v_count then
    raise exception 'Scorta insufficiente per %: disponibili %', v_packaging.name, v_packaging.stock_quantity;
  end if;

  insert into public.wms_order_packaging_usage (
    session_id, order_id, cliente_id, packaging_code,
    quantity, unit_price_snapshot, operatore_id, scanned_at
  )
  select s.id, s.order_id, o.cliente_id, v_packaging.code, 1,
    public.client_price_at(o.cliente_id, v_packaging.listino_key, v_now::date, 0),
    auth.uid(), v_now
  from public.wms_packing_sessions s
  join public.shopify_orders o on o.id = s.order_id
  where s.id = any(p_session_ids) and s.stato = 'in_attesa_imballaggio'
  on conflict (session_id) do nothing;

  update public.wms_packaging_types
  set stock_quantity = stock_quantity - v_count, updated_at = v_now
  where code = v_packaging.code;

  insert into public.wms_packaging_stock_movements (
    packaging_code, quantity_delta, reason, order_id, session_id, operatore_id, created_at
  )
  select v_packaging.code, -1, 'packing', s.order_id, s.id, auth.uid(), v_now
  from public.wms_packing_sessions s
  where s.id = any(p_session_ids) and s.stato = 'in_attesa_imballaggio';

  update public.wms_packing_sessions
  set stato = 'in_attesa_etichetta', packaging_code = v_packaging.code,
      packaging_scanned_at = v_now,
      carrier_label_code = coalesce(carrier_label_code, 'PK-' || upper(substr(replace(id::text, '-', ''), 1, 12))),
      carrier_label_printed_at = v_now, updated_at = v_now
  where id = any(p_session_ids) and stato = 'in_attesa_imballaggio';

  return v_count;
end;
$$;

grant execute on function public.register_wms_packaging(uuid[], text) to authenticated;

-- Shipping confirmation also resolves the matrix and fallback prices by current date.
create or replace function public.confirm_wms_shipping_choice(p_order_id uuid, p_carrier text)
returns public.shopify_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.shopify_orders;
  v_rate public.client_carrier_rates;
  v_actual numeric;
  v_volume numeric;
  v_divisor numeric;
  v_billable numeric;
  v_zone text;
  v_base numeric;
  v_extra numeric;
  v_price numeric;
  v_zip text;
  v_province text;
  v_now timestamptz := now();
  v_rate_date date;
begin
  p_carrier := lower(trim(coalesce(p_carrier, '')));
  if p_carrier not in ('gls', 'brt') then raise exception 'Scegli GLS oppure BRT'; end if;

  select * into v_order from public.shopify_orders where id = p_order_id;
  if not found then raise exception 'Ordine non trovato'; end if;
  if not public.owns_cliente(v_order.cliente_id) then raise exception 'Ordine non accessibile'; end if;
  if v_order.wms_status in ('in_packing', 'imballato', 'spedito', 'annullato')
    or exists (
      select 1 from public.wms_packing_sessions s
      where s.order_id = p_order_id
        and (s.started_at is not null or s.stato in ('in_corso', 'completata'))
    ) then
    raise exception 'Il packing è già iniziato: corriere e prezzo sono bloccati.';
  end if;
  if nullif(trim(coalesce(v_order.ship_zip, '')), '') is null then
    raise exception 'Inserisci il CAP di destinazione prima di calcolare la spedizione';
  end if;
  if upper(coalesce(nullif(trim(v_order.ship_country_code), ''), 'IT')) <> 'IT' then
    raise exception 'Il listino demo GLS/BRT copre per ora solo spedizioni nazionali italiane';
  end if;
  if exists (
    select 1 from public.shopify_order_items i
    left join public.referenze r on r.id = i.referenza_id
    where i.order_id = p_order_id and r.id is null
  ) then
    raise exception 'Collega tutti i prodotti dell''ordine al catalogo prima del preventivo';
  end if;

  select coalesce(sum(r.peso_kg * i.quantita), 0),
         coalesce(sum(r.lunghezza_cm * r.larghezza_cm * r.altezza_cm * i.quantita), 0)
  into v_actual, v_volume
  from public.shopify_order_items i
  join public.referenze r on r.id = i.referenza_id
  where i.order_id = p_order_id;
  if v_actual <= 0 then raise exception 'L''ordine non contiene prodotti con peso valido'; end if;

  v_divisor := greatest(1, public.client_price_at(v_order.cliente_id, 'sped_peso_volumetrico_divisore', current_date, 5000));
  v_billable := greatest(1, ceil(greatest(v_actual, v_volume / v_divisor) * 2) / 2);
  v_zip := lpad(left(regexp_replace(coalesce(v_order.ship_zip, ''), '\D', '', 'g'), 5), 5, '0');
  select coalesce(nullif(upper(trim(coalesce(v_order.ship_province, ''))), ''),
    (select province_code from public.italian_postal_codes where postal_code = v_zip limit 1), '')
  into v_province;

  select max(effective_from) into v_rate_date
  from public.client_carrier_rates
  where cliente_id = v_order.cliente_id and effective_from <= current_date;

  select rate.* into v_rate
  from public.client_carrier_rates rate
  where rate.cliente_id = v_order.cliente_id
    and rate.effective_from = v_rate_date
    and rate.carrier = p_carrier
    and v_billable between rate.weight_from_kg and rate.weight_to_kg
    and (
      (cardinality(rate.postal_codes) = 0 and cardinality(rate.provinces) = 0)
      or v_province = any(rate.provinces)
      or exists (
        select 1 from unnest(rate.postal_codes) pattern
        where (right(pattern, 1) = '*' and v_zip like rtrim(pattern, '*') || '%')
           or (right(pattern, 1) <> '*' and v_zip = pattern)
      )
    )
  order by
    case
      when v_zip = any(rate.postal_codes) then 3
      when exists (select 1 from unnest(rate.postal_codes) pattern where right(pattern, 1) = '*' and v_zip like rtrim(pattern, '*') || '%') then 2
      when v_province = any(rate.provinces) then 1
      else 0
    end desc,
    rate.priority desc,
    (rate.weight_to_kg - rate.weight_from_kg) asc,
    rate.created_at desc
  limit 1;

  if found then
    v_zone := v_rate.zone_name;
    v_price := round(v_rate.price + v_rate.surcharge, 2);
  else
    v_zone := case
      when exists (select 1 from public.carrier_postal_zones where carrier = p_carrier and postal_code = v_zip and zone_code = 'disagiata' and active) then 'speciale'
      when v_province in ('CS','CZ','KR','RC','VV','AG','CL','CT','EN','ME','PA','RG','SR','TP','CA','NU','OR','SS','SU','CI','OT','OG')
      then 'speciale' else 'nazionale' end;
    v_base := public.client_price_at(
      v_order.cliente_id,
      format('sped_%s_%s_base', p_carrier, v_zone),
      current_date,
      case when p_carrier = 'gls' and v_zone = 'nazionale' then 5.90 when p_carrier = 'gls' then 8.90 when v_zone = 'nazionale' then 6.20 else 8.40 end
    );
    v_extra := public.client_price_at(
      v_order.cliente_id,
      format('sped_%s_kg_extra', p_carrier),
      current_date,
      case when p_carrier = 'gls' then 0.65 else 0.55 end
    );
    v_price := round(v_base + greatest(0, v_billable - 1) * v_extra, 2);
  end if;

  update public.shopify_orders
  set selected_carrier = p_carrier,
      shipping_price = v_price,
      shipping_billable_weight = v_billable,
      shipping_zone = v_zone,
      shipping_quote = jsonb_build_object(
        'carrier', p_carrier, 'net', v_price, 'actual_weight_kg', round(v_actual, 3),
        'volumetric_weight_kg', round(v_volume / v_divisor, 3), 'billable_weight_kg', v_billable,
        'zone', v_zone, 'rate_id', v_rate.id, 'rate_effective_from', v_rate_date, 'simulated', true
      ),
      shipping_confirmed_at = v_now,
      shipping_confirmed_by = auth.uid(),
      updated_at = v_now
  where id = p_order_id
  returning * into v_order;
  return v_order;
end;
$$;

revoke all on function public.confirm_wms_shipping_choice(uuid, text) from public;
grant execute on function public.confirm_wms_shipping_choice(uuid, text) to authenticated;
