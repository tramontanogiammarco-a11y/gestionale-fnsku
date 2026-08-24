create table if not exists public.wms_galluse_batches (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  stato text not null default 'da_associare_bag'
    check (stato in ('da_associare_bag', 'in_corso', 'completata', 'annullata')),
  numero_bag integer not null default 10 check (numero_bag between 1 and 10),
  operatore_id uuid references public.profiles(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.shopify_orders
  drop constraint if exists shopify_orders_wms_status_check;

alter table public.shopify_orders
  add constraint shopify_orders_wms_status_check
  check (wms_status in (
    'da_preparare',
    'in_preparazione',
    'pronto',
    'in_attesa_packing',
    'in_packing',
    'spedito',
    'annullato'
  ));

create table if not exists public.wms_galluse_orders (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.wms_galluse_batches(id) on delete cascade,
  order_id uuid not null unique references public.shopify_orders(id) on delete cascade,
  posizione_bag integer not null check (posizione_bag between 1 and 10),
  bag_id uuid references public.wms_bags(id) on delete set null,
  bag_code text check (bag_code is null or bag_code ~ '^B-[0-9]{5}$'),
  created_at timestamptz not null default now(),
  unique (batch_id, posizione_bag),
  unique (batch_id, bag_id)
);

create table if not exists public.wms_galluse_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.wms_galluse_batches(id) on delete cascade,
  location_id uuid not null references public.wms_locations(id) on delete restrict,
  product_key text not null,
  titolo text not null,
  ean text,
  fnsku text,
  sku text,
  quantita_attesa integer not null check (quantita_attesa > 0),
  quantita_prelevata integer not null default 0 check (quantita_prelevata >= 0),
  sequenza integer not null default 0,
  location_confirmed_at timestamptz,
  picked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (batch_id, location_id, product_key)
);

create table if not exists public.wms_galluse_allocations (
  id uuid primary key default gen_random_uuid(),
  galluse_line_id uuid not null references public.wms_galluse_lines(id) on delete cascade,
  galluse_order_id uuid not null references public.wms_galluse_orders(id) on delete cascade,
  order_item_id uuid not null references public.shopify_order_items(id) on delete cascade,
  quantita integer not null check (quantita > 0),
  created_at timestamptz not null default now(),
  unique (galluse_line_id, order_item_id)
);

alter table public.wms_outbound_movements
  add column if not exists galluse_line_id uuid unique references public.wms_galluse_lines(id) on delete cascade,
  add column if not exists galluse_batch_id uuid references public.wms_galluse_batches(id) on delete cascade;

alter table public.wms_outbound_movements
  drop constraint if exists wms_outbound_movement_source_check;

alter table public.wms_outbound_movements
  add constraint wms_outbound_movement_source_check
  check (
    (pick_line_id is not null)::integer
    + (mass_pick_line_id is not null)::integer
    + (galluse_line_id is not null)::integer = 1
  );

create index if not exists wms_galluse_batches_status_idx on public.wms_galluse_batches(stato, created_at);
create index if not exists wms_galluse_orders_batch_idx on public.wms_galluse_orders(batch_id, posizione_bag);
create index if not exists wms_galluse_lines_batch_idx on public.wms_galluse_lines(batch_id, sequenza);
create index if not exists wms_galluse_allocations_line_idx on public.wms_galluse_allocations(galluse_line_id);

alter table public.wms_galluse_batches enable row level security;
alter table public.wms_galluse_orders enable row level security;
alter table public.wms_galluse_lines enable row level security;
alter table public.wms_galluse_allocations enable row level security;

create policy "wms_galluse_batches_staff_access" on public.wms_galluse_batches
  for all using (public.is_staff()) with check (public.is_staff());
create policy "wms_galluse_orders_staff_access" on public.wms_galluse_orders
  for all using (public.is_staff()) with check (public.is_staff());
create policy "wms_galluse_lines_staff_access" on public.wms_galluse_lines
  for all using (public.is_staff()) with check (public.is_staff());
create policy "wms_galluse_allocations_staff_access" on public.wms_galluse_allocations
  for all using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.wms_galluse_batches to authenticated;
grant select, insert, update, delete on public.wms_galluse_orders to authenticated;
grant select, insert, update, delete on public.wms_galluse_lines to authenticated;
grant select, insert, update, delete on public.wms_galluse_allocations to authenticated;
