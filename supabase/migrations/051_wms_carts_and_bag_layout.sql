-- Carrelli configurabili: ogni carrello ha una griglia fisica e bag associate.
create table if not exists public.wms_carts (
  id uuid primary key default gen_random_uuid(),
  codice text not null unique check (codice ~ '^[A-Z][A-Z0-9_-]{2,39}$'),
  righe integer not null default 2 check (righe between 1 and 6),
  colonne integer not null default 5 check (colonne between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wms_cart_bag_positions (
  cart_id uuid not null references public.wms_carts(id) on delete cascade,
  posizione integer not null check (posizione between 1 and 60),
  bag_id uuid not null unique references public.wms_bags(id) on delete restrict,
  bag_code text not null unique check (bag_code ~ '^B-[0-9]{5}$'),
  updated_at timestamptz not null default now(),
  primary key (cart_id, posizione)
);

alter table public.wms_carts enable row level security;
alter table public.wms_cart_bag_positions enable row level security;

create policy "wms_carts_staff_access" on public.wms_carts
  for all using (public.is_staff()) with check (public.is_staff());

create policy "wms_cart_bag_positions_staff_access" on public.wms_cart_bag_positions
  for all using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.wms_carts to authenticated;
grant select, insert, update, delete on public.wms_cart_bag_positions to authenticated;

-- Backfill the current Galluse layout into the configurable CARRELLO-01.
insert into public.wms_carts (codice, righe, colonne)
values ('CARRELLO-01', 2, 5)
on conflict (codice) do nothing;

insert into public.wms_cart_bag_positions (cart_id, posizione, bag_id, bag_code)
select cart.id, legacy.posizione, legacy.bag_id, legacy.bag_code
from public.wms_galluse_cart_positions legacy
join public.wms_carts cart on cart.codice = 'CARRELLO-01'
on conflict (cart_id, posizione) do update
set bag_id = excluded.bag_id,
    bag_code = excluded.bag_code,
    updated_at = now();
