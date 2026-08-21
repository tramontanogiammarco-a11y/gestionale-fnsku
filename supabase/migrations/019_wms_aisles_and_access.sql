alter table public.wms_locations
  add column if not exists access_side text not null default 'front'
  check (access_side in ('front', 'back', 'left', 'right'));

alter table public.wms_warehouse_map
  add column if not exists aisles jsonb not null default '[]'::jsonb;

