-- Porta ogni referenza Relifebattery a 20 pezzi complessivi negli slot,
-- usando l'overstock gia presente nei pallet senza creare nuova giacenza.
do $$
declare
  v_client_id uuid;
  v_adjustment_entry_id uuid;
  v_adjustment_session_id uuid;
  v_entry_row_id uuid;
  v_target_slot_id uuid;
  v_target_pallet_id uuid;
  v_slot_total integer;
  v_delta integer;
  v_move integer;
  v_references integer := 0;
  v_transferred integer := 0;
  v_loaded integer := 0;
  product_row record;
  source_row record;
begin
  select id
  into v_client_id
  from public.clienti
  where lower(trim(ragione_sociale)) in ('relifebattery', 'relife battery')
     or lower(trim(email)) in ('relifebattery@gmail.com', 'relifebatterys@gmail.com')
  order by case when lower(trim(ragione_sociale)) = 'relifebattery' then 0 else 1 end
  limit 1;

  if v_client_id is null then
    raise exception 'Cliente Relifebattery non trovato';
  end if;

  create temporary table tmp_rlb_products on commit drop as
  select
    reference.id as reference_id,
    case
      when nullif(trim(reference.fnsku), '') is not null then 'fnsku:' || lower(trim(reference.fnsku))
      else 'ean:' || lower(trim(reference.ean))
    end as product_key
  from public.referenze reference
  where reference.cliente_id = v_client_id
    and coalesce(reference.is_bundle, false) = false
    and (nullif(trim(reference.fnsku), '') is not null or nullif(trim(reference.ean), '') is not null);

  if not exists (select 1 from tmp_rlb_products) then
    raise exception 'Nessuna referenza valida trovata per Relifebattery';
  end if;

  insert into public.entrate (
    cliente_id, tipo, colli, ddt, corriere, tracking, stato,
    data_annuncio, data_ricezione, note
  ) values (
    v_client_id, 'pallet', 1, 'RLB-SLOT-RESTOCK-20-20260902',
    'Rettifica WMS', 'RLB-SLOT-RESTOCK-20-20260902', 'ricevuto',
    now(), now(), 'Completamento stock slot Relifebattery a 20 pezzi per referenza'
  ) returning id into v_adjustment_entry_id;

  insert into public.wms_inbound_sessions (
    entrata_id, stato, started_at, completed_at, note
  ) values (
    v_adjustment_entry_id, 'completata', now(), now(),
    'Carico delle sole quantita non disponibili nell overstock pallet'
  ) returning id into v_adjustment_session_id;

  create temporary table tmp_rlb_balances (
    reference_id uuid not null,
    location_id uuid not null,
    quantity integer not null,
    primary key (reference_id, location_id)
  ) on commit drop;

  insert into tmp_rlb_balances (reference_id, location_id, quantity)
  select
    product.reference_id,
    movement.location_id,
    sum(movement.quantita)::integer
  from tmp_rlb_products product
  join public.referenze reference on reference.id = product.reference_id
  join public.entrate entry on entry.cliente_id = v_client_id
  join public.entrate_righe entry_row
    on entry_row.entrata_id = entry.id
   and (
     (nullif(trim(reference.fnsku), '') is not null and lower(trim(entry_row.fnsku)) = lower(trim(reference.fnsku)))
     or
     (nullif(trim(reference.fnsku), '') is null and lower(trim(entry_row.ean)) = lower(trim(reference.ean)))
   )
  join public.wms_inbound_movements movement
    on movement.entrata_riga_id = entry_row.id
   and movement.disposizione = 'disponibile'
   and movement.location_id is not null
  group by product.reference_id, movement.location_id
  on conflict (reference_id, location_id) do update
    set quantity = excluded.quantity;

  -- Applica alla fotografia iniziale tutti i trasferimenti, inventari e prelievi storici.
  insert into tmp_rlb_balances (reference_id, location_id, quantity)
  select product.reference_id, transfer.source_location_id, -sum(transfer.quantita)::integer
  from tmp_rlb_products product
  join public.wms_stock_transfers transfer
    on transfer.cliente_id = v_client_id
   and transfer.product_key = product.product_key
  group by product.reference_id, transfer.source_location_id
  on conflict (reference_id, location_id) do update
    set quantity = tmp_rlb_balances.quantity + excluded.quantity;

  insert into tmp_rlb_balances (reference_id, location_id, quantity)
  select product.reference_id, transfer.target_location_id, sum(transfer.quantita)::integer
  from tmp_rlb_products product
  join public.wms_stock_transfers transfer
    on transfer.cliente_id = v_client_id
   and transfer.product_key = product.product_key
  group by product.reference_id, transfer.target_location_id
  on conflict (reference_id, location_id) do update
    set quantity = tmp_rlb_balances.quantity + excluded.quantity;

  insert into tmp_rlb_balances (reference_id, location_id, quantity)
  select
    product.reference_id,
    inventory.location_id,
    sum(inventory.quantita_contata - inventory.quantita_attesa)::integer
  from tmp_rlb_products product
  join public.wms_inventory_counts inventory
    on inventory.cliente_id = v_client_id
   and inventory.product_key = product.product_key
  join public.wms_inventory_sessions inventory_session
    on inventory_session.id = inventory.session_id
   and inventory_session.stato = 'completata'
  group by product.reference_id, inventory.location_id
  on conflict (reference_id, location_id) do update
    set quantity = tmp_rlb_balances.quantity + excluded.quantity;

  insert into tmp_rlb_balances (reference_id, location_id, quantity)
  select product.reference_id, outbound.location_id, -sum(outbound.quantita)::integer
  from tmp_rlb_products product
  join public.wms_outbound_movements outbound
    on outbound.cliente_id = v_client_id
   and outbound.product_key = product.product_key
  group by product.reference_id, outbound.location_id
  on conflict (reference_id, location_id) do update
    set quantity = tmp_rlb_balances.quantity + excluded.quantity;

  update tmp_rlb_balances set quantity = greatest(0, quantity);

  for product_row in
    select * from tmp_rlb_products order by md5(reference_id::text || current_date::text)
  loop
    v_references := v_references + 1;

    -- Mantiene lo slot gia associato quando esiste; in alternativa ne sceglie uno casuale.
    select balance.location_id
    into v_target_slot_id
    from tmp_rlb_balances balance
    join public.wms_locations location on location.id = balance.location_id
    where balance.reference_id = product_row.reference_id
      and balance.quantity > 0
      and location.tipo = 'slot'
      and location.stato = 'attiva'
    order by balance.quantity desc, md5(location.id::text || product_row.reference_id::text)
    limit 1;

    if v_target_slot_id is null then
      select location.id
      into v_target_slot_id
      from public.wms_locations location
      where location.tipo = 'slot'
        and location.stato = 'attiva'
      order by md5(location.id::text || product_row.reference_id::text || current_date::text)
      limit 1;
    end if;

    if v_target_slot_id is null then
      raise exception 'Nessuno slot attivo disponibile';
    end if;

    select coalesce(sum(balance.quantity), 0)::integer
    into v_slot_total
    from tmp_rlb_balances balance
    join public.wms_locations location on location.id = balance.location_id
    where balance.reference_id = product_row.reference_id
      and location.tipo = 'slot';

    if v_slot_total < 20 then
      v_delta := 20 - v_slot_total;
      for source_row in
        select balance.location_id, balance.quantity
        from tmp_rlb_balances balance
        join public.wms_locations location on location.id = balance.location_id
        where balance.reference_id = product_row.reference_id
          and balance.quantity > 0
          and location.tipo = 'pallet'
        order by balance.quantity desc, md5(location.id::text || product_row.reference_id::text)
      loop
        exit when v_delta <= 0;
        v_move := least(v_delta, source_row.quantity);
        insert into public.wms_stock_transfers (
          cliente_id, product_key, source_location_id, target_location_id, quantita
        ) values (
          v_client_id, product_row.product_key, source_row.location_id, v_target_slot_id, v_move
        );
        update tmp_rlb_balances
        set quantity = quantity - v_move
        where reference_id = product_row.reference_id and location_id = source_row.location_id;
        insert into tmp_rlb_balances (reference_id, location_id, quantity)
        values (product_row.reference_id, v_target_slot_id, v_move)
        on conflict (reference_id, location_id) do update
          set quantity = tmp_rlb_balances.quantity + excluded.quantity;
        v_delta := v_delta - v_move;
        v_transferred := v_transferred + v_move;
      end loop;

      if v_delta > 0 then
        insert into public.entrate_righe (
          entrata_id, ean, fnsku, quantita, quantita_ricevuta
        )
        select
          v_adjustment_entry_id, reference.ean, reference.fnsku, v_delta, v_delta
        from public.referenze reference
        where reference.id = product_row.reference_id
        returning id into v_entry_row_id;

        insert into public.wms_inbound_movements (
          session_id, entrata_riga_id, location_id, disposizione,
          quantita, codice_scansionato
        )
        select
          v_adjustment_session_id, v_entry_row_id, v_target_slot_id,
          'disponibile', v_delta, location.codice
        from public.wms_locations location
        where location.id = v_target_slot_id;

        v_loaded := v_loaded + v_delta;
        v_delta := 0;
      end if;
    elsif v_slot_total > 20 then
      v_delta := v_slot_total - 20;
      select balance.location_id
      into v_target_pallet_id
      from tmp_rlb_balances balance
      join public.wms_locations location on location.id = balance.location_id
      where balance.reference_id = product_row.reference_id
        and balance.quantity > 0
        and location.tipo = 'pallet'
        and location.stato = 'attiva'
      order by balance.quantity desc
      limit 1;

      if v_target_pallet_id is null then
        select location.id
        into v_target_pallet_id
        from public.wms_locations location
        where location.tipo = 'pallet' and location.stato = 'attiva'
        order by md5(location.id::text || product_row.reference_id::text || current_date::text)
        limit 1;
      end if;

      for source_row in
        select balance.location_id, balance.quantity
        from tmp_rlb_balances balance
        join public.wms_locations location on location.id = balance.location_id
        where balance.reference_id = product_row.reference_id
          and balance.quantity > 0
          and location.tipo = 'slot'
        order by case when balance.location_id = v_target_slot_id then 1 else 0 end,
          balance.quantity desc
      loop
        exit when v_delta <= 0;
        v_move := least(v_delta, source_row.quantity);
        insert into public.wms_stock_transfers (
          cliente_id, product_key, source_location_id, target_location_id, quantita
        ) values (
          v_client_id, product_row.product_key, source_row.location_id, v_target_pallet_id, v_move
        );
        v_delta := v_delta - v_move;
        v_transferred := v_transferred + v_move;
      end loop;
    end if;
  end loop;

  raise notice 'Relifebattery: % referenze portate a 20 pezzi negli slot; % trasferiti dai pallet; % caricati per referenze senza stock',
    v_references, v_transferred, v_loaded;
end $$;
