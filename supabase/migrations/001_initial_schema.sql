create extension if not exists pgcrypto;

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
    'iva', 22
  );
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text,
  role text not null check (role in ('admin', 'staff', 'cliente')),
  cliente_id uuid,
  created_at timestamptz not null default now()
);

create table public.clienti (
  id uuid primary key default gen_random_uuid(),
  ragione_sociale text not null,
  email text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  note text,
  listino jsonb not null default public.default_listino(),
  created_at timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_cliente_id_fkey
  foreign key (cliente_id) references public.clienti(id) on delete set null;

create table public.referenze (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  ean text not null,
  sku text,
  asin text,
  titolo text not null,
  foto_url text,
  fnsku text,
  is_bundle boolean not null default false,
  componenti jsonb not null default '[]'::jsonb,
  origine text not null default 'manuale',
  created_at timestamptz not null default now()
);

create index referenze_cliente_id_idx on public.referenze(cliente_id);
create index referenze_cliente_ean_idx on public.referenze(cliente_id, ean);

create table public.entrate (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  tipo text not null check (tipo in ('pallet', 'scatola')),
  colli integer not null default 1,
  ddt text,
  tracking text,
  stato text not null default 'in_attesa' check (stato in ('in_attesa', 'ricevuto', 'in_lavorazione', 'pronto', 'spedito')),
  data_annuncio timestamptz not null default now(),
  data_ricezione timestamptz,
  note text
);

create index entrate_cliente_id_idx on public.entrate(cliente_id);

create table public.entrate_righe (
  id uuid primary key default gen_random_uuid(),
  entrata_id uuid not null references public.entrate(id) on delete cascade,
  ean text not null,
  quantita integer not null check (quantita > 0),
  fnsku text
);

create index entrate_righe_entrata_id_idx on public.entrate_righe(entrata_id);

create table public.preparazioni (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  stato text not null default 'richiesta' check (stato in ('richiesta', 'in_lavorazione', 'pronto', 'spedito')),
  note text,
  data_pronto timestamptz,
  created_at timestamptz not null default now()
);

create index preparazioni_cliente_id_idx on public.preparazioni(cliente_id);

create table public.preparazioni_righe (
  id uuid primary key default gen_random_uuid(),
  preparazione_id uuid not null references public.preparazioni(id) on delete cascade,
  ean text not null,
  sku text,
  quantita integer not null check (quantita > 0),
  servizi jsonb not null default '[]'::jsonb
);

create index preparazioni_righe_preparazione_id_idx on public.preparazioni_righe(preparazione_id);

create table public.box (
  id uuid primary key default gen_random_uuid(),
  entrata_id uuid references public.entrate(id) on delete set null,
  preparazione_id uuid references public.preparazioni(id) on delete set null,
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  numero_box text not null,
  peso_kg numeric,
  lunghezza_cm numeric,
  larghezza_cm numeric,
  altezza_cm numeric,
  stato text not null default 'in_preparazione' check (stato in ('in_preparazione', 'pronto', 'spedito')),
  scatola_tipo text not null default 'cliente',
  etichetta_amazon_pdf_url text,
  etichetta_ups_pdf_url text,
  contenuto jsonb not null default '[]'::jsonb,
  data_spedito timestamptz,
  created_at timestamptz not null default now()
);

create index box_cliente_id_idx on public.box(cliente_id);
create index box_entrata_id_idx on public.box(entrata_id);
create index box_preparazione_id_idx on public.box(preparazione_id);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clienti(id) on delete cascade,
  bucket text not null,
  path text not null,
  content_type text,
  created_at timestamptz not null default now()
);

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin', 'staff')
  );
$$;

create or replace function public.current_cliente_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cliente_id from public.profiles where id = auth.uid();
$$;

