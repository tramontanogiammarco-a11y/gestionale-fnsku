do $$
declare
  quarantine_id uuid;
  existing_outbound_id uuid;
begin
  select id into quarantine_id
  from public.wms_locations
  where codice = 'QUARANTENA-01'
  limit 1;

  if quarantine_id is null then
    return;
  end if;

  select id into existing_outbound_id
  from public.wms_locations
  where codice = 'OUTBOUND-01'
  limit 1;

  if existing_outbound_id is not null and existing_outbound_id <> quarantine_id then
    update public.wms_inbound_movements set location_id = quarantine_id where location_id = existing_outbound_id;
    update public.wms_inventory_sessions set location_id = quarantine_id where location_id = existing_outbound_id;
    update public.wms_inventory_counts set location_id = quarantine_id where location_id = existing_outbound_id;
    update public.wms_pick_lines set location_id = quarantine_id where location_id = existing_outbound_id;
    update public.wms_outbound_movements set location_id = quarantine_id where location_id = existing_outbound_id;
    update public.wms_mass_pick_lines set location_id = quarantine_id where location_id = existing_outbound_id;
    update public.wms_stock_transfers set source_location_id = quarantine_id where source_location_id = existing_outbound_id;
    update public.wms_stock_transfers set target_location_id = quarantine_id where target_location_id = existing_outbound_id;
    delete from public.wms_locations where id = existing_outbound_id;
  end if;

  update public.wms_locations
  set
    codice = 'OUTBOUND-01',
    zona = 'Spedizioni',
    tipo = 'outbound',
    stato = 'attiva',
    note = 'Area di consolidamento dei colli pronti alla spedizione',
    map_x = 4,
    map_z = 10.8,
    map_rotation = 0,
    map_width = 3,
    map_depth = 1.6,
    access_side = 'front',
    map_updated_at = now()
  where id = quarantine_id;
end $$;
