-- A second independent Massivo fixture: six matching orders, four products and
-- four distant slots. It intentionally has a different product signature from
-- the first group, so the Massivo queue keeps it as a separate mission.
do $$
declare
  demo_client_id uuid;
  demo_entry_id uuid;
  demo_session_id uuid;
  demo_order_id uuid;
  entry_line_id uuid;
  reference_ids uuid[] := array[]::uuid[];
  location_ids uuid[] := array[]::uuid[];
  target_codes text[] := array['S1+A12', 'S1+A31', 'S1+A66', 'S1+A96'];
  product_names text[] := array[
    'Massivo percorso B · ingresso',
    'Massivo percorso B · corsia uno',
    'Massivo percorso B · corsia tre',
    'Massivo percorso B · fondo magazzino'
  ];
  product_eans text[] := array[
    'ROUTE-B-EAN-001', 'ROUTE-B-EAN-002', 'ROUTE-B-EAN-003', 'ROUTE-B-EAN-004'
  ];
  product_fnskus text[] := array[
    'ROUTE-B-FNSKU-001', 'ROUTE-B-FNSKU-002', 'ROUTE-B-FNSKU-003', 'ROUTE-B-FNSKU-004'
  ];
  product_skus text[] := array[
    'ROUTE-B-SKU-001', 'ROUTE-B-SKU-002', 'ROUTE-B-SKU-003', 'ROUTE-B-SKU-004'
  ];
  reference_row record;
  target_location_id uuid;
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

  for route_index in 1..4 loop
    select id into reference_id
    from public.referenze
    where cliente_id = demo_client_id
      and fnsku = product_fnskus[route_index]
    limit 1;

    if reference_id is null then
      insert into public.referenze (cliente_id, titolo, ean, sku, fnsku, origine)
      values (
        demo_client_id,
        product_names[route_index],
        product_eans[route_index],
        product_skus[route_index],
        product_fnskus[route_index],
        'wms-route-demo'
      )
      returning id into reference_id;
    end if;
    reference_ids := array_append(reference_ids, reference_id);

    select id into target_location_id
    from public.wms_locations
    where codice = target_codes[route_index]
      and tipo = 'slot'
      and stato = 'attiva';

    if target_location_id is null then
      raise exception 'Slot demo % non disponibile', target_codes[route_index];
    end if;
    location_ids := array_append(location_ids, target_location_id);

    if exists (
      select 1
      from public.wms_inbound_movements movement
      join public.entrate_righe entry_line on entry_line.id = movement.entrata_riga_id
      join public.entrate entry on entry.id = entry_line.entrata_id
      where movement.location_id = target_location_id
        and movement.disposizione = 'disponibile'
        and entry.cliente_id <> demo_client_id
    ) then
      raise exception 'Lo slot % contiene stock non demo e non può essere usato per il test Massivo', target_codes[route_index];
    end if;

    delete from public.wms_inbound_movements movement
    using public.entrate_righe entry_line, public.entrate entry
    where movement.location_id = target_location_id
      and movement.disposizione = 'disponibile'
      and movement.entrata_riga_id = entry_line.id
      and entry_line.entrata_id = entry.id
      and entry.cliente_id = demo_client_id;
  end loop;

  insert into public.entrate (
    cliente_id, tipo, colli, ddt, corriere, tracking, stato, data_annuncio, data_ricezione, note
  ) values (
    demo_client_id, 'pallet', 4, 'WMS-ROUTE-DEMO-002', 'Demo', 'WMS-ROUTE-DEMO-002',
    'ricevuto', now(), now(), 'Fixture Massivo B: 4 referenze distanti per verificare la rotta di picking'
  ) returning id into demo_entry_id;

  insert into public.wms_inbound_sessions (entrata_id, stato, started_at, completed_at, note)
  values (demo_entry_id, 'completata', now(), now(), 'Ubicazione automatica demo Massivo B')
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
      where shopify_order_id = 'WMS-ROUTE-B-' || lpad(order_index::text, 3, '0')
    ) then
      continue;
    end if;

    insert into public.shopify_orders (
      cliente_id, shop_domain, shopify_order_id, order_name, financial_status,
      fulfillment_status, wms_status, processed_at, raw
    ) values (
      demo_client_id, 'wms-route-demo.aimago.local',
      'WMS-ROUTE-B-' || lpad(order_index::text, 3, '0'),
      '#WMS-ROUTE-B-' || lpad(order_index::text, 3, '0'),
      'paid', null, 'da_preparare', now() - make_interval(mins => 6 - order_index),
      jsonb_build_object('source', 'wms_route_demo', 'group', 'second-six-orders-four-scattered-references')
    ) returning id into demo_order_id;

    for route_index in 1..4 loop
      select * into reference_row from public.referenze where id = reference_ids[route_index];
      insert into public.shopify_order_items (
        order_id, shopify_line_item_id, referenza_id, sku, ean, titolo,
        quantita, fulfillable_quantity, raw
      ) values (
        demo_order_id,
        'WMS-ROUTE-B-' || lpad(order_index::text, 3, '0') || '-' || route_index,
        reference_row.id, reference_row.sku, reference_row.ean, reference_row.titolo,
        1, 1, jsonb_build_object('source', 'wms_route_demo', 'fnsku', reference_row.fnsku)
      );
    end loop;
  end loop;
end $$;
