alter table public.shopify_orders
  add column if not exists customer_email text,
  add column if not exists customer_phone text,
  add column if not exists ship_name text,
  add column if not exists ship_company text,
  add column if not exists ship_address1 text,
  add column if not exists ship_address2 text,
  add column if not exists ship_zip text,
  add column if not exists ship_city text,
  add column if not exists ship_province text,
  add column if not exists ship_country text,
  add column if not exists ship_country_code text;

create table if not exists public.wms_shipments (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  order_id uuid references public.shopify_orders(id) on delete set null,
  corriere text not null check (corriere in ('brt', 'gls', 'manuale')),
  servizio text,
  stato text not null default 'bozza'
    check (stato in ('bozza', 'da_inviare', 'creata', 'errore', 'annullata')),
  colli integer not null default 1 check (colli > 0),
  peso_kg numeric,
  tracking text,
  label_url text,
  carrier_reference text,
  destinatario jsonb not null default '{}'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  response jsonb not null default '{}'::jsonb,
  errore text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wms_shipments_cliente_id_idx
  on public.wms_shipments(cliente_id);

create index if not exists wms_shipments_order_id_idx
  on public.wms_shipments(order_id);

create index if not exists wms_shipments_stato_idx
  on public.wms_shipments(stato);

alter table public.wms_shipments enable row level security;

create policy "wms_shipments_read_own_or_staff" on public.wms_shipments
  for select using (public.owns_cliente(cliente_id));

create policy "wms_shipments_staff_write" on public.wms_shipments
  for all using (public.is_staff()) with check (public.is_staff());
