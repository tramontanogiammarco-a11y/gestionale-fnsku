-- A dedicated Massivo demo: six equal orders with four references deliberately
-- placed in distant slots. The picking route is still calculated from the live
-- warehouse map and its walkable aisles; these positions make that route visible.
do $$
declare
  demo_client_id uuid;
  demo_entry_id uuid;
  demo_session_id uuid;
  demo_order_id uuid;
  entry_line_id uuid;
  reference_ids uuid[] := array[]::uuid[];
  location_ids uuid[] := array[]::uuid[];
  target_codes text[] := array['S1+A20', 'S1+A37', 'S1+A54', 'S1+A88'];
  route_names text[] := array[
    'Rotta Massivo 01 · ingresso',
    'Rotta Massivo 02 · corsia centrale',
    'Rotta Massivo 03 · corsia lunga',
    'Rotta Massivo 04 · fondo magazzino'
  ];
  route_eans text[] := array[
    'ROUTE-EAN-001', 'ROUTE-EAN-002', 'ROUTE-EAN-003', 'ROUTE-EAN-004'
  ];
  route_fnskus text[] := array[
    'ROUTE-FNSKU-001', 'ROUTE-FNSKU-002', 'ROUTE-FNSKU-003', 'ROUTE-FNSKU-004'
  ];
  route_skus text[] := array[
    'ROUTE-SKU-001', 'ROUTE-SKU-002', 'ROUTE-SKU-003', 'ROUTE-SKU-004'
  ];
  reference_row record;
  location_id uuid;
  reference_id uuid;
  route_index integer;
  order_index integer;
begin
  select id into demo_client_id
  from public.clienti
  where ragione_sociale = 'WMS Demo Picking'
  limit 1;

  if demo_client_id is null then
    raise exception 'Cliente demo WMS non trovato';
  end if;

  -- Keep the fixture repeatable when a development database is reset.
  for route_index in 1..4 loop
    select id into reference_id
    from public.referenze
    where cliente_id = demo_client_id
      and fnsku = route_fnskus[route_index]
    limit 1;

    if reference_id is null then
      insert into public.referenze (cliente_id, titolo, ean, sku, fnsku, origine)
      values (
        demo_client_id,
        route_names[route_index],
        route_eans[route_index],
        route_skus[route_index],
        route_fnskus[route_index],
        'wms-route-demo'
      )
      returning id into reference_id;
    end if;

    reference_ids := array_append(reference_ids, reference_id);

    select id into location_id
    from public.wms_locations
    where codice = target_codes[route_index]
      and tipo = 'slot'
      and stato = 'attiva';

    if location_id is null then
      raise exception 'Slot demo % non disponibile', target_codes[route_index];
    end if;

    location_ids := array_append(location_ids, location_id);

    -- These slots contain only the isolated WMS demo fixture. Clear that fixture
    -- before placing the route product, keeping each physical slot single-product.
    if exists (
      select 1
      from public.wms_inbound_movements movement
      join public.entrate_righe entry_line on entry_line.id = movement.entrata_riga_id
      join public.entrate entry on entry.id = entry_line.entrata_id
      where movement.location_id = location_id
        and movement.disposizione = 'disponibile'
        and entry.cliente_id <> demo_client_id
    ) then
      raise exception 'Lo slot % contiene stock non demo e non può essere usato per il test Massivo', target_codes[route_index];
    end if;

    delete from public.wms_inbound_movements movement
    using public.entrate_righe entry_line, public.entrate entry
    where movement.location_id = location_id
      and movement.disposizione = 'disponibile'
      and movement.entrata_riga_id = entry_line.id
      and entry_line.entrata_id = entry.id
      and entry.cliente_id = demo_client_id;
  end loop;

  insert into public.entrate (
    cliente_id, tipo, colli, ddt, corriere, tracking, stato, data_annuncio, data_ricezione, note
  ) values (
    demo_client_id, 'pallet', 4, 'WMS-ROUTE-DEMO-001', 'Demo', 'WMS-ROUTE-DEMO-001',
    'ricevuto', now(), now(), 'Fixture Massivo: 4 referenze sparse per verificare la rotta di picking'
  ) returning id into demo_entry_id;

  insert into public.wms_inbound_sessions (entrata_id, stato, started_at, completed_at, note)
  values (demo_entry_id, 'completata', now(), now(), 'Ubicazione demo per percorso Massivo')
  returning id into demo_session_id;

  for route_index in 1..4 loop
    select * into reference_row from public.referenze where id = reference_ids[route_index];

    insert into public.entrate_righe (entrata_id, ean, quantita, quantita_ricevuta, fnsku)
    values (demo_entry_id, reference_row.ean, 100, 100, reference_row.fnsku)
    returning id into entry_line_id;

    insert into public.wms_inbound_movements (
      session_id, entrata_riga_id, location_id, disposizione, quantita, codice_scansionato
    ) values (
      demo_session_id, entry_line_id, location_ids[route_index], 'disponibile', 100, target_codes[route_index]
    );
  end loop;

  for order_index in 1..6 loop
    if exists (
      select 1 from public.shopify_orders
      where shopify_order_id = 'WMS-ROUTE-' || lpad(order_index::text, 3, '0')
    ) then
      continue;
    end if;

    insert into public.shopify_orders (
      cliente_id, shop_domain, shopify_order_id, order_name, financial_status,
      fulfillment_status, wms_status, processed_at, raw
    ) values (
      demo_client_id, 'wms-route-demo.aimago.local',
      'WMS-ROUTE-' || lpad(order_index::text, 3, '0'),
      '#WMS-ROUTE-' || lpad(order_index::text, 3, '0'),
      'paid', null, 'da_preparare', now() - make_interval(mins => 6 - order_index),
      jsonb_build_object('source', 'wms_route_demo', 'group', 'six-orders-four-scattered-references')
    ) returning id into demo_order_id;

    for route_index in 1..4 loop
      select * into reference_row from public.referenze where id = reference_ids[route_index];
      insert into public.shopify_order_items (
        order_id, shopify_line_item_id, referenza_id, sku, ean, titolo,
        quantita, fulfillable_quantity, raw
      ) values (
        demo_order_id,
        'WMS-ROUTE-' || lpad(order_index::text, 3, '0') || '-' || route_index,
        reference_row.id, reference_row.sku, reference_row.ean, reference_row.titolo,
        1, 1, jsonb_build_object('source', 'wms_route_demo', 'fnsku', reference_row.fnsku)
      );
    end loop;
  end loop;
end $$;
