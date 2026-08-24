-- Ten Galluse orders for the fixed ten-bag cart.
-- There are 25 order lines and exactly 50 units: every line asks for 2 units.
-- Products 1-7 are deliberately shared between multiple bags at the same stop.
delete from public.entrate
where tracking in (
  'WMS-GALLUSE-ROUTE-025',
  'WMS-GALLUSE-SHARED-025',
  'WMS-GALLUSE-FIFTY-050'
);

do $$
declare
  demo_client_id uuid;
  demo_entry_id uuid;
  demo_session_id uuid;
  demo_order_id uuid;
  demo_reference_id uuid;
  demo_entry_line_id uuid;
  target_location_id uuid;
  target_codes text[] := array[
    'S1+A1', 'S1+A4', 'S1+A7', 'S1+A10', 'S1+A14', 'S1+A17',
    'S1+A21', 'S1+A24', 'S1+A27', 'S1+A30', 'S1+A34', 'S1+A40'
  ];
  order_products jsonb := '[
    [1, 2, 3], [1, 4, 5], [1, 6, 7], [2, 8, 9], [2, 10, 11],
    [3, 12], [3, 4], [4, 5], [5, 6], [6, 7]
  ]'::jsonb;
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

  insert into public.entrate (
    cliente_id, tipo, colli, ddt, corriere, tracking, stato, data_annuncio, data_ricezione, note
  ) values (
    demo_client_id, 'pallet', 12, 'WMS-GALLUSE-FIFTY-050', 'Demo', 'WMS-GALLUSE-FIFTY-050',
    'ricevuto', now(), now(), 'Fixture Galluse: 10 ordini, 25 righe, 50 pezzi totali'
  ) returning id into demo_entry_id;

  insert into public.wms_inbound_sessions (entrata_id, stato, started_at, completed_at, note)
  values (demo_entry_id, 'completata', now(), now(), 'Stock fixture Galluse 50 pezzi')
  returning id into demo_session_id;

  for product_index in 1..array_length(target_codes, 1) loop
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
      raise exception 'Lo slot % contiene stock di un cliente reale', target_codes[product_index];
    end if;

    select id into demo_reference_id
    from public.referenze
    where cliente_id = demo_client_id
      and fnsku = 'GALLUSE-FIFTY-' || lpad(product_index::text, 3, '0')
    limit 1;

    if demo_reference_id is null then
      insert into public.referenze (cliente_id, titolo, ean, sku, fnsku, origine)
      values (
        demo_client_id,
        'Galluse 50 prodotto ' || lpad(product_index::text, 2, '0'),
        'GALLUSE-FIFTY-EAN-' || lpad(product_index::text, 3, '0'),
        'GALLUSE-FIFTY-SKU-' || lpad(product_index::text, 3, '0'),
        'GALLUSE-FIFTY-' || lpad(product_index::text, 3, '0'),
        'wms-galluse-demo'
      ) returning id into demo_reference_id;
    end if;

    insert into public.entrate_righe (entrata_id, ean, quantita, quantita_ricevuta, fnsku)
    values (
      demo_entry_id,
      'GALLUSE-FIFTY-EAN-' || lpad(product_index::text, 3, '0'),
      100, 100,
      'GALLUSE-FIFTY-' || lpad(product_index::text, 3, '0')
    ) returning id into demo_entry_line_id;

    insert into public.wms_inbound_movements (
      session_id, entrata_riga_id, location_id, disposizione, quantita, codice_scansionato
    ) values (
      demo_session_id, demo_entry_line_id, target_location_id, 'disponibile', 100, target_codes[product_index]
    );
  end loop;

  for order_index in 1..10 loop
    insert into public.shopify_orders (
      cliente_id, shop_domain, shopify_order_id, order_name, financial_status,
      fulfillment_status, wms_status, processed_at, raw
    ) values (
      demo_client_id,
      'wms-galluse-demo.aimago.local',
      'WMS-GALLUSE-FIFTY-' || lpad(order_index::text, 3, '0'),
      '#WMS-GALLUSE-' || lpad(order_index::text, 3, '0'),
      'paid', null, 'da_preparare', now() - make_interval(mins => 10 - order_index),
      jsonb_build_object('source', 'wms_galluse_demo', 'cart_position', order_index, 'units_total', 50)
    ) returning id into demo_order_id;

    for product_index in
      select value::integer
      from jsonb_array_elements_text(order_products -> (order_index - 1)) as item(value)
    loop
      select id into demo_reference_id
      from public.referenze
      where cliente_id = demo_client_id
        and fnsku = 'GALLUSE-FIFTY-' || lpad(product_index::text, 3, '0');

      insert into public.shopify_order_items (
        order_id, shopify_line_item_id, referenza_id, sku, ean, titolo,
        quantita, fulfillable_quantity, raw
      ) values (
        demo_order_id,
        'WMS-GALLUSE-FIFTY-' || lpad(order_index::text, 3, '0') || '-P' || lpad(product_index::text, 3, '0'),
        demo_reference_id,
        'GALLUSE-FIFTY-SKU-' || lpad(product_index::text, 3, '0'),
        'GALLUSE-FIFTY-EAN-' || lpad(product_index::text, 3, '0'),
        'Galluse 50 prodotto ' || lpad(product_index::text, 2, '0'),
        2, 2,
        jsonb_build_object('source', 'wms_galluse_demo')
      );
    end loop;
  end loop;
end $$;
