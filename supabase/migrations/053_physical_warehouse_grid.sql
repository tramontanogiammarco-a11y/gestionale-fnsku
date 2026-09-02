update public.wms_warehouse_map
set
  width = 18,
  depth = 60,
  entrance_x = 0,
  entrance_z = 29.2,
  aisles = '[]'::jsonb,
  updated_at = now()
where id = true;

with numbered as (
  select
    id,
    row_number() over (
      order by
        case when codice ~ '^P[0-9]+[+]A[0-9]+$' then substring(codice from 'A([0-9]+)$')::integer else 100000 end,
        codice
    ) - 1 as item_index
  from public.wms_locations
  where tipo = 'pallet'
)
update public.wms_locations location
set
  map_x = -7.875 + mod(numbered.item_index, 10) * 1.75,
  map_z = -26.6 + floor(numbered.item_index / 10.0) * 0.95,
  map_rotation = 0,
  map_width = 1.6,
  map_depth = 0.8,
  map_updated_at = now()
from numbered
where location.id = numbered.id;

with numbered as (
  select
    id,
    row_number() over (
      order by
        case when codice ~ '^S[0-9]+[+]A[0-9]+$' then substring(codice from 'A([0-9]+)$')::integer else 100000 end,
        codice
    ) - 1 as item_index
  from public.wms_locations
  where tipo = 'slot'
)
update public.wms_locations location
set
  map_x = -6.4 + floor(numbered.item_index / 20.0) * 3.2,
  map_z = -15.2 + mod(numbered.item_index, 20) * 1.6,
  map_rotation = 90,
  map_width = 1.6,
  map_depth = 0.5,
  access_side = case when mod(floor(numbered.item_index / 20.0)::integer, 2) = 0 then 'front' else 'back' end,
  map_updated_at = now()
from numbered
where location.id = numbered.id;

update public.wms_locations
set map_x = -5.5, map_z = 27.8, map_rotation = 0, map_width = 3, map_depth = 1.6, map_updated_at = now()
where codice = 'INBOUND-01';

update public.wms_locations
set map_x = 5.5, map_z = 27.8, map_rotation = 0, map_width = 3, map_depth = 1.6, map_updated_at = now()
where codice = 'OUTBOUND-01';

update public.wms_locations
set map_x = 5.5, map_z = 23.5, map_rotation = 0, map_width = 3, map_depth = 1.6, map_updated_at = now()
where codice = 'QUARANTENA-01';

update public.wms_locations
set map_x = 0, map_z = 23.5, map_rotation = 0, map_width = 4.5, map_depth = 2.4, map_updated_at = now()
where codice = 'PACK-01';
