create table if not exists public.carrier_postal_zones (
  carrier text not null check (carrier in ('gls', 'brt')),
  postal_code text not null check (postal_code ~ '^[0-9]{5}$'),
  zone_code text not null,
  zone_name text not null,
  is_current_postal_code boolean not null default true,
  active boolean not null default true,
  source_name text not null,
  loaded_at timestamptz not null default now(),
  primary key (carrier, postal_code, zone_code)
);

create index if not exists carrier_postal_zones_lookup_idx
  on public.carrier_postal_zones(carrier, postal_code) where active;

alter table public.carrier_postal_zones enable row level security;

drop policy if exists "carrier_postal_zones_authenticated_read" on public.carrier_postal_zones;
create policy "carrier_postal_zones_authenticated_read" on public.carrier_postal_zones
  for select to authenticated using (true);

drop policy if exists "carrier_postal_zones_staff_write" on public.carrier_postal_zones;
create policy "carrier_postal_zones_staff_write" on public.carrier_postal_zones
  for all using (public.is_staff()) with check (public.is_staff());

insert into public.carrier_postal_zones (
  carrier, postal_code, zone_code, zone_name, is_current_postal_code, source_name
)
select 'gls', postal_code, 'disagiata', 'CAP disagiato GLS', is_current, 'Elenco GLS fornito il 01/09/2026'
from (values
  ('92031',true),('25010',true),('71051',true),('98050',true),('98055',true),
  ('58012',true),('58019',true),('58018',false),('09014',true),('57032',true),
  ('04027',true),('04031',true),('80071',true),('80072',true),('80077',true),
  ('80073',true),('80074',true),('80075',true),('80076',true),('80100',false),
  ('80081',true),('80079',true),('07024',true),('91017',true),('90051',true),
  ('06069',true),('57034',true),('57031',true),('57100',false),('57030',true),
  ('57033',true),('57036',true),('57037',true),('57038',true),('57039',false),
  ('25050',true),('07046',true),('91023',true),('30100',false),('30010',true),
  ('28016',true),('28838',true),('28922',true),('22030',true)
) as source(postal_code, is_current)
on conflict (carrier, postal_code, zone_code) do update set
  zone_name = excluded.zone_name,
  is_current_postal_code = excluded.is_current_postal_code,
  active = true,
  source_name = excluded.source_name,
  loaded_at = now();

create or replace function public.italian_postal_code_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'municipality_rows', (select count(*) from public.italian_postal_codes),
    'postal_codes', (select count(distinct postal_code) from public.italian_postal_codes),
    'provinces', (select count(distinct province_code) from public.italian_postal_codes),
    'regions', (select count(distinct region_code) from public.italian_postal_codes),
    'loaded_at', (select max(loaded_at) from public.italian_postal_codes),
    'gls_remote_postal_codes', (select count(distinct postal_code) from public.carrier_postal_zones where carrier = 'gls' and zone_code = 'disagiata' and active),
    'gls_legacy_postal_codes', (select count(distinct postal_code) from public.carrier_postal_zones where carrier = 'gls' and zone_code = 'disagiata' and active and not is_current_postal_code)
  );
$$;

create or replace function public.replace_client_carrier_rates(p_cliente_id uuid, p_rules jsonb)
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
  if jsonb_typeof(coalesce(p_rules, '[]'::jsonb)) <> 'array' then raise exception 'Formato tariffario non valido'; end if;

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
    case
      when lower(rule->>'carrier') = 'gls'
        and lower(coalesce(rule->>'zone_name', '')) like '%disagiat%'
        and coalesce(jsonb_array_length(rule->'postal_codes'), 0) = 0
      then array(select postal_code from public.carrier_postal_zones where carrier = 'gls' and zone_code = 'disagiata' and active order by postal_code)
      else coalesce(array(select jsonb_array_elements_text(rule->'postal_codes')), '{}')
    end,
    coalesce(array(select jsonb_array_elements_text(rule->'provinces')), '{}'),
    coalesce((rule->>'priority')::integer, 0)
  from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) rule;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

update public.client_carrier_rates rate
set postal_codes = array(
  select postal_code from public.carrier_postal_zones
  where carrier = 'gls' and zone_code = 'disagiata' and active order by postal_code
), updated_at = now()
where rate.carrier = 'gls'
  and lower(rate.zone_name) like '%disagiat%'
  and cardinality(rate.postal_codes) = 0;

create or replace function public.validate_confirmed_shipping_postal_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_postal_code text;
begin
  if new.shipping_confirmed_at is not distinct from old.shipping_confirmed_at or new.shipping_confirmed_at is null then return new; end if;
  if upper(coalesce(nullif(trim(new.ship_country_code), ''), 'IT')) <> 'IT' then return new; end if;
  v_postal_code := lpad(left(regexp_replace(coalesce(new.ship_zip, ''), '\D', '', 'g'), 5), 5, '0');
  if not exists (select 1 from public.italian_postal_codes where postal_code = v_postal_code)
    and not exists (select 1 from public.carrier_postal_zones where postal_code = v_postal_code and active) then
    raise exception 'CAP % non presente nell''anagrafica italiana o nei listini corriere', v_postal_code;
  end if;
  return new;
end;
$$;

