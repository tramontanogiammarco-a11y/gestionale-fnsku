alter table public.wms_locations
  add column if not exists map_x double precision,
  add column if not exists map_z double precision,
  add column if not exists map_rotation double precision not null default 0,
  add column if not exists map_width double precision,
  add column if not exists map_depth double precision,
  add column if not exists map_updated_at timestamptz;

create table if not exists public.wms_warehouse_map (
  id boolean primary key default true check (id),
  width double precision not null default 34 check (width between 10 and 100),
  depth double precision not null default 24 check (depth between 10 and 100),
  entrance_x double precision not null default 0,
  entrance_z double precision not null default 10.5,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.wms_warehouse_map enable row level security;

create policy "wms_warehouse_map_staff_access" on public.wms_warehouse_map
  for all using (public.is_staff()) with check (public.is_staff());

grant select, insert, update on public.wms_warehouse_map to authenticated;

insert into public.wms_warehouse_map (id)
values (true)
on conflict (id) do nothing;

with numbered as (
  select
    id,
    greatest(1, substring(codice from 'A([0-9]+)$')::integer) - 1 as item_index
  from public.wms_locations
  where tipo = 'pallet'
    and codice ~ '^P[0-9]+[+]A[0-9]+$'
)
update public.wms_locations location
set
  map_x = -13 + floor(numbered.item_index / 20.0) * 2.7,
  map_z = -9 + mod(numbered.item_index, 20) * 0.95,
  map_rotation = 0,
  map_width = 1.6,
  map_depth = 0.72,
  map_updated_at = now()
from numbered
where location.id = numbered.id
  and (location.map_x is null or location.map_z is null);

with numbered as (
  select
    id,
    greatest(1, substring(codice from 'A([0-9]+)$')::integer) - 1 as item_index
  from public.wms_locations
  where tipo = 'slot'
    and codice ~ '^S[0-9]+[+]A[0-9]+$'
)
update public.wms_locations location
set
  map_x = 2.5 + floor(numbered.item_index / 20.0) * 2.2,
  map_z = -9 + mod(numbered.item_index, 20) * 0.95,
  map_rotation = 0,
  map_width = 0.92,
  map_depth = 0.62,
  map_updated_at = now()
from numbered
where location.id = numbered.id
  and (location.map_x is null or location.map_z is null);

update public.wms_locations
set
  map_x = case codice when 'INBOUND-01' then -4 else 4 end,
  map_z = 10.8,
  map_rotation = 0,
  map_width = 3,
  map_depth = 1.6,
  map_updated_at = now()
where codice in ('INBOUND-01', 'QUARANTENA-01')
  and (map_x is null or map_z is null);
