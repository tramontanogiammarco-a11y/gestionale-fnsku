-- Riconcilia sessioni mono storiche rimaste in stati del vecchio flusso packing.
do $$
declare
  v_now timestamptz := now();
begin
  update public.wms_packing_sessions session
  set stato = case
        when orders.wms_status = 'annullato' then 'annullata'
        when orders.wms_status in ('imballato', 'spedito') then 'completata'
        when session.carrier_label_code is not null then 'in_attesa_etichetta'
        else 'in_attesa_packing'
      end,
      completed_at = case
        when orders.wms_status in ('imballato', 'spedito') then coalesce(session.completed_at, v_now)
        else session.completed_at
      end,
      updated_at = v_now
  from public.shopify_orders orders
  where orders.id = session.order_id
    and session.stato in ('da_imballare', 'in_corso')
    and exists (
      select 1
      from public.wms_mass_pick_batches batch
      where batch.id = session.mass_batch_id
        and batch.picking_mode = 'mono'
    );

  update public.wms_packing_lines line
  set quantita_verificata = 0,
      verified_at = null
  where exists (
    select 1
    from public.wms_packing_sessions session
    join public.wms_mass_pick_batches batch on batch.id = session.mass_batch_id
    where session.id = line.session_id
      and session.stato = 'in_attesa_packing'
      and batch.picking_mode = 'mono'
  );

  update public.wms_mass_pick_orders mass_order
  set stato = case
        when session.stato in ('completata', 'annullata') then 'completato'
        when session.stato in ('in_verifica_bag', 'in_attesa_imballaggio', 'in_attesa_etichetta') then 'in_packing'
        else 'nella_bag'
      end
  from public.wms_packing_sessions session
  join public.wms_mass_pick_batches batch on batch.id = session.mass_batch_id
  where mass_order.batch_id = session.mass_batch_id
    and mass_order.order_id = session.order_id
    and batch.picking_mode = 'mono';

  update public.wms_mass_pick_batches batch
  set stato = case
        when not exists (
          select 1 from public.wms_packing_sessions pending
          where pending.mass_batch_id = batch.id
            and pending.stato not in ('completata', 'annullata')
        ) then 'completata_packing'
        when exists (
          select 1 from public.wms_packing_sessions progressed
          where progressed.mass_batch_id = batch.id
            and progressed.stato in ('in_verifica_bag', 'in_attesa_imballaggio', 'in_attesa_etichetta', 'completata')
        ) then 'in_packing'
        else 'completata'
      end,
      updated_at = v_now
  where batch.picking_mode = 'mono'
    and batch.stato in ('completata', 'in_packing', 'completata_packing');

  update public.wms_bags bag
  set stato = 'disponibile', updated_at = v_now
  where exists (
      select 1
      from public.wms_mass_pick_batches batch
      where batch.bag_id = bag.id
        and batch.picking_mode = 'mono'
        and batch.stato = 'completata_packing'
    )
    and not exists (
      select 1
      from public.wms_packing_sessions pending
      where pending.bag_id = bag.id
        and pending.stato not in ('completata', 'annullata')
    );
end;
$$;
