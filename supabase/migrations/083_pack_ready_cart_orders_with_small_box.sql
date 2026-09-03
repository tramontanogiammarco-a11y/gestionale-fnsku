-- Completa informaticamente il packing degli ordini pronti presenti nelle bag dei carrelli.
do $$
declare
  v_now timestamptz := now();
  v_target_count integer;
  v_new_packaging_count integer;
  v_available_boxes integer;
begin
  -- Recupera eventuali sessioni mancanti per missioni Galluse gia completate.
  insert into public.wms_packing_sessions (
    order_id, bag_id, bag_code, packing_sequence, stato, created_at, updated_at
  )
  select
    galluse_order.order_id,
    galluse_order.bag_id,
    galluse_order.bag_code,
    galluse_order.posizione_bag,
    'in_attesa_packing',
    v_now,
    v_now
  from public.wms_galluse_orders galluse_order
  join public.wms_galluse_batches batch on batch.id = galluse_order.batch_id
  join public.shopify_orders orders on orders.id = galluse_order.order_id
  where batch.stato = 'completata'
    and batch.cart_id is not null
    and orders.wms_status in ('in_attesa_packing', 'in_packing')
    and not exists (
      select 1
      from public.wms_packing_sessions existing
      where existing.order_id = galluse_order.order_id
    );

  insert into public.wms_packing_lines (
    session_id, order_item_id, referenza_id, titolo, ean, fnsku, sku,
    foto_url, quantita_attesa, quantita_verificata, verified_at, created_at
  )
  select
    session.id,
    item.id,
    item.referenza_id,
    coalesce(reference.titolo, item.titolo),
    coalesce(reference.ean, item.ean),
    reference.fnsku,
    coalesce(reference.sku, item.sku),
    reference.foto_url,
    item.quantita,
    item.quantita,
    v_now,
    v_now
  from public.wms_packing_sessions session
  join public.shopify_order_items item on item.order_id = session.order_id
  left join public.referenze reference on reference.id = item.referenza_id
  where session.stato not in ('completata', 'annullata')
    and exists (
      select 1
      from public.wms_cart_bag_positions position
      where position.bag_id = session.bag_id
         or position.bag_code = session.bag_code
    )
  on conflict (session_id, order_item_id) do update set
    quantita_verificata = excluded.quantita_attesa,
    verified_at = v_now;

  create temporary table pack_cart_targets_083 on commit drop as
  select distinct
    session.id as session_id,
    session.order_id,
    session.bag_id,
    session.bag_code,
    session.mass_batch_id,
    orders.cliente_id,
    not exists (
      select 1
      from public.wms_order_packaging_usage usage
      where usage.session_id = session.id
    ) as needs_packaging
  from public.wms_packing_sessions session
  join public.shopify_orders orders on orders.id = session.order_id
  where session.stato not in ('completata', 'annullata')
    and orders.wms_status in ('in_attesa_packing', 'in_packing')
    and exists (
      select 1
      from public.wms_cart_bag_positions position
      where position.bag_id = session.bag_id
         or position.bag_code = session.bag_code
    );

  select count(*) into v_target_count from pack_cart_targets_083;
  if v_target_count = 0 then
    raise exception 'Nessun ordine pronto per il packing risulta nei carrelli';
  end if;

  if exists (
    select 1
    from pack_cart_targets_083 target
    join public.wms_order_packaging_usage usage on usage.session_id = target.session_id
    where usage.packaging_code <> 'small_box'
  ) then
    raise exception 'Un ordine nei carrelli ha gia un imballaggio diverso dalla scatola piccola';
  end if;

  select count(*) into v_new_packaging_count
  from pack_cart_targets_083
  where needs_packaging;

  select stock_quantity into v_available_boxes
  from public.wms_packaging_types
  where code = 'small_box' and active
  for update;

  if not found then
    raise exception 'Scatola piccola non disponibile nel catalogo imballaggi';
  end if;
  if v_available_boxes < v_new_packaging_count then
    raise exception 'Scatole piccole insufficienti: richieste %, disponibili %',
      v_new_packaging_count, v_available_boxes;
  end if;

  insert into public.wms_order_packaging_usage (
    session_id, order_id, cliente_id, packaging_code,
    quantity, unit_price_snapshot, operatore_id, scanned_at
  )
  select
    target.session_id,
    target.order_id,
    target.cliente_id,
    'small_box',
    1,
    coalesce((client.listino ->> 'wms_pack_scatola_piccola')::numeric, 0),
    null,
    v_now
  from pack_cart_targets_083 target
  join public.clienti client on client.id = target.cliente_id
  where target.needs_packaging;

  update public.wms_packaging_types
  set stock_quantity = stock_quantity - v_new_packaging_count,
      updated_at = v_now
  where code = 'small_box';

  insert into public.wms_packaging_stock_movements (
    packaging_code, quantity_delta, reason, order_id, session_id, operatore_id, created_at
  )
  select 'small_box', -1, 'packing', order_id, session_id, null, v_now
  from pack_cart_targets_083
  where needs_packaging;

  update public.wms_packing_lines line
  set quantita_verificata = line.quantita_attesa,
      verified_at = coalesce(line.verified_at, v_now)
  from pack_cart_targets_083 target
  where line.session_id = target.session_id;

  update public.wms_packing_sessions session
  set stato = 'completata',
      packaging_code = 'small_box',
      bag_first_scanned_at = coalesce(session.bag_first_scanned_at, v_now),
      bag_double_checked_at = coalesce(session.bag_double_checked_at, v_now),
      packaging_scanned_at = coalesce(session.packaging_scanned_at, v_now),
      carrier_label_code = coalesce(
        session.carrier_label_code,
        'PK-' || upper(substr(replace(session.id::text, '-', ''), 1, 12))
      ),
      carrier_label_printed_at = coalesce(session.carrier_label_printed_at, v_now),
      carrier_label_scanned_at = coalesce(session.carrier_label_scanned_at, v_now),
      started_at = coalesce(session.started_at, v_now),
      completed_at = v_now,
      updated_at = v_now
  from pack_cart_targets_083 target
  where session.id = target.session_id;

  update public.shopify_orders orders
  set wms_status = 'imballato', updated_at = v_now
  from pack_cart_targets_083 target
  where orders.id = target.order_id;

  update public.wms_mass_pick_orders mass_order
  set stato = 'completato'
  from pack_cart_targets_083 target
  where target.mass_batch_id = mass_order.batch_id
    and target.order_id = mass_order.order_id;

  update public.wms_mass_pick_batches batch
  set stato = case
        when exists (
          select 1
          from public.wms_packing_sessions session
          where session.mass_batch_id = batch.id
            and session.stato <> 'completata'
        ) then 'in_packing'
        else 'completata_packing'
      end,
      updated_at = v_now
  where exists (
    select 1 from pack_cart_targets_083 target where target.mass_batch_id = batch.id
  );

  update public.wms_bags bag
  set stato = 'disponibile', updated_at = v_now
  where exists (
      select 1
      from pack_cart_targets_083 target
      where target.bag_id = bag.id
    )
    and not exists (
      select 1
      from public.wms_packing_sessions session
      where session.bag_id = bag.id
        and session.stato not in ('completata', 'annullata')
    );

  if (
    select count(*)
    from pack_cart_targets_083 target
    join public.wms_packing_sessions session on session.id = target.session_id
    join public.shopify_orders orders on orders.id = target.order_id
    join public.wms_order_packaging_usage usage on usage.session_id = target.session_id
    where session.stato = 'completata'
      and orders.wms_status = 'imballato'
      and usage.packaging_code = 'small_box'
  ) <> v_target_count then
    raise exception 'Verifica finale packing carrelli non superata';
  end if;

  raise notice 'Imballati % ordini nei carrelli con scatola piccola', v_target_count;
end;
$$;
