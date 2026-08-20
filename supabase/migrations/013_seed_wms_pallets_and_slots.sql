alter table public.wms_locations
  drop constraint if exists wms_locations_tipo_check;

alter table public.wms_locations
  add constraint wms_locations_tipo_check
  check (tipo in ('scaffale', 'slot', 'pallet', 'terra', 'quarantena'));

insert into public.wms_locations (codice, zona, tipo, note)
select
  'P1+A' || number,
  'Pallet 1',
  'pallet',
  'Posizione pallet censita automaticamente'
from generate_series(1, 100) as number
on conflict (codice) do update
set tipo = excluded.tipo,
    zona = excluded.zona;

insert into public.wms_locations (codice, zona, tipo, note)
select
  'S1+A' || number,
  'Slot 1',
  'slot',
  'Posizione slot censita automaticamente'
from generate_series(1, 100) as number
on conflict (codice) do update
set tipo = excluded.tipo,
    zona = excluded.zona;

create or replace function public.enforce_wms_location_single_product()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_location public.wms_locations%rowtype;
  target_cliente_id uuid;
  target_product_key text;
  conflicting_product text;
begin
  select *
  into target_location
  from public.wms_locations
  where id = new.location_id;

  if target_location.tipo not in ('pallet', 'slot')
     or new.disposizione <> 'disponibile' then
    return new;
  end if;

  select
    e.cliente_id,
    coalesce(nullif(upper(trim(er.fnsku)), ''), nullif(upper(trim(er.ean)), ''), er.id::text)
  into target_cliente_id, target_product_key
  from public.entrate_righe er
  join public.entrate e on e.id = er.entrata_id
  where er.id = new.entrata_riga_id;

  select coalesce(nullif(er.fnsku, ''), nullif(er.ean, ''), 'un altro prodotto')
  into conflicting_product
  from public.wms_inbound_movements movement
  join public.entrate_righe er on er.id = movement.entrata_riga_id
  join public.entrate e on e.id = er.entrata_id
  where movement.location_id = new.location_id
    and movement.disposizione = 'disponibile'
    and movement.id <> coalesce(new.id, gen_random_uuid())
    and (
      e.cliente_id <> target_cliente_id
      or coalesce(nullif(upper(trim(er.fnsku)), ''), nullif(upper(trim(er.ean)), ''), er.id::text) <> target_product_key
    )
  limit 1;

  if conflicting_product is not null then
    raise exception 'La posizione % contiene gia %', target_location.codice, conflicting_product
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists wms_location_single_product_trigger
  on public.wms_inbound_movements;

create trigger wms_location_single_product_trigger
before insert or update of location_id, entrata_riga_id, disposizione
on public.wms_inbound_movements
for each row
execute function public.enforce_wms_location_single_product();
