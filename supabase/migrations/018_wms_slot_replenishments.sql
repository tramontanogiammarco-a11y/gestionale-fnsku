create table if not exists public.wms_stock_transfers (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  product_key text not null,
  source_location_id uuid not null references public.wms_locations(id) on delete restrict,
  target_location_id uuid not null references public.wms_locations(id) on delete restrict,
  quantita integer not null check (quantita > 0),
  order_id uuid references public.shopify_orders(id) on delete set null,
  operatore_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (source_location_id <> target_location_id)
);

create index if not exists wms_stock_transfers_product_idx
  on public.wms_stock_transfers(cliente_id, product_key, created_at);

create index if not exists wms_stock_transfers_locations_idx
  on public.wms_stock_transfers(source_location_id, target_location_id);

alter table public.wms_stock_transfers enable row level security;

create policy "wms_stock_transfers_staff_access" on public.wms_stock_transfers
  for all using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.wms_stock_transfers to authenticated;
