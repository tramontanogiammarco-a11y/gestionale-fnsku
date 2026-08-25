-- Replace the Galluse demo queue with three cart tasks where every SKU is shared by at least two bag positions.
do $$
declare
  demo_client_id uuid;
  demo_order_id uuid;
  demo_reference_id uuid;
  cart_index integer;
  order_index integer;
  product_index integer;
  mapped_product_index integer;
  order_products jsonb := '[[1, 2, 3], [1, 4, 5], [1, 6, 7], [2, 4, 8], [2, 5, 9], [3, 6, 10], [3, 7], [4, 8], [5, 9], [10]]'::jsonb;
begin
  select id into demo_client_id from public.clienti where ragione_sociale = 'WMS Demo Picking' limit 1;
  if demo_client_id is null then raise exception 'Cliente demo WMS non trovato'; end if;

  update public.wms_bags set stato = 'disponibile', updated_at = now()
  where id in (
    select link.bag_id from public.wms_galluse_orders link
    join public.shopify_orders demo_order on demo_order.id = link.order_id
    where demo_order.shop_domain = 'wms-galluse-demo.aimago.local' and link.bag_id is not null
  );
  delete from public.wms_packing_sessions where order_id in (
    select id from public.shopify_orders where shop_domain = 'wms-galluse-demo.aimago.local'
  );
  delete from public.shopify_orders where shop_domain = 'wms-galluse-demo.aimago.local';
  delete from public.wms_galluse_batches batch
  where batch.cliente_id = demo_client_id
    and not exists (select 1 from public.wms_galluse_orders link where link.batch_id = batch.id);

  for cart_index in 1..3 loop
    for order_index in 1..10 loop
      insert into public.shopify_orders (
        cliente_id, shop_domain, shopify_order_id, order_name, financial_status,
        fulfillment_status, wms_status, processed_at, raw
      ) values (
        demo_client_id,
        'wms-galluse-demo.aimago.local',
        'WMS-GALLUSE-SHARED-' || cart_index || '-' || lpad(order_index::text, 3, '0'),
        '#GALLUSE-C' || cart_index || '-' || lpad(order_index::text, 3, '0'),
        'paid', null, 'da_preparare', now() - make_interval(mins => ((cart_index - 1) * 20) + order_index),
        jsonb_build_object('source', 'wms_galluse_demo', 'cart', cart_index, 'cart_position', order_index, 'order_lines', 25, 'units_total', 50)
      ) returning id into demo_order_id;
      for product_index in select value::integer from jsonb_array_elements_text(order_products -> (order_index - 1)) as item(value) loop
        -- Rotate the SKU set for each cart so equal order signatures never
        -- get mistaken for a Massivo group across the three carts.
        mapped_product_index := ((product_index - 1 + ((cart_index - 1) * 3)) % 10) + 1;
        select id into demo_reference_id from public.referenze
        where cliente_id = demo_client_id and fnsku = 'GALLUSE-CART-' || lpad(mapped_product_index::text, 3, '0');
        if demo_reference_id is null then raise exception 'Referenza demo Galluse % non trovata', mapped_product_index; end if;
        insert into public.shopify_order_items (
          order_id, shopify_line_item_id, referenza_id, sku, ean, titolo,
          quantita, fulfillable_quantity, raw
        ) values (
          demo_order_id,
          'WMS-GALLUSE-SHARED-' || cart_index || '-' || lpad(order_index::text, 3, '0') || '-P' || lpad(mapped_product_index::text, 3, '0'),
          demo_reference_id,
          'GALLUSE-CART-SKU-' || lpad(mapped_product_index::text, 3, '0'),
          'GALLUSE-CART-EAN-' || lpad(mapped_product_index::text, 3, '0'),
          'Galluse carrello prodotto ' || lpad(mapped_product_index::text, 2, '0'),
          2, 2,
          jsonb_build_object('source', 'wms_galluse_demo', 'cart', cart_index)
        );
      end loop;
    end loop;
  end loop;
end $$;
