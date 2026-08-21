create table if not exists public.wms_pick_tasks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.shopify_orders(id) on delete cascade,
  stato text not null default 'da_prelevare'
    check (stato in ('da_prelevare', 'in_corso', 'completata', 'annullata')),
  operatore_id uuid references public.profiles(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wms_pick_lines (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.wms_pick_tasks(id) on delete cascade,
  order_item_id uuid not null references public.shopify_order_items(id) on delete cascade,
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
  unique (task_id, order_item_id, location_id)
);

create table if not exists public.wms_packing_sessions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.shopify_orders(id) on delete cascade,
  pick_task_id uuid references public.wms_pick_tasks(id) on delete set null,
  station_code text not null default 'PACK-01',
  stato text not null default 'da_imballare'
    check (stato in ('da_imballare', 'in_corso', 'completata', 'annullata')),
  operatore_id uuid references public.profiles(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wms_packing_lines (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.wms_packing_sessions(id) on delete cascade,
  order_item_id uuid not null references public.shopify_order_items(id) on delete cascade,
  titolo text not null,
  ean text,
  fnsku text,
  sku text,
  quantita_attesa integer not null check (quantita_attesa > 0),
  quantita_verificata integer not null default 0 check (quantita_verificata >= 0),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (session_id, order_item_id)
);

create table if not exists public.wms_outbound_movements (
  id uuid primary key default gen_random_uuid(),
  pick_line_id uuid not null unique references public.wms_pick_lines(id) on delete cascade,
  order_id uuid not null references public.shopify_orders(id) on delete cascade,
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  location_id uuid not null references public.wms_locations(id) on delete restrict,
  product_key text not null,
  quantita integer not null check (quantita > 0),
  operatore_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wms_pick_tasks_status_idx on public.wms_pick_tasks(stato, created_at);
create index if not exists wms_pick_lines_task_idx on public.wms_pick_lines(task_id, sequenza);
create index if not exists wms_pick_lines_location_idx on public.wms_pick_lines(location_id);
create index if not exists wms_packing_sessions_status_idx on public.wms_packing_sessions(stato, created_at);
create index if not exists wms_packing_lines_session_idx on public.wms_packing_lines(session_id);
create index if not exists wms_outbound_movements_location_idx on public.wms_outbound_movements(location_id, created_at);
create index if not exists wms_outbound_movements_product_idx on public.wms_outbound_movements(cliente_id, product_key);

alter table public.wms_pick_tasks enable row level security;
alter table public.wms_pick_lines enable row level security;
alter table public.wms_packing_sessions enable row level security;
alter table public.wms_packing_lines enable row level security;
alter table public.wms_outbound_movements enable row level security;

create policy "wms_pick_tasks_staff_access" on public.wms_pick_tasks
  for all using (public.is_staff()) with check (public.is_staff());
create policy "wms_pick_lines_staff_access" on public.wms_pick_lines
  for all using (public.is_staff()) with check (public.is_staff());
create policy "wms_packing_sessions_staff_access" on public.wms_packing_sessions
  for all using (public.is_staff()) with check (public.is_staff());
create policy "wms_packing_lines_staff_access" on public.wms_packing_lines
  for all using (public.is_staff()) with check (public.is_staff());
create policy "wms_outbound_movements_staff_access" on public.wms_outbound_movements
  for all using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.wms_pick_tasks to authenticated;
grant select, insert, update, delete on public.wms_pick_lines to authenticated;
grant select, insert, update, delete on public.wms_packing_sessions to authenticated;
grant select, insert, update, delete on public.wms_packing_lines to authenticated;
grant select, insert, update, delete on public.wms_outbound_movements to authenticated;
