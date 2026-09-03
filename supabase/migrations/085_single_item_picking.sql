-- Picking mono-prodotto: ordini da un solo pezzo in una bag condivisa.
alter table public.wms_mass_pick_batches
  add column if not exists picking_mode text not null default 'massivo';

alter table public.wms_mass_pick_batches
  drop constraint if exists wms_mass_pick_batches_picking_mode_check;
alter table public.wms_mass_pick_batches
  add constraint wms_mass_pick_batches_picking_mode_check
  check (picking_mode in ('massivo', 'mono'));

alter table public.wms_mass_pick_lines
  drop constraint if exists wms_mass_pick_lines_numero_ordini_check;
alter table public.wms_mass_pick_lines
  add constraint wms_mass_pick_lines_numero_ordini_check
  check (numero_ordini > 0);

create or replace function public.claim_wms_mono_packing_item(
  p_batch_id uuid,
  p_identifier text default null,
  p_session_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.wms_mass_pick_batches%rowtype;
  v_session_id uuid;
  v_order_id uuid;
  v_now timestamptz := now();
begin
  if not public.is_staff() then
    raise exception 'Accesso riservato allo staff';
  end if;

  select * into v_batch
  from public.wms_mass_pick_batches
  where id = p_batch_id
  for update;

  if not found or v_batch.picking_mode <> 'mono' then
    raise exception 'Missione mono-prodotto non trovata';
  end if;
  if v_batch.stato not in ('completata', 'in_packing') then
    raise exception 'La bag mono-prodotto non e pronta per il packing';
  end if;
  if exists (
    select 1
    from public.wms_packing_sessions active_session
    where active_session.mass_batch_id = p_batch_id
      and active_session.stato in ('in_verifica_bag', 'in_attesa_imballaggio', 'in_attesa_etichetta')
  ) then
    raise exception 'Completa prima il prodotto gia selezionato';
  end if;

  select session.id, session.order_id
  into v_session_id, v_order_id
  from public.wms_packing_sessions session
  join public.wms_packing_lines line on line.session_id = session.id
  where session.mass_batch_id = p_batch_id
    and session.stato = 'in_attesa_packing'
    and line.quantita_attesa = 1
    and (
      (p_session_id is not null and session.id = p_session_id)
      or (
        p_session_id is null
        and nullif(trim(coalesce(p_identifier, '')), '') is not null
        and upper(trim(p_identifier)) in (
          upper(trim(coalesce(line.ean, ''))),
          upper(trim(coalesce(line.fnsku, ''))),
          upper(trim(coalesce(line.sku, '')))
        )
      )
    )
  order by session.packing_sequence, session.created_at
  for update of session skip locked
  limit 1;

  if v_session_id is null then
    raise exception 'Prodotto non presente oppure gia elaborato in questa bag';
  end if;

  update public.wms_packing_lines
  set quantita_verificata = quantita_attesa,
      verified_at = v_now
  where session_id = v_session_id;

  update public.wms_packing_sessions
  set stato = 'in_attesa_imballaggio',
      station_code = 'PACK-01',
      started_at = coalesce(started_at, v_now),
      bag_first_scanned_at = coalesce(bag_first_scanned_at, v_now),
      bag_double_checked_at = coalesce(bag_double_checked_at, v_now),
      updated_at = v_now
  where id = v_session_id;

  update public.shopify_orders
  set wms_status = 'in_packing', updated_at = v_now
  where id = v_order_id;

  update public.wms_mass_pick_orders
  set stato = 'in_packing'
  where batch_id = p_batch_id and order_id = v_order_id;

  update public.wms_mass_pick_batches
  set stato = 'in_packing', updated_at = v_now
  where id = p_batch_id;

  return v_session_id;
end;
$$;

revoke all on function public.claim_wms_mono_packing_item(uuid, text, uuid) from public;
grant execute on function public.claim_wms_mono_packing_item(uuid, text, uuid) to authenticated;
