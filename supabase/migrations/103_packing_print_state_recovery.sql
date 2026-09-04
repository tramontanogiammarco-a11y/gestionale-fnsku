-- La scansione fisica dell'etichetta prova anche che l'etichetta e stata stampata.
create or replace function public.complete_wms_packing_label(p_session_id uuid, p_label_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session public.wms_packing_sessions%rowtype;
  v_all_packed boolean;
  v_now timestamptz := now();
begin
  if not public.is_staff() then raise exception 'Operazione non autorizzata'; end if;
  select * into v_session from public.wms_packing_sessions where id = p_session_id for update;
  if not found then raise exception 'Sessione packing non trovata'; end if;
  if v_session.stato = 'completata' then
    return jsonb_build_object('session_id', v_session.id, 'already_completed', true);
  end if;
  if v_session.stato <> 'in_attesa_etichetta' then raise exception 'La sessione non attende una etichetta'; end if;
  if upper(trim(coalesce(v_session.carrier_label_code, ''))) <> upper(trim(coalesce(p_label_code, ''))) then
    raise exception 'Etichetta non prevista per questa sessione';
  end if;

  update public.shopify_orders
  set wms_status = 'imballato', updated_at = v_now
  where id = v_session.order_id;

  update public.wms_packing_sessions
  set stato = 'completata',
      carrier_label_printed_at = coalesce(carrier_label_printed_at, v_now),
      carrier_label_scanned_at = v_now,
      completed_at = v_now,
      updated_at = v_now
  where id = v_session.id;

  if v_session.mass_batch_id is not null then
    update public.wms_mass_pick_orders
    set stato = 'completato'
    where batch_id = v_session.mass_batch_id and order_id = v_session.order_id;

    select not exists (
      select 1 from public.wms_packing_sessions pending
      where pending.mass_batch_id = v_session.mass_batch_id
        and pending.stato not in ('completata', 'annullata')
    ) into v_all_packed;

    update public.wms_mass_pick_batches
    set stato = case when v_all_packed then 'completata_packing' else 'in_packing' end,
        updated_at = v_now
    where id = v_session.mass_batch_id;
  else
    v_all_packed := true;
  end if;

  if v_session.bag_id is not null and not exists (
    select 1 from public.wms_packing_sessions pending
    where pending.bag_id = v_session.bag_id
      and pending.id <> v_session.id
      and pending.stato not in ('completata', 'annullata')
  ) then
    update public.wms_bags
    set stato = 'disponibile', updated_at = v_now
    where id = v_session.bag_id;
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'order_id', v_session.order_id,
    'batch_completed', v_all_packed
  );
end;
$$;

revoke all on function public.complete_wms_packing_label(uuid, text) from public;
grant execute on function public.complete_wms_packing_label(uuid, text) to authenticated;
