create table if not exists public.client_carrier_rates (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  carrier text not null check (carrier in ('gls', 'brt')),
  service text not null default 'Standard 24/48h',
  zone_name text not null default 'Nazionale',
  weight_from_kg numeric not null default 0 check (weight_from_kg >= 0),
  weight_to_kg numeric not null check (weight_to_kg > 0 and weight_to_kg >= weight_from_kg),
  price numeric not null check (price >= 0),
  surcharge numeric not null default 0 check (surcharge >= 0),
  postal_codes text[] not null default '{}',
  provinces text[] not null default '{}',
  priority integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_carrier_rates_lookup_idx
  on public.client_carrier_rates(cliente_id, carrier, weight_from_kg, weight_to_kg);

alter table public.client_carrier_rates enable row level security;

drop policy if exists "client_carrier_rates_read_own_or_staff" on public.client_carrier_rates;
create policy "client_carrier_rates_read_own_or_staff" on public.client_carrier_rates
  for select using (public.owns_cliente(cliente_id));

drop policy if exists "client_carrier_rates_staff_write" on public.client_carrier_rates;
create policy "client_carrier_rates_staff_write" on public.client_carrier_rates
  for all using (public.is_staff()) with check (public.is_staff());

create or replace function public.replace_client_carrier_rates(p_cliente_id uuid, p_rules jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if not public.is_staff() then
    raise exception 'Accesso riservato allo staff';
  end if;
  if not exists (select 1 from public.clienti where id = p_cliente_id) then
    raise exception 'Cliente non trovato';
  end if;
  if jsonb_typeof(coalesce(p_rules, '[]'::jsonb)) <> 'array' then
    raise exception 'Formato tariffario non valido';
  end if;

  delete from public.client_carrier_rates where cliente_id = p_cliente_id;

  insert into public.client_carrier_rates (
    cliente_id, carrier, service, zone_name, weight_from_kg, weight_to_kg,
    price, surcharge, postal_codes, provinces, priority
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
    coalesce(array(select jsonb_array_elements_text(rule->'postal_codes')), '{}'),
    coalesce(array(select jsonb_array_elements_text(rule->'provinces')), '{}'),
    coalesce((rule->>'priority')::integer, 0)
  from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) rule;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.replace_client_carrier_rates(uuid, jsonb) from public;
grant execute on function public.replace_client_carrier_rates(uuid, jsonb) to authenticated;

create or replace function public.confirm_wms_shipping_choice(p_order_id uuid, p_carrier text)
returns public.shopify_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.shopify_orders;
  v_rate public.client_carrier_rates;
  v_listino jsonb;
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

  select c.listino into v_listino from public.clienti c where c.id = v_order.cliente_id;
  select coalesce(sum(r.peso_kg * i.quantita), 0),
         coalesce(sum(r.lunghezza_cm * r.larghezza_cm * r.altezza_cm * i.quantita), 0)
  into v_actual, v_volume
  from public.shopify_order_items i
  join public.referenze r on r.id = i.referenza_id
  where i.order_id = p_order_id;
  if v_actual <= 0 then raise exception 'L''ordine non contiene prodotti con peso valido'; end if;

  v_divisor := greatest(1, coalesce((v_listino->>'sped_peso_volumetrico_divisore')::numeric, 5000));
  v_billable := greatest(1, ceil(greatest(v_actual, v_volume / v_divisor) * 2) / 2);
  v_zip := lpad(left(regexp_replace(coalesce(v_order.ship_zip, ''), '\D', '', 'g'), 5), 5, '0');
  v_province := upper(trim(coalesce(v_order.ship_province, '')));

  select rate.* into v_rate
  from public.client_carrier_rates rate
  where rate.cliente_id = v_order.cliente_id
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
      when v_province in ('CS','CZ','KR','RC','VV','AG','CL','CT','EN','ME','PA','RG','SR','TP','CA','NU','OR','SS','SU','CI','OT','OG')
      then 'speciale' else 'nazionale' end;
    v_base := coalesce((v_listino->>(format('sped_%s_%s_base', p_carrier, v_zone)))::numeric,
      case when p_carrier = 'gls' and v_zone = 'nazionale' then 5.90 when p_carrier = 'gls' then 8.90 when v_zone = 'nazionale' then 6.20 else 8.40 end);
    v_extra := coalesce((v_listino->>(format('sped_%s_kg_extra', p_carrier)))::numeric, case when p_carrier = 'gls' then 0.65 else 0.55 end);
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
        'zone', v_zone, 'rate_id', v_rate.id, 'simulated', true
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
