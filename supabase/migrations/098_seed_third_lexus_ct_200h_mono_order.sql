-- Ordine Reliefbattery mono-prodotto Lexus CT 200h 2010-2012 da un pezzo.
do $$
declare
  v_client_id uuid;
  v_reference public.referenze%rowtype;
  v_order_id uuid;
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

  select * into v_reference
  from public.referenze
  where cliente_id = v_client_id
    and lower(trim(titolo)) like 'batteria ibrida lexus ct 200h 2010-2012%'
    and coalesce(is_bundle, false) = false
  order by case when lower(trim(titolo)) = 'batteria ibrida lexus ct 200h 2010-2012' then 0 else 1 end, created_at
  limit 1;

  if v_reference.id is null then
    raise exception 'Referenza Batteria ibrida Lexus CT 200h 2010-2012 non trovata';
  end if;

  delete from public.shopify_orders
  where cliente_id = v_client_id
    and shop_domain = 'wms-mono-lexus-ct-200h-third.aimago.local';

  insert into public.shopify_orders (
    cliente_id, shop_domain, shopify_order_id, order_name,
    financial_status, fulfillment_status, wms_status, gate_status,
    gate_checked_at, unblocked_at, processed_at, total_price, currency,
    ship_name, ship_company, ship_address1, ship_zip, ship_city,
    ship_province, ship_country, ship_country_code,
    customer_email, customer_phone, selected_carrier,
    shipping_price, shipping_billable_weight, shipping_zone,
    shipping_quote, shipping_confirmed_at, address_validation, note, raw
  ) values (
    v_client_id, 'wms-mono-lexus-ct-200h-third.aimago.local',
    'RLB-MONO-LEXUS-CT-200H-20260904-003', '#RLB-MONO-LEXUS-CT-200H-003',
    'paid', null, 'da_preparare', 'sbloccato', now(), now(), now(), 0, 'EUR',
    'Cliente Test Lexus CT 03', 'Reliefbattery Test',
    'Via Lanciani 69', '00162', 'Roma', 'RM', 'Italia', 'IT',
    'mono.lexus.ct.03@example.com', '3333032003', 'gls', 4.00, 1, 'nazionale',
    jsonb_build_object('carrier', 'gls', 'net', 4.00, 'source', 'mono_lexus_ct_test'), now(),
    jsonb_build_object('valid', true, 'source', 'mono_lexus_ct_test'),
    'Ordine test picking mono-prodotto Lexus CT 200h 2010-2012',
    jsonb_build_object('source', 'wms_mono_lexus_ct_test', 'picking_mode', 'mono')
  ) returning id into v_order_id;

  insert into public.shopify_order_items (
    order_id, shopify_line_item_id, referenza_id, sku, ean, titolo,
    quantita, fulfillable_quantity, raw
  ) values (
    v_order_id, 'RLB-MONO-LEXUS-CT-200H-003-1', v_reference.id,
    v_reference.sku, v_reference.ean, v_reference.titolo, 1, 1,
    jsonb_build_object('source', 'wms_mono_lexus_ct_test')
  );

  insert into public.wms_order_gate_events (
    order_id, cliente_id, from_status, to_status, reason, details
  ) values (
    v_order_id, v_client_id, 'da_verificare', 'sbloccato',
    'Ordine test mono-prodotto verificato',
    jsonb_build_object('source', 'wms_mono_lexus_ct_test', 'referenza_id', v_reference.id)
  );
end;
$$;
