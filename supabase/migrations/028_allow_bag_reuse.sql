-- A physical bag is reused after packing, so historical references cannot be unique.
drop index if exists public.wms_pick_tasks_bag_code_idx;

alter table public.wms_mass_pick_batches
  drop constraint if exists wms_mass_pick_batches_bag_code_key;
