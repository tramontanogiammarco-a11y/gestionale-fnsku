-- Hardening operativo: autorizzazioni coerenti, quantita protette e scansioni atomiche.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and (
        role = 'admin'
        or (
          role = 'staff'
          and (not coalesce(is_operator, false) or coalesce(operator_active, false))
        )
      )
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

alter table public.wms_pick_lines
  drop constraint if exists wms_pick_lines_picked_not_over_expected;
alter table public.wms_pick_lines
  add constraint wms_pick_lines_picked_not_over_expected
  check (quantita_prelevata <= quantita_attesa) not valid;

alter table public.wms_mass_pick_lines
  drop constraint if exists wms_mass_pick_lines_picked_not_over_expected;
alter table public.wms_mass_pick_lines
  add constraint wms_mass_pick_lines_picked_not_over_expected
  check (quantita_prelevata <= quantita_attesa) not valid;

alter table public.wms_galluse_lines
  drop constraint if exists wms_galluse_lines_picked_not_over_expected;
alter table public.wms_galluse_lines
  add constraint wms_galluse_lines_picked_not_over_expected
  check (quantita_prelevata <= quantita_attesa) not valid;

alter table public.wms_packing_lines
  drop constraint if exists wms_packing_lines_verified_not_over_expected;
alter table public.wms_packing_lines
  add constraint wms_packing_lines_verified_not_over_expected
  check (quantita_verificata <= quantita_attesa) not valid;

create or replace function public.prevent_conflicting_wms_refill_target()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.stato in ('completata', 'annullata') then return new; end if;
  perform pg_advisory_xact_lock(hashtext('wms-refill-target:' || new.target_location_id::text));
  if exists (
    select 1 from public.wms_refill_lines other
    where other.target_location_id = new.target_location_id
      and other.id <> new.id
      and other.stato not in ('completata', 'annullata')
  ) then
    raise exception 'Lo slot di destinazione e gia riservato da un altro refill';
  end if;
  return new;
end;
$$;

drop trigger if exists prevent_conflicting_wms_refill_target on public.wms_refill_lines;
create trigger prevent_conflicting_wms_refill_target
before insert or update of target_location_id, stato on public.wms_refill_lines
for each row execute function public.prevent_conflicting_wms_refill_target();

create or replace function public.reset_wms_label_print_ack()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.stato = 'in_attesa_etichetta'
    and old.stato is distinct from 'in_attesa_etichetta'
    and old.carrier_label_code is null then
    new.carrier_label_printed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists reset_wms_label_print_ack on public.wms_packing_sessions;
create trigger reset_wms_label_print_ack
before update of stato, carrier_label_code on public.wms_packing_sessions
for each row execute function public.reset_wms_label_print_ack();

