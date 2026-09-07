-- Un ordine Reliefbattery da un pezzo per Toyota Prius III 2009-2016.
do $$
declare
  v_client_id uuid;
  v_request record;
  v_reference public.referenze%rowtype;
  v_product_key text;
  v_order_id uuid;
  v_shop_domain constant text := 'wms-manual-prius-iii-20260907-113.aimago.local';
  v_slot_physical integer;
  v_pallet_physical integer;
  v_slot_reserved integer;
  v_pallet_reserved integer;
  v_queued integer;
  v_slot_available integer;
  v_pallet_available integer;
  v_queue_remaining integer;
  v_refill_quantity integer;
  v_negative_balance boolean;
  v_target_slot_id uuid;
  v_target_slot_code text;
  v_wms_status text;
  v_gate_status text;
  v_reason text;
  v_stock_shortages jsonb;
  v_refill_requirements jsonb;
  v_created integer := 0;
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

  for v_request in
    select * from (values
      (1, 'Batteria ibrida Toyota Prius III 2009-2016', 1,
       'RLB-PRIUS-III-20260907-113', '#RLB-PRIUS-III-001')
    ) as requested(sequence, identifier, quantity, external_id, order_name)
  loop
    if exists (
      select 1
      from public.shopify_orders orders
      where orders.shop_domain = v_shop_domain
        and orders.shopify_order_id = v_request.external_id
    ) then
      continue;
    end if;

    select reference.* into v_reference
    from public.referenze reference
    where reference.cliente_id = v_client_id
      and coalesce(reference.is_bundle, false) = false
      and lower(trim(reference.titolo)) like lower(trim(v_request.identifier)) || '%'
    order by
      case
        when lower(trim(reference.titolo)) = lower(trim(v_request.identifier)) || ' standard' then 0
        else 1
      end,
      reference.created_at
    limit 1;

    if not found then
      raise exception 'Referenza Toyota Prius III 2009-2016 non trovata';
    end if;

    v_product_key := case
      when nullif(trim(v_reference.fnsku), '') is not null then 'fnsku:' || lower(trim(v_reference.fnsku))
      when nullif(trim(v_reference.ean), '') is not null then 'ean:' || lower(trim(v_reference.ean))
      else 'sku:' || lower(trim(v_reference.sku))
    end;

    drop table if exists tmp_requested_bulk_balance;
    create temporary table tmp_requested_bulk_balance on commit drop as
    with deltas as (
      select movement.location_id, sum(movement.quantita)::bigint as quantity
      from public.entrate entry
      join public.entrate_righe line on line.entrata_id = entry.id
      join public.wms_inbound_movements movement on movement.entrata_riga_id = line.id
      where entry.cliente_id = v_client_id
        and entry.stato in ('ricevuto', 'in_lavorazione', 'pronto', 'spedito')
        and movement.disposizione = 'disponibile'
        and movement.location_id is not null
        and (
          (nullif(trim(v_reference.fnsku), '') is not null and lower(trim(line.fnsku)) = lower(trim(v_reference.fnsku)))
          or (nullif(trim(v_reference.ean), '') is not null and lower(trim(line.ean)) = lower(trim(v_reference.ean)))
        )
      group by movement.location_id

      union all

      select location_id, sum(quantita)::bigint
      from public.wms_stock_placements
      where cliente_id = v_client_id and lower(trim(product_key)) = v_product_key
      group by location_id

      union all

      select source_location_id, -sum(quantita)::bigint
      from public.wms_stock_transfers
      where cliente_id = v_client_id and lower(trim(product_key)) = v_product_key
      group by source_location_id

      union all

      select target_location_id, sum(quantita)::bigint
      from public.wms_stock_transfers
      where cliente_id = v_client_id and lower(trim(product_key)) = v_product_key
      group by target_location_id

      union all

      select inventory_count.location_id,
        sum(inventory_count.quantita_contata - inventory_count.quantita_attesa)::bigint
      from public.wms_inventory_counts inventory_count
      join public.wms_inventory_sessions session
        on session.id = inventory_count.session_id and session.stato = 'completata'
      where inventory_count.cliente_id = v_client_id
        and lower(trim(inventory_count.product_key)) = v_product_key
      group by inventory_count.location_id

      union all

      select location_id, -sum(quantita)::bigint
      from public.wms_outbound_movements
      where cliente_id = v_client_id and lower(trim(product_key)) = v_product_key
      group by location_id
    )
    select location_id, sum(quantity)::integer as quantity
    from deltas
    group by location_id;

    select
      coalesce(sum(case when location.tipo = 'slot' and location.stato = 'attiva' then balance.quantity else 0 end), 0),
      coalesce(sum(case when location.tipo = 'pallet' and location.stato = 'attiva' then balance.quantity else 0 end), 0),
      coalesce(bool_or(balance.quantity < 0), false)
    into v_slot_physical, v_pallet_physical, v_negative_balance
    from tmp_requested_bulk_balance balance
    join public.wms_locations location on location.id = balance.location_id;

    with active_reservations as (
      select line.location_id, greatest(0, line.quantita_attesa - line.quantita_prelevata) as quantity
      from public.wms_pick_lines line
      join public.wms_pick_tasks task
        on task.id = line.task_id and task.stato in ('da_prelevare', 'in_corso')
      join public.shopify_orders orders on orders.id = task.order_id
      where orders.cliente_id = v_client_id
        and line.product_key = v_product_key
        and orders.gate_status = 'sbloccato'
        and orders.wms_status in ('da_preparare', 'in_preparazione')

      union all

      select line.location_id, greatest(0, line.quantita_attesa - line.quantita_prelevata)
      from public.wms_mass_pick_lines line
      join public.wms_mass_pick_batches batch
        on batch.id = line.batch_id and batch.stato = 'in_corso'
      where batch.cliente_id = v_client_id and line.product_key = v_product_key

      union all

      select line.location_id, greatest(0, line.quantita_attesa - line.quantita_prelevata)
      from public.wms_galluse_lines line
      join public.wms_galluse_batches batch
        on batch.id = line.batch_id and batch.stato in ('da_associare_bag', 'in_corso')
      where batch.cliente_id = v_client_id and line.product_key = v_product_key

      union all

      select line.source_location_id, line.quantita
      from public.wms_refill_lines line
      where line.cliente_id = v_client_id
        and line.product_key = v_product_key
        and line.stato in ('da_associare_bag', 'da_prelevare', 'in_bag')
    )
    select
      coalesce(sum(case when location.tipo = 'slot' then reservation.quantity else 0 end), 0),
      coalesce(sum(case when location.tipo = 'pallet' then reservation.quantity else 0 end), 0)
    into v_slot_reserved, v_pallet_reserved
    from active_reservations reservation
    join public.wms_locations location
      on location.id = reservation.location_id and location.stato = 'attiva';

    select coalesce(sum(item.quantita), 0)
    into v_queued
    from public.shopify_order_items item
    join public.shopify_orders orders on orders.id = item.order_id
    where orders.cliente_id = v_client_id
      and item.referenza_id = v_reference.id
      and (
        (orders.wms_status = 'da_preparare' and orders.gate_status = 'sbloccato')
        or (orders.wms_status = 'in_attesa_refill' and orders.gate_status = 'attesa_refill')
      );

    v_slot_available := greatest(0, v_slot_physical - v_slot_reserved);
    v_pallet_available := greatest(0, v_pallet_physical - v_pallet_reserved);
    v_queue_remaining := greatest(0, v_queued - v_slot_available);
    v_slot_available := greatest(0, v_slot_available - v_queued);
    v_pallet_available := greatest(0, v_pallet_available - v_queue_remaining);

    select location.id, location.codice
    into v_target_slot_id, v_target_slot_code
    from public.wms_slot_assignments assignment
    join public.wms_locations location on location.id = assignment.location_id
    where assignment.cliente_id = v_client_id
      and lower(trim(assignment.product_key)) = v_product_key
      and location.tipo = 'slot'
      and location.stato = 'attiva'
    order by location.codice
    limit 1;

    if v_target_slot_id is null then
      select location.id, location.codice
      into v_target_slot_id, v_target_slot_code
      from tmp_requested_bulk_balance balance
      join public.wms_locations location on location.id = balance.location_id
      where location.tipo = 'slot'
        and location.stato = 'attiva'
        and balance.quantity > 0
      order by balance.quantity desc, location.codice
      limit 1;
    end if;

    v_stock_shortages := '[]'::jsonb;
    v_refill_requirements := '[]'::jsonb;
    v_refill_quantity := greatest(0, v_request.quantity - v_slot_available);

    if v_negative_balance then
      v_wms_status := 'eccezione';
      v_gate_status := 'eccezione_stock';
      v_reason := 'Saldo fisico negativo: riconciliazione stock necessaria';
      v_stock_shortages := jsonb_build_array(jsonb_build_object(
        'referenza_id', v_reference.id, 'titolo', v_reference.titolo,
        'required', v_request.quantity, 'available', 0,
        'missing', v_request.quantity, 'reason', v_reason
      ));
    elsif v_slot_available >= v_request.quantity then
      v_wms_status := 'da_preparare';
      v_gate_status := 'sbloccato';
      v_reason := 'Controlli automatici superati';
    elsif v_slot_available + v_pallet_available >= v_request.quantity
      and v_target_slot_id is not null then
      v_wms_status := 'in_attesa_refill';
      v_gate_status := 'attesa_refill';
      v_reason := 'Stock disponibile a pallet: rifornimento slot richiesto';
      v_refill_requirements := jsonb_build_array(jsonb_build_object(
        'cliente_id', v_client_id,
        'referenza_id', v_reference.id,
        'product_key', v_product_key,
        'titolo', v_reference.titolo,
        'quantita', v_refill_quantity,
        'pallet_available', v_pallet_available,
        'target_slot', jsonb_build_object('id', v_target_slot_id, 'codice', v_target_slot_code)
      ));
    else
      v_wms_status := 'eccezione';
      v_gate_status := 'eccezione_stock';
      v_reason := case
        when v_target_slot_id is null and v_pallet_available > 0
          then 'Stock a pallet presente ma nessuno slot assegnato alla referenza'
        else 'Stock totale insufficiente'
      end;
      v_stock_shortages := jsonb_build_array(jsonb_build_object(
        'referenza_id', v_reference.id, 'titolo', v_reference.titolo,
        'required', v_request.quantity,
        'available', v_slot_available + v_pallet_available,
        'missing', greatest(0, v_request.quantity - v_slot_available - v_pallet_available),
        'reason', v_reason
      ));
    end if;

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
      v_client_id, v_shop_domain, v_request.external_id, v_request.order_name,
      'paid', null, v_wms_status, v_gate_status,
      case when v_gate_status = 'eccezione_stock' then 'stock' else null end,
      case when v_gate_status = 'eccezione_stock' then jsonb_build_array(v_reason) else '[]'::jsonb end,
      v_stock_shortages, v_refill_requirements,
      now(), case when v_gate_status = 'sbloccato' then now() else null end,
      now() + make_interval(secs => v_request.sequence), 0, 'EUR',
      'Cliente Test Prius III', 'Reliefbattery Test',
      'Via Lanciani 69', '00162', 'Roma', 'RM', 'Italia', 'IT',
      'prius.iii.test@example.com', '33320092016', 'gls',
      4.00, greatest(1, v_request.quantity), 'nazionale',
      jsonb_build_object('carrier', 'gls', 'net', 4.00, 'source', 'manual_test'), now(),
      jsonb_build_object(
        'valid', true,
        'source', 'controllo_server',
        'requires_replenishment', v_gate_status = 'attesa_refill'
      ),
      'Ordine test: ' || v_request.quantity || ' pz di ' || v_reference.titolo,
      jsonb_build_object(
        'source', 'wms_manual_test',
        'requested_identifier', v_request.identifier,
        'requested_quantity', v_request.quantity
      )
    ) returning id into v_order_id;

    insert into public.shopify_order_items (
      order_id, shopify_line_item_id, referenza_id, sku, ean, titolo,
      quantita, fulfillable_quantity, raw
    ) values (
      v_order_id, v_request.external_id || '-1', v_reference.id,
      v_reference.sku, v_reference.ean, v_reference.titolo,
      v_request.quantity, v_request.quantity,
      jsonb_build_object('source', 'wms_manual_test')
    );

    update public.shopify_orders
    set refill_requirements = (
      select coalesce(
        jsonb_agg(item || jsonb_build_object('order_id', v_order_id)),
        '[]'::jsonb
      )
      from jsonb_array_elements(refill_requirements) item
    )
    where id = v_order_id and gate_status = 'attesa_refill';

    insert into public.wms_order_gate_events (
      order_id, cliente_id, from_status, to_status, reason, details
    ) values (
      v_order_id, v_client_id, 'da_verificare', v_gate_status, v_reason,
      jsonb_build_object(
        'source', 'wms_manual_test',
        'identifier', v_request.identifier,
        'quantity', v_request.quantity,
        'referenza_id', v_reference.id,
        'slot_available', v_slot_available,
        'pallet_available', v_pallet_available,
        'queued', v_queued,
        'refill_quantity', v_refill_quantity
      )
    );

    v_created := v_created + 1;
    raise notice 'Creato %: % pz, stato %/%',
      v_request.order_name, v_request.quantity, v_wms_status, v_gate_status;
  end loop;

  if (select count(*) from public.shopify_orders where shop_domain = v_shop_domain) <> 1 then
    raise exception 'Creazione incompleta: atteso 1 ordine';
  end if;

  raise notice 'Ordini creati in questa esecuzione: %', v_created;
end;
$$;
