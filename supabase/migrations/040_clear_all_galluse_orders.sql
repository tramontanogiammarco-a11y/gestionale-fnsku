-- Explicit operational reset requested for Metodo Galluse only.
-- It releases the cart bags and removes every Galluse-linked order, picking
-- mission and packing session without touching normal or Massivo orders.
with used_bags as (
  select distinct bag_id
  from public.wms_galluse_orders
  where bag_id is not null
)
update public.wms_bags
set stato = 'disponibile', updated_at = now()
where id in (select bag_id from used_bags);

delete from public.wms_packing_sessions
where order_id in (select order_id from public.wms_galluse_orders);

delete from public.shopify_orders
where id in (select order_id from public.wms_galluse_orders);

delete from public.wms_galluse_batches;
