alter table public.wms_warehouse_map
  add column if not exists hidden_location_ids jsonb not null default '[]'::jsonb;
