-- I batch annullati restano nello storico, ma non devono impedire un nuovo picking.
alter table public.wms_mass_pick_orders
  add column if not exists reservation_active boolean not null default true;

update public.wms_mass_pick_orders link
set reservation_active = false
from public.wms_mass_pick_batches batch
where batch.id = link.batch_id
  and batch.stato = 'annullata'
  and link.reservation_active;

alter table public.wms_mass_pick_orders
  drop constraint if exists wms_mass_pick_orders_order_id_key;

alter table public.wms_mass_pick_orders
  drop constraint if exists wms_mass_pick_orders_batch_order_key;
alter table public.wms_mass_pick_orders
  add constraint wms_mass_pick_orders_batch_order_key unique (batch_id, order_id);

create unique index if not exists wms_mass_pick_orders_active_order_key
  on public.wms_mass_pick_orders(order_id)
  where reservation_active;

create or replace function public.set_wms_mass_pick_order_reservation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_status text;
begin
  select stato into v_batch_status
  from public.wms_mass_pick_batches
  where id = new.batch_id;

  if v_batch_status is null then
    raise exception 'Missione picking non trovata';
  end if;

  new.reservation_active := v_batch_status <> 'annullata';
  return new;
end;
$$;

drop trigger if exists set_wms_mass_pick_order_reservation_trigger
  on public.wms_mass_pick_orders;
create trigger set_wms_mass_pick_order_reservation_trigger
before insert or update of batch_id
on public.wms_mass_pick_orders
for each row execute function public.set_wms_mass_pick_order_reservation();

create or replace function public.sync_wms_mass_pick_order_reservations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stato = 'annullata' and old.stato is distinct from new.stato then
    update public.wms_mass_pick_orders
    set reservation_active = false
    where batch_id = new.id
      and reservation_active;
  elsif old.stato = 'annullata' and new.stato <> 'annullata' then
    update public.wms_mass_pick_orders
    set reservation_active = true
    where batch_id = new.id
      and not reservation_active;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_wms_mass_pick_order_reservations_trigger
  on public.wms_mass_pick_batches;
create trigger sync_wms_mass_pick_order_reservations_trigger
after update of stato
on public.wms_mass_pick_batches
for each row execute function public.sync_wms_mass_pick_order_reservations();

