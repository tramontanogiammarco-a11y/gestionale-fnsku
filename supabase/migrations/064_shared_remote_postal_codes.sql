insert into public.carrier_postal_zones (
  carrier, postal_code, zone_code, zone_name, is_current_postal_code, source_name
)
select 'brt', postal_code, zone_code, 'CAP disagiato BRT', is_current_postal_code,
  'Elenco disagiati condiviso - in attesa elenco specifico BRT'
from public.carrier_postal_zones
where carrier = 'gls' and zone_code = 'disagiata' and active
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
    'brt_remote_postal_codes', (select count(distinct postal_code) from public.carrier_postal_zones where carrier = 'brt' and zone_code = 'disagiata' and active),
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
    coalesce((rule->>'priority')::integer, 0)
  from jsonb_array_elements(coalesce(p_rules, '[]'::jsonb)) rule;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

