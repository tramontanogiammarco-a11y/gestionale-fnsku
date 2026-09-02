alter table public.wms_bags
  add column if not exists label_printed_at timestamptz;

alter table public.wms_bags drop constraint if exists wms_bags_codice_check;
alter table public.wms_bags
  add constraint wms_bags_codice_check check (codice ~ '^B-[A-Z0-9]{5}$');

alter table public.wms_mass_pick_batches drop constraint if exists wms_mass_pick_batches_bag_code_check;
alter table public.wms_mass_pick_batches
  add constraint wms_mass_pick_batches_bag_code_check
  check (bag_code is null or bag_code ~ '^B-[A-Z0-9]{5}$' or bag_code ~ '^[0-9]{6}$');

alter table public.wms_galluse_orders drop constraint if exists wms_galluse_orders_bag_code_check;
alter table public.wms_galluse_orders
  add constraint wms_galluse_orders_bag_code_check
  check (bag_code is null or bag_code ~ '^B-[A-Z0-9]{5}$');

alter table public.wms_galluse_cart_positions drop constraint if exists wms_galluse_cart_positions_bag_code_check;
alter table public.wms_galluse_cart_positions
  add constraint wms_galluse_cart_positions_bag_code_check
  check (bag_code ~ '^B-[A-Z0-9]{5}$');

alter table public.wms_cart_bag_positions drop constraint if exists wms_cart_bag_positions_bag_code_check;
alter table public.wms_cart_bag_positions
  add constraint wms_cart_bag_positions_bag_code_check
  check (bag_code ~ '^B-[A-Z0-9]{5}$');
