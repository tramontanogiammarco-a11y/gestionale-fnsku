create table if not exists public.wms_inventory_sessions (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.wms_locations(id) on delete restrict,
  stato text not null default 'in_corso'
    check (stato in ('in_corso', 'completata', 'annullata')),
  operatore_id uuid references public.profiles(id) on delete set null,
  note text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.wms_inventory_counts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.wms_inventory_sessions(id) on delete cascade,
  location_id uuid not null references public.wms_locations(id) on delete restrict,
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  product_key text not null,
  ean text,
  fnsku text,
  titolo text,
  quantita_attesa integer not null default 0 check (quantita_attesa >= 0),
  quantita_contata integer not null default 0 check (quantita_contata >= 0),
  verificata boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, cliente_id, product_key)
);

create unique index if not exists wms_inventory_one_active_location_idx
  on public.wms_inventory_sessions(location_id)
  where stato = 'in_corso';

create index if not exists wms_inventory_sessions_location_idx
  on public.wms_inventory_sessions(location_id, started_at desc);

create index if not exists wms_inventory_counts_session_idx
  on public.wms_inventory_counts(session_id);

create index if not exists wms_inventory_counts_product_idx
  on public.wms_inventory_counts(cliente_id, product_key);

alter table public.wms_inventory_sessions enable row level security;
alter table public.wms_inventory_counts enable row level security;

create policy "wms_inventory_sessions_staff_access" on public.wms_inventory_sessions
  for all using (public.is_staff()) with check (public.is_staff());

create policy "wms_inventory_counts_staff_access" on public.wms_inventory_counts
  for all using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.wms_inventory_sessions to authenticated;
grant select, insert, update, delete on public.wms_inventory_counts to authenticated;
