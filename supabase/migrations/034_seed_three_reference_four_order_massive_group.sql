-- Four identical demo orders with three isolated references for a compact
-- Massivo picking test: the operator must collect four pieces at each stop.
do $$
declare
  demo_client_id uuid;
  demo_entry_id uuid;
  demo_session_id uuid;
  demo_order_id uuid;
  entry_line_id uuid;
  reference_ids uuid[] := array[]::uuid[];
  location_ids uuid[] := array[]::uuid[];
  target_codes text[] := array['S1+A9', 'S1+A52', 'S1+A91'];
  product_names text[] := array[
    'Massivo test C - ingresso',
    'Massivo test C - corsia centrale',
    'Massivo test C - fondo magazzino'
  ];
  product_eans text[] := array[
    'MASS-C-EAN-001', 'MASS-C-EAN-002', 'MASS-C-EAN-003'
  ];
  product_fnskus text[] := array[
    'MASS-C-FNSKU-001', 'MASS-C-FNSKU-002', 'MASS-C-FNSKU-003'
  ];
  product_skus text[] := array[
    'MASS-C-SKU-001', 'MASS-C-SKU-002', 'MASS-C-SKU-003'
  ];
  reference_row record;
  target_location_id uuid;
  reference_id uuid;
  product_index integer;
  order_index integer;
begin
  select id into demo_client_id
  from public.clienti
  where ragione_sociale = 'WMS Demo Picking'
  limit 1;

  if demo_client_id is null then
    raise exception 'Cliente demo WMS non trovato';
  end if;

  for product_index in 1..3 loop
    select id into reference_id
    from public.referenze
    where cliente_id = demo_client_id
      and fnsku = product_fnskus[product_index]
    limit 1;

    if reference_id is null then
      insert into public.referenze (cliente_id, titolo, ean, sku, fnsku, origine)
      values (
        demo_client_id,
        product_names[product_index],
        product_eans[product_index],
        product_skus[product_index],
        product_fnskus[product_index],
        'wms-route-demo'
      )
      returning id into reference_id;
    end if;

    reference_ids := array_append(reference_ids, reference_id);

    select id into target_location_id
    from public.wms_locations
    where codice = target_codes[product_index]
      and tipo = 'slot'
      and stato = 'attiva';

    if target_location_id is null then
      raise exception 'Slot demo % non disponibile', target_codes[product_index];
    end if;

    if exists (
      select 1
      from public.wms_inbound_movements movement
      join public.entrate_righe entry_line on entry_line.id = movement.entrata_riga_id
      join public.entrate entry on entry.id = entry_line.entrata_id
      where movement.location_id = target_location_id
        and movement.disposizione = 'disponibile'
        and entry.cliente_id <> demo_client_id
    ) then
      raise exception 'Lo slot % contiene stock non demo e non può essere usato per il test Massivo', target_codes[product_index];
    end if;

    delete from public.wms_inbound_movements movement
    using public.entrate_righe entry_line, public.entrate entry
    where movement.location_id = target_location_id
      and movement.disposizione = 'disponibile'
      and movement.entrata_riga_id = entry_line.id
      and entry_line.entrata_id = entry.id
      and entry.cliente_id = demo_client_id;

    location_ids := array_append(location_ids, target_location_id);
  end loop;

  insert into public.entrate (
    cliente_id, tipo, colli, ddt, corriere, tracking, stato, data_annuncio, data_ricezione, note
  ) values (
    demo_client_id, 'pallet', 3, 'WMS-MASS-C-001', 'Demo', 'WMS-MASS-C-001',
    'ricevuto', now(), now(), 'Fixture Massivo C: 4 ordini con 3 referenze, 4 pezzi per referenza'
  ) returning id into demo_entry_id;

  insert into public.wms_inbound_sessions (entrata_id, stato, started_at, completed_at, note)
  values (demo_entry_id, 'completata', now(), now(), 'Ubicazione demo per gruppo Massivo C')
  returning id into demo_session_id;

  for product_index in 1..3 loop
    select * into reference_row from public.referenze where id = reference_ids[product_index];

    insert into public.entrate_righe (entrata_id, ean, quantita, quantita_ricevuta, fnsku)
    values (demo_entry_id, reference_row.ean, 100, 100, reference_row.fnsku)
    returning id into entry_line_id;

    insert into public.wms_inbound_movements (
      session_id, entrata_riga_id, location_id, disposizione, quantita, codice_scansionato
    ) values (
      demo_session_id, entry_line_id, location_ids[product_index], 'disponibile', 100, target_codes[product_index]
    );
  end loop;

  for order_index in 1..4 loop
    if exists (
      select 1 from public.shopify_orders
      where shopify_order_id = 'WMS-MASS-C-' || lpad(order_index::text, 3, '0')
    ) then
      continue;
    end if;

    insert into public.shopify_orders (
      cliente_id, shop_domain, shopify_order_id, order_name, financial_status,
      fulfillment_status, wms_status, processed_at, raw
    ) values (
      demo_client_id, 'wms-route-demo.aimago.local',
      'WMS-MASS-C-' || lpad(order_index::text, 3, '0'),
      '#WMS-MASS-C-' || lpad(order_index::text, 3, '0'),
      'paid', null, 'da_preparare', now() - make_interval(mins => 4 - order_index),
      jsonb_build_object('source', 'wms_route_demo', 'group', 'four-orders-three-references')
    ) returning id into demo_order_id;

    for product_index in 1..3 loop
      select * into reference_row from public.referenze where id = reference_ids[product_index];
      insert into public.shopify_order_items (
        order_id, shopify_line_item_id, referenza_id, sku, ean, titolo,
        quantita, fulfillable_quantity, raw
      ) values (
        demo_order_id,
        'WMS-MASS-C-' || lpad(order_index::text, 3, '0') || '-' || product_index,
        reference_row.id, reference_row.sku, reference_row.ean, reference_row.titolo,
        1, 1, jsonb_build_object('source', 'wms_route_demo', 'fnsku', reference_row.fnsku)
      );
    end loop;
  end loop;
end $$;
