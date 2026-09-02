-- Ripartenza fisica del magazzino: conserva clienti, cataloghi, ordini, bag e carrelli,
-- ma elimina scorte, sessioni operative e tutte le vecchie ubicazioni di stoccaggio.
truncate table
  public.wms_galluse_batches,
  public.wms_mass_pick_batches,
  public.wms_pick_tasks,
  public.wms_packing_sessions,
  public.wms_inventory_sessions,
  public.wms_inbound_sessions,
  public.wms_stock_transfers,
  public.wms_locations
restart identity cascade;

update public.wms_bags
set stato = 'disponibile', updated_at = now();

insert into public.wms_locations (
  codice, zona, tipo, stato, note, map_x, map_z, map_rotation, map_width, map_depth, access_side, map_updated_at
)
values
  ('INBOUND-01', 'Ricezione', 'terra', 'attiva', 'Area di ingresso merce', -5.5, 27.8, 0, 3, 1.6, 'front', now()),
  ('OUTBOUND-01', 'Outbound', 'outbound', 'attiva', 'Area di uscita merce', 5.5, 27.8, 0, 3, 1.6, 'front', now()),
  ('PACK-01', 'Packing', 'packing', 'attiva', 'Packing station', 0, 23.5, 0, 4.5, 2.4, 'front', now());

update public.wms_warehouse_map
set width = 18,
    depth = 60,
    entrance_x = 0,
    entrance_z = 29.2,
    aisles = '[]'::jsonb,
    updated_at = now()
where id = true;
