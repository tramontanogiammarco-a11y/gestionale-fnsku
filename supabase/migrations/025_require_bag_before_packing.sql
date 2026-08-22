alter table public.wms_pick_tasks
  drop constraint if exists wms_pick_tasks_stato_check;

alter table public.wms_pick_tasks
  add constraint wms_pick_tasks_stato_check
  check (stato in ('da_prelevare', 'in_corso', 'da_confermare_bag', 'completata', 'annullata'));

alter table public.wms_pick_tasks
  add column if not exists bag_code text,
  add column if not exists bag_confirmed_at timestamptz;

create unique index if not exists wms_pick_tasks_bag_code_idx
  on public.wms_pick_tasks(bag_code)
  where bag_code is not null;
