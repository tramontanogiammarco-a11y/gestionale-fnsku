-- Sposta lo stock slot Relifebattery nei blocchi S101-S120 e prepara
-- 30 ordini distinti per provare tre carrelli Galluse consecutivi.
do $$
declare
  v_client_id uuid;
  v_target_slot_id uuid;
  v_reference_count integer;
  v_source_slot_count integer := 0;
  v_moved_units integer := 0;
  v_pair_count integer;
  v_order_id uuid;
  v_order_index integer;
  product_row record;
  source_row record;
  pair_row record;
begin
  select id into v_client_id
  from public.clienti
  where lower(trim(ragione_sociale)) in ('relifebattery', 'relife battery')
     or lower(trim(email)) in ('relifebattery@gmail.com', 'relifebatterys@gmail.com')
  order by case when lower(trim(ragione_sociale)) = 'relifebattery' then 0 else 1 end
  limit 1;

  if v_client_id is null then
    raise exception 'Cliente Relifebattery non trovato';
  end if;

  if exists (
    select 1
    from public.wms_pick_tasks task
    join public.shopify_orders order_row on order_row.id = task.order_id
    where order_row.cliente_id = v_client_id
      and task.stato in ('da_prelevare', 'in_corso')
  ) or exists (
    select 1 from public.wms_mass_pick_batches
    where cliente_id = v_client_id and stato in ('in_corso', 'da_confermare_bag', 'in_packing')
  ) or exists (
    select 1 from public.wms_galluse_batches
    where cliente_id = v_client_id and stato in ('da_associare_bag', 'in_corso')
  ) or exists (
    select 1 from public.wms_refill_lines
    where cliente_id = v_client_id and stato in ('da_associare_bag', 'da_prelevare', 'in_bag')
  ) then
    raise exception 'Relifebattery ha una missione attiva: completa o annulla il lavoro prima di spostare lo stock';
  end if;

  create temporary table tmp_rlb_products on commit drop as
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
    and coalesce(nullif(trim(reference.fnsku), ''), nullif(trim(reference.ean), ''), nullif(trim(reference.sku), '')) is not null;

  create temporary table tmp_rlb_balances (
    reference_id uuid not null,
    location_id uuid not null,
    quantity integer not null,
    primary key (reference_id, location_id)
  ) on commit drop;

  insert into tmp_rlb_balances (reference_id, location_id, quantity)
  select product.reference_id, movement.location_id, sum(movement.quantita)::integer
  from tmp_rlb_products product
  join public.entrate entry on entry.cliente_id = v_client_id
  join public.entrate_righe entry_row on entry_row.entrata_id = entry.id
    and (
      (nullif(trim(product.fnsku), '') is not null and lower(trim(entry_row.fnsku)) = lower(trim(product.fnsku)))
      or (nullif(trim(product.fnsku), '') is null and lower(trim(entry_row.ean)) = lower(trim(product.ean)))
    )
  join public.wms_inbound_movements movement on movement.entrata_riga_id = entry_row.id
    and movement.disposizione = 'disponibile' and movement.location_id is not null
  group by product.reference_id, movement.location_id
  on conflict (reference_id, location_id) do update
    set quantity = tmp_rlb_balances.quantity + excluded.quantity;

  insert into tmp_rlb_balances (reference_id, location_id, quantity)
  select product.reference_id, placement.location_id, sum(placement.quantita)::integer
  from tmp_rlb_products product
  join public.wms_stock_placements placement on placement.cliente_id = v_client_id
    and placement.product_key = product.product_key
  group by product.reference_id, placement.location_id
  on conflict (reference_id, location_id) do update
    set quantity = tmp_rlb_balances.quantity + excluded.quantity;

  insert into tmp_rlb_balances (reference_id, location_id, quantity)
  select product.reference_id, transfer.source_location_id, -sum(transfer.quantita)::integer
  from tmp_rlb_products product
  join public.wms_stock_transfers transfer on transfer.cliente_id = v_client_id
    and transfer.product_key = product.product_key
  group by product.reference_id, transfer.source_location_id
  on conflict (reference_id, location_id) do update
    set quantity = tmp_rlb_balances.quantity + excluded.quantity;

  insert into tmp_rlb_balances (reference_id, location_id, quantity)
  select product.reference_id, transfer.target_location_id, sum(transfer.quantita)::integer
  from tmp_rlb_products product
  join public.wms_stock_transfers transfer on transfer.cliente_id = v_client_id
    and transfer.product_key = product.product_key
  group by product.reference_id, transfer.target_location_id
  on conflict (reference_id, location_id) do update
    set quantity = tmp_rlb_balances.quantity + excluded.quantity;

  insert into tmp_rlb_balances (reference_id, location_id, quantity)
  select product.reference_id, inventory.location_id,
    sum(inventory.quantita_contata - inventory.quantita_attesa)::integer
  from tmp_rlb_products product
  join public.wms_inventory_counts inventory on inventory.cliente_id = v_client_id
    and inventory.product_key = product.product_key
  join public.wms_inventory_sessions inventory_session on inventory_session.id = inventory.session_id
    and inventory_session.stato = 'completata'
  group by product.reference_id, inventory.location_id
  on conflict (reference_id, location_id) do update
    set quantity = tmp_rlb_balances.quantity + excluded.quantity;

  insert into tmp_rlb_balances (reference_id, location_id, quantity)
  select product.reference_id, outbound.location_id, -sum(outbound.quantita)::integer
  from tmp_rlb_products product
  join public.wms_outbound_movements outbound on outbound.cliente_id = v_client_id
    and outbound.product_key = product.product_key
  group by product.reference_id, outbound.location_id
  on conflict (reference_id, location_id) do update
    set quantity = tmp_rlb_balances.quantity + excluded.quantity;

  update tmp_rlb_balances set quantity = greatest(0, quantity);

  create temporary table tmp_used_target_slots (
    location_id uuid primary key,
    reference_id uuid not null
  ) on commit drop;

  create temporary table tmp_all_slot_occupancy (
    location_id uuid primary key,
    occupied boolean not null
  ) on commit drop;

  -- Una posizione e libera se il saldo corrente di ogni cliente/referenza e zero.
  -- Riutilizziamo anche slot con storico, senza confondere "usato" con "occupato".
  with products as (
    select reference.id as reference_id, reference.cliente_id, reference.ean, reference.fnsku,
      case
        when nullif(trim(reference.fnsku), '') is not null then 'fnsku:' || lower(trim(reference.fnsku))
        when nullif(trim(reference.ean), '') is not null then 'ean:' || lower(trim(reference.ean))
        else 'sku:' || lower(trim(reference.sku))
      end as product_key
    from public.referenze reference
    where coalesce(reference.is_bundle, false) = false
      and coalesce(nullif(trim(reference.fnsku), ''), nullif(trim(reference.ean), ''), nullif(trim(reference.sku), '')) is not null
  ), deltas as (
    select product.cliente_id, product.product_key, movement.location_id, sum(movement.quantita)::bigint as quantity
    from products product
    join public.entrate entry on entry.cliente_id = product.cliente_id
    join public.entrate_righe entry_row on entry_row.entrata_id = entry.id
      and (
        (nullif(trim(product.fnsku), '') is not null and lower(trim(entry_row.fnsku)) = lower(trim(product.fnsku)))
        or (nullif(trim(product.fnsku), '') is null and lower(trim(entry_row.ean)) = lower(trim(product.ean)))
      )
    join public.wms_inbound_movements movement on movement.entrata_riga_id = entry_row.id
      and movement.disposizione = 'disponibile' and movement.location_id is not null
    group by product.cliente_id, product.product_key, movement.location_id
    union all
    select placement.cliente_id, placement.product_key, placement.location_id, sum(placement.quantita)::bigint
    from public.wms_stock_placements placement
    group by placement.cliente_id, placement.product_key, placement.location_id
    union all
    select transfer.cliente_id, transfer.product_key, transfer.source_location_id, -sum(transfer.quantita)::bigint
    from public.wms_stock_transfers transfer
    group by transfer.cliente_id, transfer.product_key, transfer.source_location_id
    union all
    select transfer.cliente_id, transfer.product_key, transfer.target_location_id, sum(transfer.quantita)::bigint
    from public.wms_stock_transfers transfer
    group by transfer.cliente_id, transfer.product_key, transfer.target_location_id
    union all
    select inventory.cliente_id, inventory.product_key, inventory.location_id,
      sum(inventory.quantita_contata - inventory.quantita_attesa)::bigint
    from public.wms_inventory_counts inventory
    join public.wms_inventory_sessions inventory_session on inventory_session.id = inventory.session_id
      and inventory_session.stato = 'completata'
    group by inventory.cliente_id, inventory.product_key, inventory.location_id
    union all
    select outbound.cliente_id, outbound.product_key, outbound.location_id, -sum(outbound.quantita)::bigint
    from public.wms_outbound_movements outbound
    group by outbound.cliente_id, outbound.product_key, outbound.location_id
  ), balances as (
    select cliente_id, product_key, location_id, greatest(0, sum(quantity)) as quantity
    from deltas
    group by cliente_id, product_key, location_id
  )
  insert into tmp_all_slot_occupancy (location_id, occupied)
  select location.id, coalesce(bool_or(balance.quantity > 0), false)
  from public.wms_locations location
  left join balances balance on balance.location_id = location.id
  where location.tipo = 'slot'
  group by location.id;

  for product_row in
    select product.reference_id, product.product_key
    from tmp_rlb_products product
    where exists (
      select 1 from tmp_rlb_balances balance
      join public.wms_locations location on location.id = balance.location_id
      where balance.reference_id = product.reference_id
        and balance.quantity > 0 and location.tipo = 'slot'
    )
    order by md5(product.reference_id::text || 'S101-S120')
  loop
    v_target_slot_id := null;

    select balance.location_id into v_target_slot_id
    from tmp_rlb_balances balance
    join public.wms_locations location on location.id = balance.location_id
    where balance.reference_id = product_row.reference_id
      and balance.quantity > 0
      and location.tipo = 'slot'
      and location.stato = 'attiva'
      and location.codice ~ '^S(10[1-9]|11[0-9]|120)[+]'
      and not exists (select 1 from tmp_used_target_slots used where used.location_id = location.id)
    order by balance.quantity desc, location.codice
    limit 1;

    if v_target_slot_id is null then
      select location.id into v_target_slot_id
      from public.wms_locations location
      where location.tipo = 'slot'
        and location.stato = 'attiva'
        and location.codice ~ '^S(10[1-9]|11[0-9]|120)[+]'
        and not exists (select 1 from tmp_used_target_slots used where used.location_id = location.id)
        and coalesce((select occupancy.occupied from tmp_all_slot_occupancy occupancy where occupancy.location_id = location.id), false) = false
      order by md5(location.id::text || product_row.reference_id::text || 'RLB-20260903')
      limit 1;
    end if;

    if v_target_slot_id is null then
      raise exception 'Slot libero insufficiente nei blocchi S101-S120';
    end if;

    insert into tmp_used_target_slots (location_id, reference_id)
    values (v_target_slot_id, product_row.reference_id);

    for source_row in
      select balance.location_id, balance.quantity
      from tmp_rlb_balances balance
      join public.wms_locations location on location.id = balance.location_id
      where balance.reference_id = product_row.reference_id
        and balance.quantity > 0
        and location.tipo = 'slot'
        and balance.location_id <> v_target_slot_id
      order by location.codice
    loop
      insert into public.wms_stock_transfers (
        cliente_id, product_key, source_location_id, target_location_id, quantita
      ) values (
        v_client_id, product_row.product_key, source_row.location_id, v_target_slot_id, source_row.quantity
      );

      insert into tmp_rlb_balances (reference_id, location_id, quantity)
      values (product_row.reference_id, v_target_slot_id, source_row.quantity)
      on conflict (reference_id, location_id) do update
        set quantity = tmp_rlb_balances.quantity + excluded.quantity;
      update tmp_rlb_balances set quantity = 0
      where reference_id = product_row.reference_id and location_id = source_row.location_id;

      v_source_slot_count := v_source_slot_count + 1;
      v_moved_units := v_moved_units + source_row.quantity;
    end loop;
  end loop;

  select count(*) into v_reference_count from tmp_used_target_slots;
  if v_reference_count < 9 then
    raise exception 'Servono almeno 9 referenze ubicate per creare 30 ordini Galluse distinti; trovate %', v_reference_count;
  end if;

  create temporary table tmp_rlb_order_pairs on commit drop as
  select row_number() over (order by md5(a.reference_id::text || b.reference_id::text || 'GALLUSE-30'))::integer as sequence,
    a.reference_id as first_reference_id,
    b.reference_id as second_reference_id
  from tmp_used_target_slots a
  join tmp_used_target_slots b on a.reference_id < b.reference_id
  order by md5(a.reference_id::text || b.reference_id::text || 'GALLUSE-30')
  limit 30;

  select count(*) into v_pair_count from tmp_rlb_order_pairs;
  if v_pair_count <> 30 then
    raise exception 'Impossibile creare 30 combinazioni Galluse distinte; disponibili %', v_pair_count;
  end if;

  if exists (
    with demand as (
      select reference_id, count(*)::integer as required
      from (
        select first_reference_id as reference_id from tmp_rlb_order_pairs
        union all
        select second_reference_id from tmp_rlb_order_pairs
      ) rows
      group by reference_id
    ), slot_stock as (
      select balance.reference_id, sum(balance.quantity)::integer as available
      from tmp_rlb_balances balance
      join public.wms_locations location on location.id = balance.location_id
      where location.tipo = 'slot' and balance.quantity > 0
      group by balance.reference_id
    )
    select 1 from demand
    left join slot_stock using (reference_id)
    where demand.required > coalesce(slot_stock.available, 0)
  ) then
    raise exception 'Stock slot insufficiente per distribuire i 30 ordini Galluse';
  end if;

  delete from public.shopify_orders
  where cliente_id = v_client_id
    and shop_domain = 'wms-galluse-relifebattery-demo.aimago.local';

  for pair_row in select * from tmp_rlb_order_pairs order by sequence loop
    v_order_index := pair_row.sequence;
    insert into public.shopify_orders (
      cliente_id, shop_domain, shopify_order_id, order_name,
      financial_status, fulfillment_status, wms_status, gate_status,
      gate_checked_at, unblocked_at, processed_at, total_price, currency,
      ship_name, ship_company, ship_address1, ship_zip, ship_city,
      ship_province, ship_country, ship_country_code,
      selected_carrier, shipping_price, shipping_billable_weight,
      shipping_zone, shipping_quote, shipping_confirmed_at,
      address_validation, raw
    ) values (
      v_client_id,
      'wms-galluse-relifebattery-demo.aimago.local',
      'RLB-GALLUSE-20260903-' || lpad(v_order_index::text, 3, '0'),
      '#RLB-GALLUSE-' || lpad(v_order_index::text, 3, '0'),
      'paid', null, 'da_preparare', 'sbloccato',
      now(), now(), now() - make_interval(secs => v_order_index), 0, 'EUR',
      'Cliente Test ' || lpad(v_order_index::text, 2, '0'), 'Relifebattery Test',
      'Via Lanciani 69', '00162', 'Roma', 'RM', 'Italia', 'IT',
      'gls', 5.90, 1, 'nazionale',
      jsonb_build_object('carrier', 'gls', 'net', 5.90, 'source', 'galluse_test'), now(),
      jsonb_build_object('valid', true, 'source', 'galluse_test'),
      jsonb_build_object('source', 'wms_galluse_relifebattery_demo', 'cart_test', true)
    ) returning id into v_order_id;

    insert into public.shopify_order_items (
      order_id, shopify_line_item_id, referenza_id, sku, ean, titolo,
      quantita, fulfillable_quantity, raw
    )
    select
      v_order_id,
      'RLB-GALLUSE-' || lpad(v_order_index::text, 3, '0') || '-' || item.position,
      product.reference_id,
      product.sku,
      product.ean,
      product.titolo,
      1, 1,
      jsonb_build_object('source', 'wms_galluse_relifebattery_demo')
    from (
      values (1, pair_row.first_reference_id), (2, pair_row.second_reference_id)
    ) as item(position, reference_id)
    join tmp_rlb_products product on product.reference_id = item.reference_id;
  end loop;

  raise notice 'Relifebattery: % referenze consolidate in S101-S120; % pezzi mossi da % slot; 30 ordini Galluse creati',
    v_reference_count, v_moved_units, v_source_slot_count;
end;
$$;
