create table if not exists public.italian_postal_codes (
  postal_code text not null check (postal_code ~ '^[0-9]{5}$'),
  istat_code text not null,
  municipality_name text not null,
  municipality_alt_name text,
  province_code text,
  province_name text,
  province_type text,
  region_code text,
  region_name text,
  region_type text,
  geographic_area text,
  is_province_capital boolean not null default false,
  belfiore_code text,
  latitude numeric,
  longitude numeric,
  surface_km2 numeric,
  source_name text not null default 'Elenco CAP italiani ISTAT',
  loaded_at timestamptz not null default now(),
  primary key (postal_code, istat_code)
);

create index if not exists italian_postal_codes_postal_code_idx
  on public.italian_postal_codes(postal_code);
create index if not exists italian_postal_codes_province_code_idx
  on public.italian_postal_codes(province_code);
create index if not exists italian_postal_codes_region_code_idx
  on public.italian_postal_codes(region_code);

alter table public.italian_postal_codes enable row level security;

drop policy if exists "italian_postal_codes_authenticated_read" on public.italian_postal_codes;
create policy "italian_postal_codes_authenticated_read" on public.italian_postal_codes
  for select to authenticated using (true);

drop policy if exists "italian_postal_codes_staff_write" on public.italian_postal_codes;
create policy "italian_postal_codes_staff_write" on public.italian_postal_codes
  for all using (public.is_staff()) with check (public.is_staff());

create or replace function public.italian_postal_code_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'municipality_rows', count(*),
    'postal_codes', count(distinct postal_code),
    'provinces', count(distinct province_code),
    'regions', count(distinct region_code),
    'loaded_at', max(loaded_at)
  )
  from public.italian_postal_codes;
$$;

revoke all on function public.italian_postal_code_stats() from public;
grant execute on function public.italian_postal_code_stats() to authenticated;

create or replace function public.validate_confirmed_shipping_postal_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_postal_code text;
begin
  if new.shipping_confirmed_at is not distinct from old.shipping_confirmed_at then
    return new;
  end if;
  if new.shipping_confirmed_at is null then
    return new;
  end if;
  if upper(coalesce(nullif(trim(new.ship_country_code), ''), 'IT')) <> 'IT' then
    return new;
  end if;

  v_postal_code := lpad(left(regexp_replace(coalesce(new.ship_zip, ''), '\D', '', 'g'), 5), 5, '0');
  if not exists (
    select 1 from public.italian_postal_codes where postal_code = v_postal_code
  ) then
    raise exception 'CAP % non presente nell''anagrafica italiana', v_postal_code;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_confirmed_shipping_postal_code_trigger on public.shopify_orders;
create trigger validate_confirmed_shipping_postal_code_trigger
before update of shipping_confirmed_at on public.shopify_orders
for each row execute function public.validate_confirmed_shipping_postal_code();

