-- Un ordine Reliefbattery da un pezzo per Toyota Prius II 2004-2009.
do $$
declare
  v_client_id uuid;
  v_reference public.referenze%rowtype;
  v_product_key text;
  v_order_id uuid;
  v_slot_physical integer := 0;
  v_pallet_physical integer := 0;
  v_slot_reserved integer := 0;
  v_pallet_reserved integer := 0;
  v_queued integer := 0;
  v_slot_available integer := 0;
  v_pallet_available integer := 0;
  v_queue_remaining integer := 0;
  v_negative_balance boolean := false;
  v_target_slot_id uuid;
  v_target_slot_code text;
  v_wms_status text;
  v_gate_status text;
  v_reason text;
  v_stock_shortages jsonb := '[]'::jsonb;
  v_refill_requirements jsonb := '[]'::jsonb;
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
    and lower(trim(titolo)) like 'batteria ibrida toyota prius ii 2004-2009%'
    and coalesce(is_bundle, false) = false
  order by case
    when lower(trim(titolo)) = 'batteria ibrida toyota prius ii 2004-2009 standard' then 0
    else 1
  end, created_at
  limit 1;

  if v_reference.id is null then
    raise exception 'Referenza Toyota Prius II 2004-2009 non trovata';
  end if;

  v_product_key := case
    when nullif(trim(v_reference.fnsku), '') is not null then 'fnsku:' || lower(trim(v_reference.fnsku))
    when nullif(trim(v_reference.ean), '') is not null then 'ean:' || lower(trim(v_reference.ean))
    else 'sku:' || lower(trim(v_reference.sku))
  end;

  create temporary table tmp_prius_ii_balance on commit drop as
  with deltas as (
    select m.location_id, sum(m.quantita)::bigint as quantity
    from public.entrate e
    join public.entrate_righe er on er.entrata_id = e.id
    join public.wms_inbound_movements m on m.entrata_riga_id = er.id
    where e.cliente_id = v_client_id
      and e.stato in ('ricevuto', 'in_lavorazione', 'pronto', 'spedito')
      and m.disposizione = 'disponibile'
      and m.location_id is not null
      and (
        (nullif(trim(v_reference.fnsku), '') is not null and lower(trim(er.fnsku)) = lower(trim(v_reference.fnsku)))
        or (nullif(trim(v_reference.ean), '') is not null and lower(trim(er.ean)) = lower(trim(v_reference.ean)))
      )
    group by m.location_id
    union all
    select location_id, sum(quantita)::bigint
    from public.wms_stock_placements
    where cliente_id = v_client_id and product_key = v_product_key
    group by location_id
    union all
    select source_location_id, -sum(quantita)::bigint
    from public.wms_stock_transfers
    where cliente_id = v_client_id and product_key = v_product_key
    group by source_location_id
    union all
    select target_location_id, sum(quantita)::bigint
    from public.wms_stock_transfers
    where cliente_id = v_client_id and product_key = v_product_key
    group by target_location_id
    union all
    select ic.location_id, sum(ic.quantita_contata - ic.quantita_attesa)::bigint
    from public.wms_inventory_counts ic
    join public.wms_inventory_sessions s on s.id = ic.session_id and s.stato = 'completata'
    where ic.cliente_id = v_client_id and ic.product_key = v_product_key
    group by ic.location_id
    union all
    select location_id, -sum(quantita)::bigint
    from public.wms_outbound_movements
    where cliente_id = v_client_id and product_key = v_product_key
    group by location_id
  )
  select location_id, sum(quantity)::integer as quantity
  from deltas
  group by location_id;

  select
    coalesce(sum(case when l.tipo = 'slot' and l.stato = 'attiva' then b.quantity else 0 end), 0),
    coalesce(sum(case when l.tipo = 'pallet' and l.stato = 'attiva' then b.quantity else 0 end), 0),
    coalesce(bool_or(b.quantity < 0), false)
  into v_slot_physical, v_pallet_physical, v_negative_balance
  from tmp_prius_ii_balance b
  join public.wms_locations l on l.id = b.location_id;

  with active_reservations as (
    select pl.location_id, greatest(0, pl.quantita_attesa - pl.quantita_prelevata) as quantity
    from public.wms_pick_lines pl
    join public.wms_pick_tasks pt on pt.id = pl.task_id and pt.stato in ('da_prelevare', 'in_corso')
    join public.shopify_orders o on o.id = pt.order_id
    where o.cliente_id = v_client_id and pl.product_key = v_product_key
      and o.gate_status = 'sbloccato' and o.wms_status in ('da_preparare', 'in_preparazione')
    union all
    select ml.location_id, greatest(0, ml.quantita_attesa - ml.quantita_prelevata)
    from public.wms_mass_pick_lines ml
    join public.wms_mass_pick_batches mb on mb.id = ml.batch_id and mb.stato = 'in_corso'
    where mb.cliente_id = v_client_id and ml.product_key = v_product_key
    union all
    select gl.location_id, greatest(0, gl.quantita_attesa - gl.quantita_prelevata)
    from public.wms_galluse_lines gl
    join public.wms_galluse_batches gb on gb.id = gl.batch_id and gb.stato in ('da_associare_bag', 'in_corso')
    where gb.cliente_id = v_client_id and gl.product_key = v_product_key
  )
  select
    coalesce(sum(case when l.tipo = 'slot' then ar.quantity else 0 end), 0),
    coalesce(sum(case when l.tipo = 'pallet' then ar.quantity else 0 end), 0)
  into v_slot_reserved, v_pallet_reserved
  from active_reservations ar
  join public.wms_locations l on l.id = ar.location_id and l.stato = 'attiva';

  select coalesce(sum(oi.quantita), 0)
  into v_queued
  from public.shopify_order_items oi
  join public.shopify_orders o on o.id = oi.order_id
  where o.cliente_id = v_client_id
    and oi.referenza_id = v_reference.id
    and (
      (o.wms_status = 'da_preparare' and o.gate_status = 'sbloccato')
      or (o.wms_status = 'in_attesa_refill' and o.gate_status = 'attesa_refill')
    );

  v_slot_available := greatest(0, v_slot_physical - v_slot_reserved);
  v_pallet_available := greatest(0, v_pallet_physical - v_pallet_reserved);
  v_queue_remaining := v_queued;
  v_queue_remaining := greatest(0, v_queue_remaining - v_slot_available);
  v_slot_available := greatest(0, v_slot_available - v_queued);
  v_pallet_available := greatest(0, v_pallet_available - v_queue_remaining);

  select l.id, l.codice into v_target_slot_id, v_target_slot_code
  from tmp_prius_ii_balance b
  join public.wms_locations l on l.id = b.location_id
  where l.tipo = 'slot' and l.stato = 'attiva'
  order by b.quantity desc, l.codice
  limit 1;

  if v_negative_balance then
    v_wms_status := 'eccezione';
    v_gate_status := 'eccezione_stock';
    v_reason := 'Saldo fisico negativo: riconciliazione stock necessaria';
    v_stock_shortages := jsonb_build_array(jsonb_build_object(
      'referenza_id', v_reference.id, 'titolo', v_reference.titolo,
      'required', 1, 'available', 0, 'missing', 1, 'reason', v_reason
    ));
  elsif v_slot_available >= 1 then
    v_wms_status := 'da_preparare';
    v_gate_status := 'sbloccato';
    v_reason := 'Controlli automatici superati';
  elsif v_pallet_available >= 1 and v_target_slot_id is not null then
    v_wms_status := 'in_attesa_refill';
    v_gate_status := 'attesa_refill';
    v_reason := 'Stock disponibile a pallet: rifornimento slot richiesto';
    v_refill_requirements := jsonb_build_array(jsonb_build_object(
      'cliente_id', v_client_id, 'referenza_id', v_reference.id,
      'product_key', v_product_key, 'titolo', v_reference.titolo,
      'quantita', 1, 'pallet_available', v_pallet_available,
      'target_slot', jsonb_build_object('id', v_target_slot_id, 'codice', v_target_slot_code)
    ));
  else
    v_wms_status := 'eccezione';
    v_gate_status := 'eccezione_stock';
    v_reason := 'Stock totale insufficiente';
    v_stock_shortages := jsonb_build_array(jsonb_build_object(
      'referenza_id', v_reference.id, 'titolo', v_reference.titolo,
      'required', 1, 'available', v_slot_available + v_pallet_available,
      'missing', greatest(0, 1 - v_slot_available - v_pallet_available),
      'reason', v_reason
    ));
  end if;

  delete from public.shopify_orders
  where cliente_id = v_client_id
    and shop_domain = 'wms-manual-prius-ii-20260904.aimago.local';

  insert into public.shopify_orders (
    cliente_id, shop_domain, shopify_order_id, order_name,
    financial_status, fulfillment_status, wms_status, gate_status,
    exception_type, exception_reasons, stock_shortages, refill_requirements,
    gate_checked_at, unblocked_at, processed_at, total_price, currency,
    ship_name, ship_company, ship_address1, ship_zip, ship_city,
    ship_province, ship_country, ship_country_code,
    customer_email, customer_phone, selected_carrier,
    shipping_price, shipping_billable_weight, shipping_zone,
    shipping_quote, shipping_confirmed_at, address_validation, note, raw
  ) values (
    v_client_id, 'wms-manual-prius-ii-20260904.aimago.local',
    'RLB-PRIUS-II-20260904-001', '#RLB-PRIUS-II-001',
    'paid', null, v_wms_status, v_gate_status,
    case when v_gate_status = 'eccezione_stock' then 'stock' else null end,
    case when v_gate_status = 'eccezione_stock' then jsonb_build_array(v_reference.titolo) else '[]'::jsonb end,
    v_stock_shortages, v_refill_requirements,
    now(), case when v_gate_status = 'sbloccato' then now() else null end,
    now(), 0, 'EUR',
    'Cliente Test Prius II', 'Reliefbattery Test',
    'Via Lanciani 69', '00162', 'Roma', 'RM', 'Italia', 'IT',
    'prius.ii.test@example.com', '3332042009', 'gls',
    4.00, 1, 'nazionale',
    jsonb_build_object('carrier', 'gls', 'net', 4.00, 'source', 'manual_test'), now(),
    jsonb_build_object('valid', true, 'source', 'controllo_server', 'requires_replenishment', v_gate_status = 'attesa_refill'),
    'Ordine test Toyota Prius II 2004-2009, 1 pezzo',
    jsonb_build_object('source', 'wms_manual_test', 'requested_quantity', 1)
  ) returning id into v_order_id;

  insert into public.shopify_order_items (
    order_id, shopify_line_item_id, referenza_id, sku, ean, titolo,
    quantita, fulfillable_quantity, raw
  ) values (
    v_order_id, 'RLB-PRIUS-II-20260904-001-1', v_reference.id,
    v_reference.sku, v_reference.ean, v_reference.titolo, 1, 1,
    jsonb_build_object('source', 'wms_manual_test')
  );

  update public.shopify_orders
  set refill_requirements = (
    select coalesce(jsonb_agg(item || jsonb_build_object('order_id', v_order_id)), '[]'::jsonb)
    from jsonb_array_elements(refill_requirements) item
  )
  where id = v_order_id and gate_status = 'attesa_refill';

  insert into public.wms_order_gate_events (
    order_id, cliente_id, from_status, to_status, reason, details
  ) values (
    v_order_id, v_client_id, 'da_verificare', v_gate_status, v_reason,
    jsonb_build_object(
      'source', 'wms_manual_test',
      'referenza_id', v_reference.id,
      'slot_available', v_slot_available,
      'pallet_available', v_pallet_available,
      'queued', v_queued
    )
  );

  raise notice 'Ordine % creato: stato %, gate %, slot ATP %, pallet ATP %, coda %',
    v_order_id, v_wms_status, v_gate_status, v_slot_available, v_pallet_available, v_queued;
end;
$$;
