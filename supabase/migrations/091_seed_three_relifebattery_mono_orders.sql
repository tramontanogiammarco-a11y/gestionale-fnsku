-- Tre ordini Reliefbattery aggiuntivi per il picking mono-prodotto.
do $$
declare
  v_client_id uuid;
  v_candidate_count integer;
  v_order_id uuid;
  test_row record;
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
    and shop_domain = 'wms-mono-relifebattery-extra-three.aimago.local';

  create temporary table tmp_mono_extra_selection on commit drop as
  with products as (
    select
      reference.id as reference_id,
      reference.titolo,
      reference.ean,
      reference.sku,
      reference.fnsku,
      case
        when nullif(trim(reference.fnsku), '') is not null then 'fnsku:' || lower(trim(reference.fnsku))
        when nullif(trim(reference.ean), '') is not null then 'ean:' || lower(trim(reference.ean))
        else 'sku:' || lower(trim(reference.sku))
      end as product_key
    from public.referenze reference
    where reference.cliente_id = v_client_id
      and coalesce(reference.is_bundle, false) = false
      and coalesce(nullif(trim(reference.fnsku), ''), nullif(trim(reference.ean), ''), nullif(trim(reference.sku), '')) is not null
  ), deltas as (
    select product.reference_id, movement.location_id, sum(movement.quantita)::bigint as quantity
    from products product
    join public.entrate entry on entry.cliente_id = v_client_id
    join public.entrate_righe entry_row on entry_row.entrata_id = entry.id
      and (
        (nullif(trim(product.fnsku), '') is not null and lower(trim(entry_row.fnsku)) = lower(trim(product.fnsku)))
        or (nullif(trim(product.fnsku), '') is null and lower(trim(entry_row.ean)) = lower(trim(product.ean)))
      )
    join public.wms_inbound_movements movement on movement.entrata_riga_id = entry_row.id
      and movement.disposizione = 'disponibile' and movement.location_id is not null
    group by product.reference_id, movement.location_id
    union all
    select product.reference_id, placement.location_id, sum(placement.quantita)::bigint
    from products product
    join public.wms_stock_placements placement on placement.cliente_id = v_client_id
      and placement.product_key = product.product_key
    group by product.reference_id, placement.location_id
    union all
    select product.reference_id, transfer.source_location_id, -sum(transfer.quantita)::bigint
    from products product
    join public.wms_stock_transfers transfer on transfer.cliente_id = v_client_id
      and transfer.product_key = product.product_key
    group by product.reference_id, transfer.source_location_id
    union all
    select product.reference_id, transfer.target_location_id, sum(transfer.quantita)::bigint
    from products product
    join public.wms_stock_transfers transfer on transfer.cliente_id = v_client_id
      and transfer.product_key = product.product_key
    group by product.reference_id, transfer.target_location_id
    union all
    select product.reference_id, inventory.location_id,
      sum(inventory.quantita_contata - inventory.quantita_attesa)::bigint
    from products product
    join public.wms_inventory_counts inventory on inventory.cliente_id = v_client_id
      and inventory.product_key = product.product_key
    join public.wms_inventory_sessions inventory_session on inventory_session.id = inventory.session_id
      and inventory_session.stato = 'completata'
    group by product.reference_id, inventory.location_id
    union all
    select product.reference_id, outbound.location_id, -sum(outbound.quantita)::bigint
    from products product
    join public.wms_outbound_movements outbound on outbound.cliente_id = v_client_id
      and outbound.product_key = product.product_key
    group by product.reference_id, outbound.location_id
  ), balances as (
    select reference_id, location_id, greatest(0, sum(quantity))::integer as quantity
    from deltas
    group by reference_id, location_id
  ), available as (
    select
      product.*,
      location.id as location_id,
      location.codice as location_code,
      location.map_x,
      location.map_z,
      balance.quantity,
      row_number() over (
        partition by product.reference_id
        order by balance.quantity desc, location.codice
      ) as reference_rank
    from products product
    join balances balance on balance.reference_id = product.reference_id and balance.quantity > 0
    join public.wms_locations location on location.id = balance.location_id
      and location.tipo = 'slot' and location.stato = 'attiva'
    where not exists (
      select 1
      from public.shopify_order_items active_item
      join public.shopify_orders active_order on active_order.id = active_item.order_id
      where active_item.referenza_id = product.reference_id
        and active_order.wms_status not in ('imballato', 'spedito', 'annullato')
    )
  ), ranked as (
    select available.*,
      row_number() over (
        order by md5(available.reference_id::text || 'RLB-MONO-EXTRA-3-B')
      ) as sequence
    from available
    where available.reference_rank = 1
  )
  select sequence::integer, reference_id, titolo, ean, sku, fnsku, location_id, location_code, quantity
  from ranked
  where sequence <= 3
  order by sequence;

  select count(*) into v_candidate_count from tmp_mono_extra_selection;
  if v_candidate_count <> 3 then
    raise exception 'Servono 3 SKU Reliefbattery libere con stock negli slot; trovate %', v_candidate_count;
  end if;

  for test_row in select * from tmp_mono_extra_selection order by sequence loop
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
      v_client_id,
      'wms-mono-relifebattery-extra-three.aimago.local',
      'RLB-MONO-EXTRA3-20260903-' || lpad(test_row.sequence::text, 3, '0'),
      '#RLB-MONO-EXTRA3-' || lpad(test_row.sequence::text, 3, '0'),
      'paid', null, 'da_preparare', 'sbloccato',
      now(), now(), now() - make_interval(secs => 5 - test_row.sequence), 0, 'EUR',
      'Cliente Mono Extra ' || lpad(test_row.sequence::text, 2, '0'), 'Reliefbattery Test',
      'Via Lanciani 69', '00162', 'Roma', 'RM', 'Italia', 'IT',
      'mono.extra3.' || test_row.sequence || '@example.com', '3333030' || lpad(test_row.sequence::text, 3, '0'),
      'gls', 4.00, 1, 'nazionale',
      jsonb_build_object('carrier', 'gls', 'net', 4.00, 'source', 'mono_extra_test'), now(),
      jsonb_build_object('valid', true, 'source', 'mono_extra_test'),
      'Test aggiuntivo picking mono-prodotto: SKU ' || test_row.sku || ' da ' || test_row.location_code,
      jsonb_build_object(
        'source', 'wms_mono_relifebattery_extra',
        'picking_mode', 'mono',
        'expected_location', test_row.location_code
      )
    ) returning id into v_order_id;

    insert into public.shopify_order_items (
      order_id, shopify_line_item_id, referenza_id, sku, ean, titolo,
      quantita, fulfillable_quantity, raw
    ) values (
      v_order_id,
      'RLB-MONO-EXTRA3-' || lpad(test_row.sequence::text, 3, '0') || '-1',
      test_row.reference_id, test_row.sku, test_row.ean, test_row.titolo,
      1, 1,
      jsonb_build_object('source', 'wms_mono_relifebattery_extra', 'expected_location', test_row.location_code)
    );

    insert into public.wms_order_gate_events (
      order_id, cliente_id, from_status, to_status, reason, details
    ) values (
      v_order_id, v_client_id, 'da_verificare', 'sbloccato',
      'Ordine aggiuntivo di test mono-prodotto verificato',
      jsonb_build_object('source', 'wms_mono_relifebattery_extra', 'stock_location', test_row.location_code)
    );
  end loop;

  raise notice 'Creati 3 ordini mono-prodotto Reliefbattery aggiuntivi';
end;
$$;
