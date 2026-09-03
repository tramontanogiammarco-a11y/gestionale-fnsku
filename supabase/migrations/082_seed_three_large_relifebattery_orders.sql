-- Tre ordini mirati per verificare gate stock, refill e picking Reliefbattery.
do $$
declare
  v_client_id uuid;
  v_order_id uuid;
  test_row record;
  reference_row record;
begin
  select id into v_client_id
  from public.clienti
  where lower(trim(ragione_sociale)) in ('relifebattery', 'relife battery')
     or lower(trim(email)) in ('relifebattery@gmail.com', 'relifebatterys@gmail.com')
  order by case when lower(trim(ragione_sociale)) = 'relifebattery' then 0 else 1 end
  limit 1;

  if v_client_id is null then
    raise exception 'Cliente Reliefbattery non trovato';
  end if;

  delete from public.shopify_orders
  where cliente_id = v_client_id
    and shop_domain = 'wms-three-lexus-test.aimago.local';

  for test_row in
    select * from (values
      (1, 'SHOPIFY-57783761273219', 'Batteria ibrida Lexus CT 200h 2010-2012 Standard'),
      (2, 'SHOPIFY-57783761568131', 'Batteria ibrida Lexus GS 300h 2013-2019 Standard'),
      (3, 'SHOPIFY-57783761895811', 'Batteria ibrida Lexus GS 450h 2005-2011 Standard')
    ) as requested(order_number, ean, expected_title)
  loop
    select * into reference_row
    from public.referenze
    where cliente_id = v_client_id
      and lower(trim(ean)) = lower(test_row.ean)
    limit 1;

    if reference_row.id is null then
      raise exception 'Referenza Reliefbattery non trovata: %', test_row.expected_title;
    end if;

    insert into public.shopify_orders (
      cliente_id, shop_domain, shopify_order_id, order_name,
      financial_status, fulfillment_status, wms_status, gate_status,
      processed_at, total_price, currency,
      ship_name, ship_company, ship_address1, ship_zip, ship_city,
      ship_province, ship_country, ship_country_code,
      customer_email, customer_phone, note, raw
    ) values (
      v_client_id,
      'wms-three-lexus-test.aimago.local',
      'RLB-LEXUS-20-' || test_row.order_number,
      '#RLB-LEXUS-20-' || test_row.order_number,
      'paid', null, 'in_verifica', 'da_verificare',
      now() - make_interval(secs => 4 - test_row.order_number), 0, 'EUR',
      'Cliente Test Lexus ' || test_row.order_number, 'Reliefbattery Test',
      'Via Lanciani 69', '00162', 'Roma', 'RM', 'Italia', 'IT',
      'test.lexus' || test_row.order_number || '@example.com', '333300200' || test_row.order_number,
      'Test 20 pezzi per flusso stock, refill e picking',
      jsonb_build_object('source', 'wms_three_lexus_test', 'quantity', 20)
    ) returning id into v_order_id;

    insert into public.shopify_order_items (
      order_id, shopify_line_item_id, referenza_id, sku, ean, titolo,
      quantita, fulfillable_quantity, raw
    ) values (
      v_order_id,
      'RLB-LEXUS-20-' || test_row.order_number || '-1',
      reference_row.id, reference_row.sku, reference_row.ean, reference_row.titolo,
      20, 20, jsonb_build_object('source', 'wms_three_lexus_test')
    );
  end loop;

  if (
    select count(*)
    from public.shopify_orders o
    join public.shopify_order_items i on i.order_id = o.id
    where o.cliente_id = v_client_id
      and o.shop_domain = 'wms-three-lexus-test.aimago.local'
      and i.quantita = 20
  ) <> 3 then
    raise exception 'Verifica finale ordini Lexus non superata';
  end if;

  raise notice 'Creati 3 ordini Reliefbattery Lexus da 20 pezzi in verifica automatica';
end;
$$;
