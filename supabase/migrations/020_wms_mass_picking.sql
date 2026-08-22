create table if not exists public.wms_mass_pick_batches (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  bag_code text not null unique check (bag_code ~ '^[0-9]{6}$'),
  signature text not null,
  stato text not null default 'in_corso'
    check (stato in ('in_corso', 'completata', 'in_packing', 'completata_packing', 'annullata')),
  operatore_id uuid references public.profiles(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wms_mass_pick_orders (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.wms_mass_pick_batches(id) on delete cascade,
  order_id uuid not null unique references public.shopify_orders(id) on delete cascade,
  packing_sequence integer not null,
  stato text not null default 'nella_bag'
    check (stato in ('nella_bag', 'in_packing', 'completato')),
  created_at timestamptz not null default now(),
  unique (batch_id, packing_sequence)
);

create table if not exists public.wms_mass_pick_lines (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.wms_mass_pick_batches(id) on delete cascade,
  referenza_id uuid not null references public.referenze(id) on delete restrict,
  location_id uuid not null references public.wms_locations(id) on delete restrict,
  product_key text not null,
  titolo text not null,
  ean text,
  fnsku text,
  sku text,
  quantita_per_ordine integer not null check (quantita_per_ordine > 0),
  numero_ordini integer not null check (numero_ordini > 1),
  quantita_attesa integer not null check (quantita_attesa > 0),
  quantita_prelevata integer not null default 0 check (quantita_prelevata >= 0),
  sequenza integer not null default 0,
  location_confirmed_at timestamptz,
  picked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (batch_id, referenza_id, location_id)
);

alter table public.wms_packing_sessions
  add column if not exists mass_batch_id uuid references public.wms_mass_pick_batches(id) on delete set null,
  add column if not exists bag_code text,
  add column if not exists packing_sequence integer;

alter table public.wms_packing_lines
  add column if not exists referenza_id uuid references public.referenze(id) on delete set null,
  add column if not exists foto_url text;

alter table public.wms_outbound_movements
  alter column pick_line_id drop not null,
  alter column order_id drop not null,
  add column if not exists mass_pick_line_id uuid unique references public.wms_mass_pick_lines(id) on delete cascade,
  add column if not exists mass_batch_id uuid references public.wms_mass_pick_batches(id) on delete cascade;

alter table public.wms_outbound_movements drop constraint if exists wms_outbound_movement_source_check;
alter table public.wms_outbound_movements add constraint wms_outbound_movement_source_check
  check ((pick_line_id is not null)::integer + (mass_pick_line_id is not null)::integer = 1);

create index if not exists wms_mass_pick_batches_status_idx on public.wms_mass_pick_batches(stato, created_at);
create index if not exists wms_mass_pick_orders_batch_idx on public.wms_mass_pick_orders(batch_id, packing_sequence);
create index if not exists wms_mass_pick_lines_batch_idx on public.wms_mass_pick_lines(batch_id, sequenza);
create index if not exists wms_mass_pick_lines_location_idx on public.wms_mass_pick_lines(location_id);
create index if not exists wms_packing_sessions_bag_idx on public.wms_packing_sessions(bag_code, packing_sequence);

alter table public.wms_mass_pick_batches enable row level security;
alter table public.wms_mass_pick_orders enable row level security;
alter table public.wms_mass_pick_lines enable row level security;

create policy "wms_mass_pick_batches_staff_access" on public.wms_mass_pick_batches
  for all using (public.is_staff()) with check (public.is_staff());
create policy "wms_mass_pick_orders_staff_access" on public.wms_mass_pick_orders
  for all using (public.is_staff()) with check (public.is_staff());
create policy "wms_mass_pick_lines_staff_access" on public.wms_mass_pick_lines
  for all using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.wms_mass_pick_batches to authenticated;
grant select, insert, update, delete on public.wms_mass_pick_orders to authenticated;
grant select, insert, update, delete on public.wms_mass_pick_lines to authenticated;