create or replace function public.record_wms_pick_quantity(p_line_id uuid, p_quantity integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.wms_pick_lines%rowtype;
  v_task public.wms_pick_tasks%rowtype;
  v_order public.shopify_orders%rowtype;
  v_next integer;
  v_now timestamptz := now();
begin
  if not public.is_staff() then raise exception 'Operazione non autorizzata'; end if;
  if coalesce(p_quantity, 0) <= 0 then raise exception 'Quantita non valida'; end if;
  select * into v_line from public.wms_pick_lines where id = p_line_id for update;
  if not found then raise exception 'Riga picking non trovata'; end if;
  select * into v_task from public.wms_pick_tasks where id = v_line.task_id for update;
  if v_task.stato <> 'in_corso' then raise exception 'La missione picking non e in corso'; end if;
  if v_line.location_confirmed_at is null then raise exception 'Scansiona prima lo slot'; end if;
  v_next := v_line.quantita_prelevata + p_quantity;
  if v_next > v_line.quantita_attesa then raise exception 'Quantita superiore al residuo richiesto'; end if;
  select * into v_order from public.shopify_orders where id = v_task.order_id for update;
  update public.wms_pick_lines
  set quantita_prelevata = v_next,
      picked_at = case when v_next = quantita_attesa then v_now else null end
  where id = v_line.id;
  insert into public.wms_outbound_movements (
    pick_line_id, order_id, cliente_id, location_id, product_key,
    quantita, operatore_id, created_at, updated_at
  ) values (
    v_line.id, v_task.order_id, v_order.cliente_id, v_line.location_id, v_line.product_key,
    v_next, auth.uid(), v_now, v_now
  )
  on conflict (pick_line_id) do update
  set quantita = excluded.quantita,
      operatore_id = excluded.operatore_id,
      updated_at = excluded.updated_at;
  return v_next;
end;
$$;

create or replace function public.record_wms_mass_pick_quantity(p_line_id uuid, p_quantity integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.wms_mass_pick_lines%rowtype;
  v_batch public.wms_mass_pick_batches%rowtype;
  v_next integer;
  v_now timestamptz := now();
begin
  if not public.is_staff() then raise exception 'Operazione non autorizzata'; end if;
  if coalesce(p_quantity, 0) <= 0 then raise exception 'Quantita non valida'; end if;
  select * into v_line from public.wms_mass_pick_lines where id = p_line_id for update;
  if not found then raise exception 'Riga picking non trovata'; end if;
  select * into v_batch from public.wms_mass_pick_batches where id = v_line.batch_id for update;
  if v_batch.stato <> 'in_corso' then raise exception 'La missione picking non e in corso'; end if;
  if v_line.location_confirmed_at is null then raise exception 'Scansiona prima lo slot'; end if;
  v_next := v_line.quantita_prelevata + p_quantity;
  if v_next > v_line.quantita_attesa then raise exception 'Quantita superiore al residuo richiesto'; end if;
  update public.wms_mass_pick_lines
  set quantita_prelevata = v_next,
      picked_at = case when v_next = quantita_attesa then v_now else null end
  where id = v_line.id;
  insert into public.wms_outbound_movements (
    mass_pick_line_id, mass_batch_id, order_id, cliente_id, location_id, product_key,
    quantita, operatore_id, created_at, updated_at
  ) values (
    v_line.id, v_batch.id, null, v_batch.cliente_id, v_line.location_id, v_line.product_key,
    v_next, auth.uid(), v_now, v_now
  )
  on conflict (mass_pick_line_id) do update
  set quantita = excluded.quantita,
      order_id = null,
      operatore_id = excluded.operatore_id,
      updated_at = excluded.updated_at;
  return v_next;
end;
$$;

create or replace function public.record_wms_galluse_pick_quantity(p_line_id uuid, p_quantity integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.wms_galluse_lines%rowtype;
  v_batch public.wms_galluse_batches%rowtype;
  v_next integer;
  v_now timestamptz := now();
begin
  if not public.is_staff() then raise exception 'Operazione non autorizzata'; end if;
  if coalesce(p_quantity, 0) <= 0 then raise exception 'Quantita non valida'; end if;
  select * into v_line from public.wms_galluse_lines where id = p_line_id for update;
  if not found then raise exception 'Riga picking non trovata'; end if;
  select * into v_batch from public.wms_galluse_batches where id = v_line.batch_id for update;
  if v_batch.stato <> 'in_corso' then raise exception 'La missione Galluse non e in corso'; end if;
  if v_line.location_confirmed_at is null then raise exception 'Scansiona prima lo slot'; end if;
  v_next := v_line.quantita_prelevata + p_quantity;
  if v_next > v_line.quantita_attesa then raise exception 'Quantita superiore al residuo richiesto'; end if;
  update public.wms_galluse_lines
  set quantita_prelevata = v_next,
      picked_at = case when v_next = quantita_attesa then v_now else null end
  where id = v_line.id;
  insert into public.wms_outbound_movements (
    galluse_line_id, galluse_batch_id, order_id, cliente_id, location_id, product_key,
    quantita, operatore_id, created_at, updated_at
  ) values (
    v_line.id, v_batch.id, null, v_batch.cliente_id, v_line.location_id, v_line.product_key,
    v_next, auth.uid(), v_now, v_now
  )
  on conflict (galluse_line_id) do update
  set quantita = excluded.quantita,
      order_id = null,
      operatore_id = excluded.operatore_id,
      updated_at = excluded.updated_at;
  return v_next;
end;
$$;

create or replace function public.mark_wms_packing_labels_printed(p_session_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_count integer;
begin
  if not public.is_staff() then raise exception 'Operazione non autorizzata'; end if;
  update public.wms_packing_sessions
  set carrier_label_printed_at = coalesce(carrier_label_printed_at, now()), updated_at = now()
  where id = any(coalesce(p_session_ids, '{}'::uuid[]))
    and stato = 'in_attesa_etichetta'
    and carrier_label_code is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

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
  update public.shopify_orders set wms_status = 'imballato', updated_at = v_now where id = v_session.order_id;
  update public.wms_packing_sessions
  set stato = 'completata', carrier_label_scanned_at = v_now, completed_at = v_now, updated_at = v_now
  where id = v_session.id;
  if v_session.mass_batch_id is not null then
    update public.wms_mass_pick_orders set stato = 'completato'
    where batch_id = v_session.mass_batch_id and order_id = v_session.order_id;
    select not exists (
      select 1 from public.wms_packing_sessions pending
      where pending.mass_batch_id = v_session.mass_batch_id
        and pending.stato not in ('completata', 'annullata')
    ) into v_all_packed;
    update public.wms_mass_pick_batches
    set stato = case when v_all_packed then 'completata_packing' else 'in_packing' end, updated_at = v_now
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
    update public.wms_bags set stato = 'disponibile', updated_at = v_now where id = v_session.bag_id;
  end if;
  return jsonb_build_object(
    'session_id', v_session.id,
    'order_id', v_session.order_id,
    'batch_completed', v_all_packed
  );
end;
$$;

revoke all on function public.record_wms_pick_quantity(uuid, integer) from public;
revoke all on function public.record_wms_mass_pick_quantity(uuid, integer) from public;
revoke all on function public.record_wms_galluse_pick_quantity(uuid, integer) from public;
revoke all on function public.mark_wms_packing_labels_printed(uuid[]) from public;
revoke all on function public.complete_wms_packing_label(uuid, text) from public;
grant execute on function public.record_wms_pick_quantity(uuid, integer) to authenticated;
grant execute on function public.record_wms_mass_pick_quantity(uuid, integer) to authenticated;
grant execute on function public.record_wms_galluse_pick_quantity(uuid, integer) to authenticated;
grant execute on function public.mark_wms_packing_labels_printed(uuid[]) to authenticated;
grant execute on function public.complete_wms_packing_label(uuid, text) to authenticated;

-- Il mono si conclude con la scansione dell'etichetta, come gli altri flussi.
revoke all on function public.complete_wms_mono_packaging(uuid[]) from authenticated;
