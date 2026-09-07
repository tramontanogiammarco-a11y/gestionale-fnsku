-- Compatta le assegnazioni e lo stock slot partendo da S101+A1.
-- L'operazione registra trasferimenti, conserva i saldi e non tocca i pallet.
do $$
declare
  v_product_count integer;
  v_target_count integer;
  v_moved_units bigint;
  v_moved_rows integer;
  v_requeued_orders integer := 0;
  v_active_missions text;
begin
  -- Recupera la missione mono rimasta aperta prima di qualsiasi scansione.
  -- Gli ordini tornano disponibili e il batch resta nello storico come annullato.
  if exists (
    select 1
    from public.wms_mass_pick_batches batch
    where batch.id = 'b517dee0-2985-48a6-a810-e534f2e0412c'
      and batch.stato = 'in_corso'
      and batch.bag_id is null
      and batch.bag_code is null
      and not exists (
        select 1 from public.wms_mass_pick_lines line
        where line.batch_id = batch.id
          and (line.quantita_prelevata > 0 or line.location_confirmed_at is not null)
      )
      and not exists (
        select 1 from public.wms_packing_sessions session
        where session.mass_batch_id = batch.id
      )
  ) then
    update public.shopify_orders orders
    set wms_status = 'da_preparare', updated_at = now()
    where orders.wms_status = 'in_preparazione'
      and exists (
        select 1 from public.wms_mass_pick_orders link
        where link.batch_id = 'b517dee0-2985-48a6-a810-e534f2e0412c'
          and link.order_id = orders.id
      );
    get diagnostics v_requeued_orders = row_count;

    update public.wms_mass_pick_batches
    set stato = 'annullata', completed_at = now(), updated_at = now()
    where id = 'b517dee0-2985-48a6-a810-e534f2e0412c';

    raise notice 'Missione mono vuota recuperata: % ordini rimessi in coda', v_requeued_orders;
  end if;

  select string_agg(mission.kind || ':' || mission.id::text || ':' || mission.status, ', ' order by mission.kind, mission.id)
  into v_active_missions
  from (
    select 'pick' as kind, id, stato as status from public.wms_pick_tasks
    where stato in ('da_prelevare', 'in_corso')
    union all
    select
      'mass' as kind,
      batch.id,
      batch.stato || '/' || batch.picking_mode
        || '/created=' || batch.created_at::text
        || '/bag=' || coalesce(batch.bag_code, '-')
        || '/progress=' || coalesce((
          select sum(line.quantita_prelevata)::text || '/' || sum(line.quantita_attesa)::text
          from public.wms_mass_pick_lines line
          where line.batch_id = batch.id
        ), '0/0')
        || '/confirmed=' || (
          select count(*)::text
          from public.wms_mass_pick_lines line
          where line.batch_id = batch.id
            and line.location_confirmed_at is not null
        )
        || '/orders=' || coalesce((
          select string_agg(
            orders.order_name || '[' || orders.wms_status || '/' || coalesce(orders.gate_status, '-') || ']',
            ';' order by link.packing_sequence
          )
          from public.wms_mass_pick_orders link
          join public.shopify_orders orders on orders.id = link.order_id
          where link.batch_id = batch.id
        ), '-')
        || '/packing=' || (
          select count(*)::text
          from public.wms_packing_sessions session
          where session.mass_batch_id = batch.id
        ) as status
    from public.wms_mass_pick_batches batch
    where stato in ('in_corso', 'da_confermare_bag', 'in_packing')
    union all
    select 'galluse' as kind, id, stato as status from public.wms_galluse_batches
    where stato in ('da_associare_bag', 'in_corso')
    union all
    select 'refill' as kind, mission_id as id, stato as status from public.wms_refill_lines
    where stato in ('da_associare_bag', 'da_prelevare', 'in_bag')
  ) mission;

  if v_active_missions is not null then
    raise exception 'Missioni attive: %. Compattazione annullata', v_active_missions;
  end if;

  create temporary table tmp_slot_balances on commit drop as
  select
    client.id as cliente_id,
    balance.location_id,
    lower(trim(balance.product_key)) as product_key,
    balance.quantity
  from public.clienti client
  cross join lateral public.wms_picking_stock_balances(client.id) balance
  join public.wms_locations location on location.id = balance.location_id
  where location.tipo = 'slot'
    and balance.quantity > 0;

  create temporary table tmp_slot_products on commit drop as
  with products as (
    select cliente_id, product_key from tmp_slot_balances
    union
    select cliente_id, lower(trim(product_key)) from public.wms_slot_assignments
  ), current_positions as (
    select
      product.cliente_id,
      product.product_key,
      min(location.codice) as first_location_code,
      coalesce(sum(balance.quantity), 0)::bigint as slot_quantity
    from products product
    left join tmp_slot_balances balance
      on balance.cliente_id = product.cliente_id
      and balance.product_key = product.product_key
    left join public.wms_locations location on location.id = balance.location_id
    group by product.cliente_id, product.product_key
  )
  select
    cliente_id,
    product_key,
    slot_quantity,
    row_number() over (
      order by first_location_code nulls last, cliente_id, product_key
    )::integer as sequence
  from current_positions;

  create temporary table tmp_target_slots on commit drop as
  select
    location.id as location_id,
    location.codice,
    row_number() over (
      order by
        substring(location.codice from '^S([0-9]+)')::integer,
        substring(location.codice from '[+]([A-Z]+)[0-9]+$'),
        substring(location.codice from '([0-9]+)$')::integer
    )::integer as sequence
  from public.wms_locations location
  where location.tipo = 'slot'
    and location.stato = 'attiva'
    and location.codice ~ '^S[0-9]+[+][A-Z]+[0-9]+$'
    and substring(location.codice from '^S([0-9]+)')::integer >= 101;

  select count(*) into v_product_count from tmp_slot_products;
  select count(*) into v_target_count from tmp_target_slots;

  if v_target_count < v_product_count then
    raise exception 'Slot attivi insufficienti da S101: servono %, disponibili %', v_product_count, v_target_count;
  end if;

  create temporary table tmp_slot_plan on commit drop as
  select
    product.cliente_id,
    product.product_key,
    product.slot_quantity,
    target.location_id as target_location_id,
    target.codice as target_code
  from tmp_slot_products product
  join tmp_target_slots target on target.sequence = product.sequence;

  -- Riassegna prima le destinazioni: i trigger impediscono che due referenze
  -- condividano lo stesso slot durante la registrazione dei trasferimenti.
  delete from public.wms_slot_assignments assignment
  where exists (
    select 1 from tmp_slot_products product
    where product.cliente_id = assignment.cliente_id
      and product.product_key = lower(trim(assignment.product_key))
  ) or exists (
    select 1 from tmp_slot_plan plan
    where plan.target_location_id = assignment.location_id
  );

  insert into public.wms_slot_assignments (location_id, cliente_id, product_key)
  select target_location_id, cliente_id, product_key
  from tmp_slot_plan;

  with moved as (
    insert into public.wms_stock_transfers (
      cliente_id,
      product_key,
      source_location_id,
      target_location_id,
      quantita
    )
    select
      balance.cliente_id,
      balance.product_key,
      balance.location_id,
      plan.target_location_id,
      balance.quantity::integer
    from tmp_slot_balances balance
    join tmp_slot_plan plan
      on plan.cliente_id = balance.cliente_id
      and plan.product_key = balance.product_key
    where balance.location_id <> plan.target_location_id
      and balance.quantity > 0
    returning quantita
  )
  select count(*)::integer, coalesce(sum(quantita), 0)::bigint
  into v_moved_rows, v_moved_units
  from moved;

  create temporary table tmp_compacted_balances on commit drop as
  select
    plan.cliente_id,
    balance.location_id,
    lower(trim(balance.product_key)) as product_key,
    balance.quantity
  from (select distinct cliente_id from tmp_slot_plan) plan
  cross join lateral public.wms_picking_stock_balances(plan.cliente_id) balance
  join public.wms_locations location on location.id = balance.location_id
  where location.tipo = 'slot'
    and balance.quantity > 0;

  if exists (
    select 1
    from tmp_slot_plan plan
    left join (
      select cliente_id, product_key, sum(quantity)::bigint as quantity
      from tmp_compacted_balances
      group by cliente_id, product_key
    ) after_balance
      on after_balance.cliente_id = plan.cliente_id
      and after_balance.product_key = plan.product_key
    where coalesce(after_balance.quantity, 0) <> plan.slot_quantity
  ) then
    raise exception 'Verifica saldi fallita: compattazione annullata';
  end if;

  if exists (
    select 1
    from tmp_compacted_balances balance
    join tmp_slot_plan plan
      on plan.cliente_id = balance.cliente_id
      and plan.product_key = balance.product_key
    where balance.location_id <> plan.target_location_id
  ) then
    raise exception 'Una referenza risulta ancora distribuita su piu slot: compattazione annullata';
  end if;

  raise notice 'Compattazione completata: % referenze, % trasferimenti, % pezzi spostati',
    v_product_count, v_moved_rows, v_moved_units;
end;
$$;
