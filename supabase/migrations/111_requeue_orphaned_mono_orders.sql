-- Recupera i due ordini lasciati in preparazione dal tentativo mono fallito.
-- Un ordine viene rimesso in coda solo se non appartiene ad alcun flusso attivo.
update public.shopify_orders orders
set wms_status = 'da_preparare', updated_at = now()
where orders.order_name in (
    '#TEST-SINGOLO-20260906-3847636-1',
    '#TEST-SINGOLO-20260906-3847636-3'
  )
  and orders.wms_status = 'in_preparazione'
  and orders.gate_status = 'sbloccato'
  and not exists (
    select 1
    from public.wms_pick_tasks task
    where task.order_id = orders.id
      and task.stato in ('da_prelevare', 'in_corso')
  )
  and not exists (
    select 1
    from public.wms_mass_pick_orders link
    join public.wms_mass_pick_batches batch on batch.id = link.batch_id
    where link.order_id = orders.id
      and batch.stato <> 'annullata'
  )
  and not exists (
    select 1
    from public.wms_galluse_orders link
    join public.wms_galluse_batches batch on batch.id = link.batch_id
    where link.order_id = orders.id
      and batch.stato not in ('completata', 'annullata')
  )
  and not exists (
    select 1
    from public.wms_packing_sessions session
    where session.order_id = orders.id
      and session.stato not in ('completata', 'annullata')
  );

