alter table public.wms_galluse_batches
  drop constraint if exists wms_galluse_batches_numero_bag_check;

alter table public.wms_galluse_batches
  add constraint wms_galluse_batches_numero_bag_check
  check (numero_bag between 1 and 60);

alter table public.wms_galluse_orders
  drop constraint if exists wms_galluse_orders_posizione_bag_check;

alter table public.wms_galluse_orders
  add constraint wms_galluse_orders_posizione_bag_check
  check (posizione_bag between 1 and 60);
