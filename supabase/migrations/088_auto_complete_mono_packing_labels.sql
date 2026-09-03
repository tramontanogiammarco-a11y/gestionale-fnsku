-- Nel packing mono-prodotto la stampa conclude l'ordine senza una seconda scansione etichetta.
create or replace function public.complete_wms_mono_packaging(p_session_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_now timestamptz := now();
begin
  if not public.is_staff() then
    raise exception 'Accesso riservato allo staff';
  end if;

  select count(*) into v_count
  from public.wms_packing_sessions session
  join public.wms_mass_pick_batches batch on batch.id = session.mass_batch_id
  where session.id = any(p_session_ids)
    and session.stato = 'in_attesa_etichetta'
    and session.carrier_label_code is not null
    and batch.picking_mode = 'mono';

  if v_count = 0 then
    raise exception 'Nessun ordine mono-prodotto pronto per la chiusura';
  end if;

  update public.shopify_orders orders
  set wms_status = 'imballato', updated_at = v_now
  where exists (
    select 1
    from public.wms_packing_sessions session
    join public.wms_mass_pick_batches batch on batch.id = session.mass_batch_id
    where session.id = any(p_session_ids)
      and session.order_id = orders.id
      and session.stato = 'in_attesa_etichetta'
      and session.carrier_label_code is not null
      and batch.picking_mode = 'mono'
  );

  update public.wms_mass_pick_orders mass_order
  set stato = 'completato'
  where exists (
    select 1
    from public.wms_packing_sessions session
    join public.wms_mass_pick_batches batch on batch.id = session.mass_batch_id
    where session.id = any(p_session_ids)
      and session.mass_batch_id = mass_order.batch_id
      and session.order_id = mass_order.order_id
      and session.stato = 'in_attesa_etichetta'
      and session.carrier_label_code is not null
      and batch.picking_mode = 'mono'
  );

  update public.wms_packing_sessions session
  set stato = 'completata',
      carrier_label_scanned_at = coalesce(session.carrier_label_scanned_at, v_now),
      completed_at = coalesce(session.completed_at, v_now),
      updated_at = v_now
  where session.id = any(p_session_ids)
    and session.stato = 'in_attesa_etichetta'
    and session.carrier_label_code is not null
    and exists (
      select 1 from public.wms_mass_pick_batches batch
      where batch.id = session.mass_batch_id and batch.picking_mode = 'mono'
    );

  update public.wms_mass_pick_batches batch
  set stato = case
        when exists (
          select 1 from public.wms_packing_sessions pending
          where pending.mass_batch_id = batch.id
            and pending.stato not in ('completata', 'annullata')
        ) then 'in_packing'
        else 'completata_packing'
      end,
      updated_at = v_now
  where batch.picking_mode = 'mono'
    and exists (
      select 1 from public.wms_packing_sessions session
      where session.mass_batch_id = batch.id and session.id = any(p_session_ids)
    );

  update public.wms_bags bag
  set stato = 'disponibile', updated_at = v_now
  where exists (
      select 1
      from public.wms_packing_sessions session
      join public.wms_mass_pick_batches batch on batch.id = session.mass_batch_id
      where session.id = any(p_session_ids)
        and session.bag_id = bag.id
        and batch.picking_mode = 'mono'
    )
    and not exists (
      select 1 from public.wms_packing_sessions pending
      where pending.bag_id = bag.id
        and pending.stato not in ('completata', 'annullata')
    );

  return v_count;
end;
$$;

revoke all on function public.complete_wms_mono_packaging(uuid[]) from public;
grant execute on function public.complete_wms_mono_packaging(uuid[]) to authenticated;

-- Sblocca le etichette mono gia stampate prima di questa modifica.
do $$
declare
  v_now timestamptz := now();
begin
  update public.shopify_orders orders
  set wms_status = 'imballato', updated_at = v_now
  where exists (
    select 1
    from public.wms_packing_sessions session
    join public.wms_mass_pick_batches batch on batch.id = session.mass_batch_id
    where session.order_id = orders.id
      and session.stato = 'in_attesa_etichetta'
      and session.carrier_label_code is not null
      and batch.picking_mode = 'mono'
  );

  update public.wms_mass_pick_orders mass_order
  set stato = 'completato'
  where exists (
    select 1
    from public.wms_packing_sessions session
    join public.wms_mass_pick_batches batch on batch.id = session.mass_batch_id
    where session.mass_batch_id = mass_order.batch_id
      and session.order_id = mass_order.order_id
      and session.stato = 'in_attesa_etichetta'
      and session.carrier_label_code is not null
      and batch.picking_mode = 'mono'
  );

  update public.wms_packing_sessions session
  set stato = 'completata',
      carrier_label_scanned_at = coalesce(session.carrier_label_scanned_at, v_now),
      completed_at = coalesce(session.completed_at, v_now),
      updated_at = v_now
  where session.stato = 'in_attesa_etichetta'
    and session.carrier_label_code is not null
    and exists (
      select 1 from public.wms_mass_pick_batches batch
      where batch.id = session.mass_batch_id and batch.picking_mode = 'mono'
    );

  update public.wms_mass_pick_batches batch
  set stato = case
        when exists (
          select 1 from public.wms_packing_sessions pending
          where pending.mass_batch_id = batch.id
            and pending.stato not in ('completata', 'annullata')
        ) then 'in_packing'
        else 'completata_packing'
      end,
      updated_at = v_now
  where batch.picking_mode = 'mono' and batch.stato = 'in_packing';

  update public.wms_bags bag
  set stato = 'disponibile', updated_at = v_now
  where exists (
      select 1
      from public.wms_packing_sessions session
      join public.wms_mass_pick_batches batch on batch.id = session.mass_batch_id
      where session.bag_id = bag.id and batch.picking_mode = 'mono'
    )
    and not exists (
      select 1 from public.wms_packing_sessions pending
      where pending.bag_id = bag.id
        and pending.stato not in ('completata', 'annullata')
    );
end;
$$;
