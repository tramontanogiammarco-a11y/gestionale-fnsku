alter table public.wms_locations
  drop constraint if exists wms_locations_tipo_check;

alter table public.wms_locations
  add constraint wms_locations_tipo_check
  check (tipo in ('scaffale', 'slot', 'pallet', 'terra', 'quarantena', 'outbound', 'packing'));

insert into public.wms_locations (
  codice, zona, tipo, stato, note,
  map_x, map_z, map_rotation, map_width, map_depth, access_side, map_updated_at
)
values
  (
    'OUTBOUND-01', 'Spedizioni', 'outbound', 'attiva',
    'Area di consolidamento dei colli pronti alla spedizione',
    4, 10.8, 0, 3, 1.6, 'front', now()
  ),
  (
    'PACK-01', 'Packing', 'packing', 'attiva',
    'Packing station per verifica e chiusura fisica dei pacchi',
    0, -10.8, 0, 4.5, 2.4, 'front', now()
  )
on conflict (codice) do update set
  zona = excluded.zona,
  tipo = excluded.tipo,
  stato = excluded.stato,
  note = excluded.note,
  map_x = coalesce(public.wms_locations.map_x, excluded.map_x),
  map_z = coalesce(public.wms_locations.map_z, excluded.map_z),
  map_rotation = coalesce(public.wms_locations.map_rotation, excluded.map_rotation),
  map_width = excluded.map_width,
  map_depth = excluded.map_depth,
  access_side = coalesce(public.wms_locations.access_side, excluded.access_side),
  map_updated_at = now();
