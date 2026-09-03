-- Nel mono-prodotto non esiste il doppio controllo bag per ogni ordine.
-- Recupera le sessioni rimaste nello stato legacy dopo una scansione precedente.
do $$
declare
  v_now timestamptz := now();
begin
  update public.wms_packing_sessions session
  set stato = 'in_attesa_packing',
      bag_first_scanned_at = null,
      updated_at = v_now
  where session.stato = 'in_verifica_bag'
    and session.packaging_code is null
    and session.carrier_label_code is null
    and exists (
      select 1
      from public.wms_mass_pick_batches batch
      where batch.id = session.mass_batch_id
        and batch.picking_mode = 'mono'
    );

  update public.shopify_orders orders
  set wms_status = 'in_attesa_packing', updated_at = v_now
  where orders.wms_status = 'in_packing'
    and exists (
      select 1
      from public.wms_packing_sessions session
      join public.wms_mass_pick_batches batch on batch.id = session.mass_batch_id
      where session.order_id = orders.id
        and session.stato = 'in_attesa_packing'
        and batch.picking_mode = 'mono'
    );

  update public.wms_mass_pick_orders mass_order
  set stato = 'nella_bag'
  where exists (
    select 1
    from public.wms_packing_sessions session
    join public.wms_mass_pick_batches batch on batch.id = session.mass_batch_id
    where session.mass_batch_id = mass_order.batch_id
      and session.order_id = mass_order.order_id
      and session.stato = 'in_attesa_packing'
      and batch.picking_mode = 'mono'
  );
end;
$$;