create or replace function public.owns_cliente(target_cliente_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_staff() or target_cliente_id = public.current_cliente_id();
$$;

alter table public.profiles enable row level security;
alter table public.clienti enable row level security;
alter table public.referenze enable row level security;
alter table public.entrate enable row level security;
alter table public.entrate_righe enable row level security;
alter table public.preparazioni enable row level security;
alter table public.preparazioni_righe enable row level security;
alter table public.box enable row level security;
alter table public.files enable row level security;

create policy "profiles_read_own_or_staff" on public.profiles
  for select using (id = auth.uid() or public.is_staff());

create policy "profiles_staff_update" on public.profiles
  for update using (public.is_staff()) with check (public.is_staff());

create policy "clienti_read_own_or_staff" on public.clienti
  for select using (public.owns_cliente(id));

create policy "clienti_staff_write" on public.clienti
  for all using (public.is_staff()) with check (public.is_staff());

create policy "referenze_read_own_or_staff" on public.referenze
  for select using (public.owns_cliente(cliente_id));

create policy "referenze_write_own_or_staff" on public.referenze
  for all using (public.owns_cliente(cliente_id)) with check (public.owns_cliente(cliente_id));

create policy "entrate_read_own_or_staff" on public.entrate
  for select using (public.owns_cliente(cliente_id));

create policy "entrate_insert_own_or_staff" on public.entrate
  for insert with check (public.owns_cliente(cliente_id));

create policy "entrate_staff_update" on public.entrate
  for update using (public.is_staff()) with check (public.is_staff());

create policy "entrate_righe_read_own_or_staff" on public.entrate_righe
  for select using (
    exists (
      select 1 from public.entrate e
      where e.id = entrata_id and public.owns_cliente(e.cliente_id)
    )
  );

create policy "entrate_righe_write_own_or_staff" on public.entrate_righe
  for all using (
    exists (
      select 1 from public.entrate e
      where e.id = entrata_id and public.owns_cliente(e.cliente_id)
    )
  ) with check (
    exists (
      select 1 from public.entrate e
      where e.id = entrata_id and public.owns_cliente(e.cliente_id)
    )
  );

create policy "preparazioni_read_own_or_staff" on public.preparazioni
  for select using (public.owns_cliente(cliente_id));

create policy "preparazioni_insert_own_or_staff" on public.preparazioni
  for insert with check (public.owns_cliente(cliente_id));

create policy "preparazioni_staff_update" on public.preparazioni
  for update using (public.is_staff()) with check (public.is_staff());

create policy "preparazioni_righe_read_own_or_staff" on public.preparazioni_righe
  for select using (
    exists (
      select 1 from public.preparazioni p
      where p.id = preparazione_id and public.owns_cliente(p.cliente_id)
    )
  );

create policy "preparazioni_righe_write_own_or_staff" on public.preparazioni_righe
  for all using (
    exists (
      select 1 from public.preparazioni p
      where p.id = preparazione_id and public.owns_cliente(p.cliente_id)
    )
  ) with check (
    exists (
      select 1 from public.preparazioni p
      where p.id = preparazione_id and public.owns_cliente(p.cliente_id)
    )
  );

create policy "box_read_own_or_staff" on public.box
  for select using (public.owns_cliente(cliente_id));

create policy "box_staff_insert_update" on public.box
  for all using (public.is_staff()) with check (public.is_staff());

create policy "box_client_label_update" on public.box
  for update using (public.owns_cliente(cliente_id)) with check (public.owns_cliente(cliente_id));

create policy "files_read_own_or_staff" on public.files
  for select using (cliente_id is null or public.owns_cliente(cliente_id));

create policy "files_write_own_or_staff" on public.files
  for all using (cliente_id is null or public.owns_cliente(cliente_id)) with check (cliente_id is null or public.owns_cliente(cliente_id));

insert into storage.buckets (id, name, public)
values ('gestionale-files', 'gestionale-files', true)
on conflict (id) do nothing;

create policy "storage_read_own_or_staff" on storage.objects
  for select using (
    bucket_id = 'gestionale-files'
    and (
      public.is_staff()
      or (storage.foldername(name))[1] = public.current_cliente_id()::text
    )
  );

create policy "storage_write_own_or_staff" on storage.objects
  for all using (
    bucket_id = 'gestionale-files'
    and (
      public.is_staff()
      or (storage.foldername(name))[1] = public.current_cliente_id()::text
    )
  ) with check (
    bucket_id = 'gestionale-files'
    and (
      public.is_staff()
      or (storage.foldername(name))[1] = public.current_cliente_id()::text
    )
  );
