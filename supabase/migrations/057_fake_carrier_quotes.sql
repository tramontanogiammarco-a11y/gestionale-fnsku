alter table public.referenze
  add column if not exists peso_kg numeric not null default 0.50,
  add column if not exists lunghezza_cm numeric not null default 20,
  add column if not exists larghezza_cm numeric not null default 15,
  add column if not exists altezza_cm numeric not null default 10,
  add column if not exists misure_confermate boolean not null default false;

alter table public.referenze
  drop constraint if exists referenze_peso_kg_check,
  drop constraint if exists referenze_lunghezza_cm_check,
  drop constraint if exists referenze_larghezza_cm_check,
  drop constraint if exists referenze_altezza_cm_check;

alter table public.referenze
  add constraint referenze_peso_kg_check check (peso_kg > 0),
  add constraint referenze_lunghezza_cm_check check (lunghezza_cm > 0),
  add constraint referenze_larghezza_cm_check check (larghezza_cm > 0),
  add constraint referenze_altezza_cm_check check (altezza_cm > 0);

alter table public.shopify_orders
  add column if not exists selected_carrier text,
  add column if not exists shipping_price numeric,
  add column if not exists shipping_billable_weight numeric,
  add column if not exists shipping_zone text,
  add column if not exists shipping_quote jsonb not null default '{}'::jsonb,
  add column if not exists shipping_confirmed_at timestamptz,
  add column if not exists shipping_confirmed_by uuid references public.profiles(id) on delete set null;

alter table public.shopify_orders
  drop constraint if exists shopify_orders_selected_carrier_check;

alter table public.shopify_orders
  add constraint shopify_orders_selected_carrier_check
  check (selected_carrier is null or selected_carrier in ('gls', 'brt'));

create index if not exists shopify_orders_selected_carrier_idx
  on public.shopify_orders(selected_carrier);

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
    'inscatolamento', 0,
    'scatola_60', 0,
    'scatola_40', 0,
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
    'iva', 22
  );
$$;

update public.clienti
set listino = public.default_listino() || coalesce(listino, '{}'::jsonb);
