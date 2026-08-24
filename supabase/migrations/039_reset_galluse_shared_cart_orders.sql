-- Replace the first Galluse route fixture. The new fixture is intentionally
-- shared: one stop can feed several different physical bags on the cart.
with used_bags as (
  select distinct link.bag_id
  from public.wms_galluse_orders link
  join public.shopify_orders orders on orders.id = link.order_id
  where orders.shop_domain = 'wms-galluse-demo.aimago.local'
    and link.bag_id is not null
)
update public.wms_bags
set stato = 'disponibile', updated_at = now()
where id in (select bag_id from used_bags);

delete from public.wms_packing_sessions
where order_id in (
  select id from public.shopify_orders where shop_domain = 'wms-galluse-demo.aimago.local'
);

delete from public.wms_galluse_batches
where id in (
  select link.batch_id
  from public.wms_galluse_orders link
  join public.shopify_orders orders on orders.id = link.order_id
  where orders.shop_domain = 'wms-galluse-demo.aimago.local'
);

delete from public.shopify_orders
where shop_domain = 'wms-galluse-demo.aimago.local';

-- Remove only the previous Galluse inbound fixture; real and other demo stock
-- are never touched by this reset.
delete from public.entrate
where tracking in ('WMS-GALLUSE-ROUTE-025', 'WMS-GALLUSE-SHARED-025');

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
  -- 25 order lines. Products 1-7 occur in several orders/bags, so the
  -- operator aggregates them at one slot and distributes them across the cart.
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
    demo_client_id, 'pallet', 12, 'WMS-GALLUSE-SHARED-025', 'Demo', 'WMS-GALLUSE-SHARED-025',
    'ricevuto', now(), now(), 'Fixture Galluse: 10 ordini, 25 righe e referenze condivise tra bag'
  ) returning id into demo_entry_id;

  insert into public.wms_inbound_sessions (entrata_id, stato, started_at, completed_at, note)
  values (demo_entry_id, 'completata', now(), now(), 'Ubicazione fixture Galluse condivisa')
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
      and fnsku = 'GALLUSE-SHARED-' || lpad(product_index::text, 3, '0')
    limit 1;

    if demo_reference_id is null then
      insert into public.referenze (cliente_id, titolo, ean, sku, fnsku, origine)
      values (
        demo_client_id,
        'Galluse condiviso prodotto ' || lpad(product_index::text, 2, '0'),
        'GALLUSE-SHARED-EAN-' || lpad(product_index::text, 3, '0'),
        'GALLUSE-SHARED-SKU-' || lpad(product_index::text, 3, '0'),
        'GALLUSE-SHARED-' || lpad(product_index::text, 3, '0'),
        'wms-galluse-demo'
      ) returning id into demo_reference_id;
    end if;

    insert into public.entrate_righe (entrata_id, ean, quantita, quantita_ricevuta, fnsku)
    values (
      demo_entry_id,
      'GALLUSE-SHARED-EAN-' || lpad(product_index::text, 3, '0'),
      100, 100,
      'GALLUSE-SHARED-' || lpad(product_index::text, 3, '0')
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
      'WMS-GALLUSE-SHARED-' || lpad(order_index::text, 3, '0'),
      '#WMS-GALLUSE-' || lpad(order_index::text, 3, '0'),
      'paid', null, 'da_preparare', now() - make_interval(mins => 10 - order_index),
      jsonb_build_object('source', 'wms_galluse_demo', 'cart_position', order_index)
    ) returning id into demo_order_id;

    for product_index in
      select value::integer
      from jsonb_array_elements_text(order_products -> (order_index - 1)) as item(value)
    loop
      select id into demo_reference_id
      from public.referenze
      where cliente_id = demo_client_id
        and fnsku = 'GALLUSE-SHARED-' || lpad(product_index::text, 3, '0');

      insert into public.shopify_order_items (
        order_id, shopify_line_item_id, referenza_id, sku, ean, titolo,
        quantita, fulfillable_quantity, raw
      ) values (
        demo_order_id,
        'WMS-GALLUSE-SHARED-' || lpad(order_index::text, 3, '0') || '-P' || lpad(product_index::text, 3, '0'),
        demo_reference_id,
        'GALLUSE-SHARED-SKU-' || lpad(product_index::text, 3, '0'),
        'GALLUSE-SHARED-EAN-' || lpad(product_index::text, 3, '0'),
        'Galluse condiviso prodotto ' || lpad(product_index::text, 2, '0'),
        1, 1,
        jsonb_build_object('source', 'wms_galluse_demo')
      );
    end loop;
  end loop;
end $$;
