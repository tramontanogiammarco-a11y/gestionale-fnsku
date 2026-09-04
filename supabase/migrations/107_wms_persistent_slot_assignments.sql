-- Uno slot resta dedicato a una sola referenza, anche quando la quantita arriva a zero.
create table if not exists public.wms_slot_assignments (
  location_id uuid primary key references public.wms_locations(id) on delete restrict,
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  product_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists wms_slot_assignments_product_idx
  on public.wms_slot_assignments(cliente_id, product_key);

alter table public.wms_slot_assignments enable row level security;

create policy "wms_slot_assignments_read" on public.wms_slot_assignments
  for select using (public.is_staff() or public.owns_cliente(cliente_id));

create policy "wms_slot_assignments_staff_write" on public.wms_slot_assignments
  for all using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.wms_slot_assignments to authenticated;

create or replace function public.wms_current_slot_balances()
returns table (
  location_id uuid,
  cliente_id uuid,
  product_key text,
  quantity bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with deltas as (
    select
      movement.location_id,
      entry.cliente_id,
      case
        when nullif(trim(row.fnsku), '') is not null then 'fnsku:' || lower(trim(row.fnsku))
        when nullif(trim(row.ean), '') is not null then 'ean:' || lower(trim(row.ean))
      end as product_key,
      movement.quantita::bigint as quantity
    from public.wms_inbound_movements movement
    join public.entrate_righe row on row.id = movement.entrata_riga_id
    join public.entrate entry on entry.id = row.entrata_id
    where movement.disposizione = 'disponibile'
      and movement.location_id is not null
      and coalesce(nullif(trim(row.fnsku), ''), nullif(trim(row.ean), '')) is not null

    union all

    select placement.location_id, placement.cliente_id,
      lower(trim(placement.product_key)), placement.quantita::bigint
    from public.wms_stock_placements placement

    union all

    select transfer.source_location_id, transfer.cliente_id,
      lower(trim(transfer.product_key)), -transfer.quantita::bigint
    from public.wms_stock_transfers transfer

    union all

    select transfer.target_location_id, transfer.cliente_id,
      lower(trim(transfer.product_key)), transfer.quantita::bigint
    from public.wms_stock_transfers transfer

    union all

    select count.location_id, count.cliente_id, lower(trim(count.product_key)),
      (count.quantita_contata - count.quantita_attesa)::bigint
    from public.wms_inventory_counts count
    join public.wms_inventory_sessions session on session.id = count.session_id
    where session.stato = 'completata'

    union all

    select movement.location_id, movement.cliente_id,
      lower(trim(movement.product_key)), -movement.quantita::bigint
    from public.wms_outbound_movements movement
  )
  select delta.location_id, delta.cliente_id, delta.product_key, sum(delta.quantity)::bigint
  from deltas delta
  join public.wms_locations location on location.id = delta.location_id
  where location.tipo = 'slot' and delta.product_key is not null
  group by delta.location_id, delta.cliente_id, delta.product_key
  having sum(delta.quantity) > 0;
$$;

revoke all on function public.wms_current_slot_balances() from public;

do $$
declare
  v_conflict text;
begin
  select string_agg(location.codice, ', ' order by location.codice)
  into v_conflict
  from (
    select balance.location_id
    from public.wms_current_slot_balances() balance
    group by balance.location_id
    having count(*) > 1
  ) conflict
  join public.wms_locations location on location.id = conflict.location_id;

  if v_conflict is not null then
    raise exception 'Slot con piu referenze da riconciliare prima della migrazione: %', v_conflict;
  end if;
end;
$$;

insert into public.wms_slot_assignments (location_id, cliente_id, product_key)
select balance.location_id, balance.cliente_id, balance.product_key
from public.wms_current_slot_balances() balance
on conflict (location_id) do nothing;

create or replace function public.claim_wms_slot_assignment(
  p_location_id uuid,
  p_cliente_id uuid,
  p_product_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location public.wms_locations%rowtype;
  v_existing public.wms_slot_assignments%rowtype;
  v_product_key text := lower(trim(coalesce(p_product_key, '')));
begin
  if p_location_id is null or p_cliente_id is null or v_product_key = '' then
    raise exception 'Assegnazione slot non valida';
  end if;

  select * into v_location
  from public.wms_locations
  where id = p_location_id;

  if not found then raise exception 'Ubicazione non trovata'; end if;
  if v_location.tipo <> 'slot' then return; end if;

  perform pg_advisory_xact_lock(hashtext('wms-slot:' || p_location_id::text));

  select * into v_existing
  from public.wms_slot_assignments
  where location_id = p_location_id;

  if found then
    if v_existing.cliente_id <> p_cliente_id
      or lower(trim(v_existing.product_key)) <> v_product_key then
      raise exception 'Lo slot % e gia assegnato a un altra referenza', v_location.codice
        using errcode = '23514';
    end if;

    update public.wms_slot_assignments
    set updated_at = now()
    where location_id = p_location_id;
    return;
  end if;

  insert into public.wms_slot_assignments (location_id, cliente_id, product_key)
  values (p_location_id, p_cliente_id, v_product_key);
end;
$$;

revoke all on function public.claim_wms_slot_assignment(uuid, uuid, text) from public;

create or replace function public.claim_wms_slot_from_stock_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente_id uuid;
  v_product_key text;
begin
  if tg_table_name = 'wms_inbound_movements' then
    if new.disposizione <> 'disponibile' or new.location_id is null then return new; end if;
    select
      entry.cliente_id,
      case
        when nullif(trim(row.fnsku), '') is not null then 'fnsku:' || lower(trim(row.fnsku))
        when nullif(trim(row.ean), '') is not null then 'ean:' || lower(trim(row.ean))
      end
    into v_cliente_id, v_product_key
    from public.entrate_righe row
    join public.entrate entry on entry.id = row.entrata_id
    where row.id = new.entrata_riga_id;
    if v_product_key is not null then
      perform public.claim_wms_slot_assignment(new.location_id, v_cliente_id, v_product_key);
    end if;
  elsif tg_table_name = 'wms_stock_placements' then
    perform public.claim_wms_slot_assignment(new.location_id, new.cliente_id, new.product_key);
  elsif tg_table_name = 'wms_stock_transfers' then
    perform public.claim_wms_slot_assignment(new.target_location_id, new.cliente_id, new.product_key);
  elsif tg_table_name = 'wms_inventory_counts' and new.quantita_contata > 0 then
    perform public.claim_wms_slot_assignment(new.location_id, new.cliente_id, new.product_key);
  end if;
  return new;
end;
$$;

drop trigger if exists claim_wms_inbound_slot on public.wms_inbound_movements;
create trigger claim_wms_inbound_slot
before insert or update of location_id, entrata_riga_id, disposizione
on public.wms_inbound_movements
for each row execute function public.claim_wms_slot_from_stock_write();

drop trigger if exists claim_wms_placement_slot on public.wms_stock_placements;
create trigger claim_wms_placement_slot
before insert or update of location_id, cliente_id, product_key
on public.wms_stock_placements
for each row execute function public.claim_wms_slot_from_stock_write();

drop trigger if exists claim_wms_transfer_target_slot on public.wms_stock_transfers;
create trigger claim_wms_transfer_target_slot
before insert or update of target_location_id, cliente_id, product_key
on public.wms_stock_transfers
for each row execute function public.claim_wms_slot_from_stock_write();

drop trigger if exists claim_wms_inventory_slot on public.wms_inventory_counts;
create trigger claim_wms_inventory_slot
before insert or update of location_id, cliente_id, product_key, quantita_contata
on public.wms_inventory_counts
for each row execute function public.claim_wms_slot_from_stock_write();

create or replace function public.prevent_conflicting_wms_refill_target()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.stato in ('completata', 'annullata') then return new; end if;

  perform public.claim_wms_slot_assignment(new.target_location_id, new.cliente_id, new.product_key);
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

create or replace function public.cascade_wms_product_key(
  p_cliente_id uuid,
  p_old_key text,
  p_new_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_staff() or public.owns_cliente(p_cliente_id)) then
    raise exception 'Accesso negato';
  end if;
  if nullif(trim(p_old_key), '') is null or nullif(trim(p_new_key), '') is null then
    raise exception 'Chiavi prodotto non valide';
  end if;

  update public.wms_slot_assignments
  set product_key = lower(trim(p_new_key)), updated_at = now()
  where cliente_id = p_cliente_id and lower(trim(product_key)) = lower(trim(p_old_key));

  update public.wms_stock_transfers
  set product_key = p_new_key
  where cliente_id = p_cliente_id and product_key = p_old_key;

  update public.wms_outbound_movements
  set product_key = p_new_key
  where cliente_id = p_cliente_id and product_key = p_old_key;

  update public.wms_inventory_counts
  set product_key = p_new_key
  where cliente_id = p_cliente_id and product_key = p_old_key;

  update public.wms_stock_placements
  set product_key = p_new_key
  where cliente_id = p_cliente_id and product_key = p_old_key;
end;
$$;

