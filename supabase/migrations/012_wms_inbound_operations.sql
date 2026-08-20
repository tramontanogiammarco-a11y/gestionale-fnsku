create table if not exists public.wms_locations (
  id uuid primary key default gen_random_uuid(),
  codice text not null unique,
  zona text,
  tipo text not null default 'scaffale'
    check (tipo in ('scaffale', 'pallet', 'terra', 'quarantena')),
  stato text not null default 'attiva'
    check (stato in ('attiva', 'bloccata')),
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.wms_inbound_sessions (
  id uuid primary key default gen_random_uuid(),
  entrata_id uuid not null references public.entrate(id) on delete cascade,
  stato text not null default 'in_corso'
    check (stato in ('in_corso', 'completata')),
  operatore_id uuid references public.profiles(id) on delete set null,
  note text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.wms_inbound_movements (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.wms_inbound_sessions(id) on delete cascade,
  entrata_riga_id uuid not null references public.entrate_righe(id) on delete cascade,
  location_id uuid references public.wms_locations(id) on delete restrict,
  disposizione text not null default 'disponibile'
    check (disposizione in ('disponibile', 'danneggiato', 'quarantena')),
  quantita integer not null check (quantita > 0),
  codice_scansionato text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists wms_inbound_one_active_session_idx
  on public.wms_inbound_sessions(entrata_id)
  where stato = 'in_corso';

create index if not exists wms_inbound_sessions_entrata_idx
  on public.wms_inbound_sessions(entrata_id, started_at desc);

create index if not exists wms_inbound_movements_session_idx
  on public.wms_inbound_movements(session_id, created_at desc);

create index if not exists wms_inbound_movements_riga_idx
  on public.wms_inbound_movements(entrata_riga_id);

alter table public.wms_locations enable row level security;
alter table public.wms_inbound_sessions enable row level security;
alter table public.wms_inbound_movements enable row level security;

create policy "wms_locations_staff_access" on public.wms_locations
  for all using (public.is_staff()) with check (public.is_staff());

create policy "wms_inbound_sessions_staff_access" on public.wms_inbound_sessions
  for all using (public.is_staff()) with check (public.is_staff());

create policy "wms_inbound_movements_staff_access" on public.wms_inbound_movements
  for all using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.wms_locations to authenticated;
grant select, insert, update, delete on public.wms_inbound_sessions to authenticated;
grant select, insert, update, delete on public.wms_inbound_movements to authenticated;

insert into public.wms_locations (codice, zona, tipo)
values
  ('INBOUND-01', 'Ricezione', 'terra'),
  ('QUARANTENA-01', 'Qualita', 'quarantena')
on conflict (codice) do nothing;
