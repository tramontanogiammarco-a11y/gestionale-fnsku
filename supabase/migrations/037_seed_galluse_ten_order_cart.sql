-- Ten distinct 1x1 demo orders for the Galluse cart workflow.
-- Five orders have three lines and five have two: 25 order lines in total.
do $$
declare
  demo_client_id uuid;
  reference_ids uuid[];
  reference_count integer;
  demo_order_id uuid;
  reference_row record;
  order_index integer;
  line_index integer;
  line_count integer;
  reference_index integer;
begin
  select id into demo_client_id
  from public.clienti
  where ragione_sociale = 'WMS Demo Picking'
  limit 1;

  if demo_client_id is null then
    raise exception 'Cliente demo WMS non trovato';
  end if;

  select array_agg(id order by fnsku) into reference_ids
  from public.referenze
  where cliente_id = demo_client_id
    and origine = 'wms-mass-demo';

  reference_count := coalesce(array_length(reference_ids, 1), 0);
  if reference_count < 3 then
    raise exception 'Servono almeno 3 referenze demo per il Metodo Galluse';
  end if;

  for order_index in 1..10 loop
    if exists (
      select 1
      from public.shopify_orders
      where cliente_id = demo_client_id
        and shop_domain = 'wms-galluse-demo.aimago.local'
        and shopify_order_id = 'WMS-GALLUSE-' || lpad(order_index::text, 3, '0')
    ) then
      continue;
    end if;

    insert into public.shopify_orders (
      cliente_id, shop_domain, shopify_order_id, order_name, financial_status,
      fulfillment_status, wms_status, processed_at, raw
    ) values (
      demo_client_id,
      'wms-galluse-demo.aimago.local',
      'WMS-GALLUSE-' || lpad(order_index::text, 3, '0'),
      '#WMS-GALLUSE-' || lpad(order_index::text, 3, '0'),
      'paid',
      null,
      'da_preparare',
      now() - make_interval(mins => 10 - order_index),
      jsonb_build_object('source', 'wms_galluse_demo', 'cart_position', order_index)
    ) returning id into demo_order_id;

    line_count := case when order_index <= 5 then 3 else 2 end;
    for line_index in 1..line_count loop
      reference_index := ((order_index * 3 + line_index - 2) % reference_count) + 1;
      select * into reference_row
      from public.referenze
      where id = reference_ids[reference_index];

      insert into public.shopify_order_items (
        order_id, shopify_line_item_id, referenza_id, sku, ean, titolo,
        quantita, fulfillable_quantity, raw
      ) values (
        demo_order_id,
        'WMS-GALLUSE-' || lpad(order_index::text, 3, '0') || '-L' || line_index,
        reference_row.id,
        reference_row.sku,
        reference_row.ean,
        reference_row.titolo,
        case when line_index = 1 then order_index else 1 end,
        case when line_index = 1 then order_index else 1 end,
        jsonb_build_object('source', 'wms_galluse_demo', 'fnsku', reference_row.fnsku)
      );
    end loop;
  end loop;
end $$;
