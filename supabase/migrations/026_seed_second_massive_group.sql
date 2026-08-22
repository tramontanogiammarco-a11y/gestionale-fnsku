do $$
declare
  demo_client_id uuid;
  reference_ids uuid[];
  demo_order_id uuid;
  order_index integer;
  line_index integer;
  reference_row record;
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

  if coalesce(array_length(reference_ids, 1), 0) < 9 then
    raise exception 'Servono almeno 9 referenze demo per il secondo gruppo Massivo';
  end if;

  for order_index in 31..36 loop
    if exists (
      select 1 from public.shopify_orders
      where shopify_order_id = 'WMS-MASS-' || lpad(order_index::text, 3, '0')
    ) then
      continue;
    end if;

    insert into public.shopify_orders (
      cliente_id, shop_domain, shopify_order_id, order_name, financial_status,
      fulfillment_status, wms_status, processed_at, raw
    ) values (
      demo_client_id, 'wms-mass-demo.aimago.local',
      'WMS-MASS-' || lpad(order_index::text, 3, '0'), '#WMS-MASS-' || lpad(order_index::text, 3, '0'),
      'paid', null, 'da_preparare', now() - make_interval(mins => 37 - order_index),
      jsonb_build_object('source', 'wms_mass_demo', 'group', 'six-references')
    ) returning id into demo_order_id;

    for line_index in 4..9 loop
      select * into reference_row from public.referenze where id = reference_ids[line_index];
      insert into public.shopify_order_items (
        order_id, shopify_line_item_id, referenza_id, sku, ean, titolo,
        quantita, fulfillable_quantity, raw
      ) values (
        demo_order_id,
        'WMS-MASS-' || lpad(order_index::text, 3, '0') || '-' || line_index,
        reference_row.id, reference_row.sku, reference_row.ean, reference_row.titolo,
        1, 1, jsonb_build_object('source', 'wms_mass_demo', 'fnsku', reference_row.fnsku)
      );
    end loop;
  end loop;
end $$;
