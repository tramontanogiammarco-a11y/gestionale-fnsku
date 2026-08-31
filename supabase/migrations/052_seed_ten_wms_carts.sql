-- Dieci carrelli operativi da dieci bag uniche ciascuno.
insert into public.wms_bags (codice)
select 'B-' || lpad(value::text, 5, '0')
from generate_series(73891, 73940) as value
on conflict (codice) do nothing;

insert into public.wms_carts (codice, righe, colonne, updated_at)
select 'CARRELLO-' || lpad(value::text, 2, '0'), 5, 2, now()
from generate_series(2, 10) as value
on conflict (codice) do update
set righe = excluded.righe,
    colonne = excluded.colonne,
    updated_at = now();

with free_bags as (
  select
    bag.id,
    bag.codice,
    row_number() over (order by random()) as sequence
  from public.wms_bags bag
  left join public.wms_cart_bag_positions assigned on assigned.bag_id = bag.id
  where assigned.bag_id is null
),
cart_slots as (
  select
    cart.id as cart_id,
    position as posizione,
    row_number() over (order by cart.codice, position) as sequence
  from public.wms_carts cart
  cross join generate_series(1, 10) as position
  where cart.codice between 'CARRELLO-02' and 'CARRELLO-10'
)
insert into public.wms_cart_bag_positions (cart_id, posizione, bag_id, bag_code, updated_at)
select slot.cart_id, slot.posizione, bag.id, bag.codice, now()
from cart_slots slot
join free_bags bag on bag.sequence = slot.sequence
on conflict (cart_id, posizione) do nothing;
