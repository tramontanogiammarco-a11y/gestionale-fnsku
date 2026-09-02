create table if not exists public.wms_warehouse_map_snapshots (
  id bigint generated always as identity primary key,
  label text not null,
  map_data jsonb not null default '{}'::jsonb,
  locations_data jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.wms_warehouse_map_snapshots enable row level security;

drop policy if exists "wms_warehouse_map_snapshots_staff" on public.wms_warehouse_map_snapshots;
create policy "wms_warehouse_map_snapshots_staff" on public.wms_warehouse_map_snapshots
  for all using (public.is_staff()) with check (public.is_staff());

create or replace function public.snapshot_wms_warehouse_map(p_label text default 'Backup mappa')
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  snapshot_id bigint;
begin
  if not public.is_staff() then
    raise exception 'Accesso negato';
  end if;

  insert into public.wms_warehouse_map_snapshots (label, map_data, locations_data, created_by)
  select
    coalesce(nullif(trim(p_label), ''), 'Backup mappa'),
    coalesce((select to_jsonb(m) from public.wms_warehouse_map m where m.id = true), '{}'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'codice', l.codice,
        'map_x', l.map_x,
        'map_z', l.map_z,
        'map_rotation', l.map_rotation,
        'map_width', l.map_width,
        'map_depth', l.map_depth,
        'access_side', l.access_side
      ) order by l.codice)
      from public.wms_locations l
    ), '[]'::jsonb),
    auth.uid()
  returning id into snapshot_id;

  return snapshot_id;
end;
$$;

revoke all on function public.snapshot_wms_warehouse_map(text) from public;
grant execute on function public.snapshot_wms_warehouse_map(text) to authenticated;

-- Conserva lo stato corrente prima di ricostruire la disposizione persa dal
-- precedente salvataggio rifiutato per il limite di 2.000 ubicazioni.
insert into public.wms_warehouse_map_snapshots (label, map_data, locations_data)
select
  'Prima del ripristino disposizione 2026-09-02',
  coalesce((select to_jsonb(m) from public.wms_warehouse_map m where m.id = true), '{}'::jsonb),
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id,
      'codice', l.codice,
      'map_x', l.map_x,
      'map_z', l.map_z,
      'map_rotation', l.map_rotation,
      'map_width', l.map_width,
      'map_depth', l.map_depth,
      'access_side', l.access_side
    ) order by l.codice)
    from public.wms_locations l
  ), '[]'::jsonb);

with distinct_blocks as (
  select
    l.tipo,
    left(l.codice, 1) as prefix,
    ((regexp_match(l.codice, '^[SP]([0-9]+)\+'))[1])::integer as block_number
  from public.wms_locations l
  where l.tipo in ('pallet', 'slot')
    and l.codice ~ '^[SP][0-9]+\+[A-Z][0-9]+$'
  group by l.tipo, left(l.codice, 1), ((regexp_match(l.codice, '^[SP]([0-9]+)\+'))[1])::integer
), ranked_blocks as (
  select
    b.*,
    row_number() over (partition by b.tipo order by b.block_number) - 1 as block_index
  from distinct_blocks b
), restored_positions as (
  select
    r.*,
    case
      when r.tipo = 'pallet' then -7.80 + floor(r.block_index / 20.0) * 1.60
      else -3.80 + floor(r.block_index / 35.0) * 0.90
    end as map_x,
    case
      when r.tipo = 'pallet' then 27.20 - mod(r.block_index, 20) * 2.70
      else 28.00 - mod(r.block_index, 35) * 1.60
    end as map_z,
    case when mod(floor(r.block_index / case when r.tipo = 'pallet' then 20.0 else 35.0 end)::integer, 2) = 0 then 'front' else 'back' end as access_side
  from ranked_blocks r
)
update public.wms_locations l
set
  map_x = p.map_x,
  map_z = p.map_z,
  map_rotation = 90,
  map_width = case when l.tipo = 'pallet' then 2.70 else 1.60 end,
  map_depth = case when l.tipo = 'pallet' then 1.20 else 0.50 end,
  access_side = p.access_side,
  map_updated_at = now()
from restored_positions p
where l.tipo = p.tipo
  and l.codice like p.prefix || p.block_number::text || '+%';

update public.wms_warehouse_map
set width = 18, depth = 60, entrance_x = 0, entrance_z = 29.2, updated_at = now()
where id = true;

insert into public.wms_warehouse_map_snapshots (label, map_data, locations_data)
select
  'Disposizione ripristinata 2026-09-02',
  coalesce((select to_jsonb(m) from public.wms_warehouse_map m where m.id = true), '{}'::jsonb),
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id,
      'codice', l.codice,
      'map_x', l.map_x,
      'map_z', l.map_z,
      'map_rotation', l.map_rotation,
      'map_width', l.map_width,
      'map_depth', l.map_depth,
      'access_side', l.access_side
    ) order by l.codice)
    from public.wms_locations l
  ), '[]'::jsonb);
