create table if not exists public.wms_bags (
  id uuid primary key default gen_random_uuid(),
  codice text not null unique check (codice ~ '^B-[0-9]{5}$'),
  stato text not null default 'disponibile' check (stato in ('disponibile', 'in_packing')),
  updated_at timestamptz not null default now()
);

alter table public.wms_bags enable row level security;
create policy "wms_bags_staff_access" on public.wms_bags for all using (public.is_staff()) with check (public.is_staff());
grant select, insert, update on public.wms_bags to authenticated;

insert into public.wms_bags (codice)
select 'B-' || lpad((73840 + value)::text, 5, '0')
from generate_series(1, 50) as value
on conflict (codice) do nothing;

alter table public.wms_mass_pick_batches
  drop constraint if exists wms_mass_pick_batches_bag_code_check;
alter table public.wms_mass_pick_batches
  alter column bag_code drop not null,
  add column if not exists bag_id uuid references public.wms_bags(id) on delete set null;
alter table public.wms_mass_pick_batches
  add constraint wms_mass_pick_batches_bag_code_check
  check (bag_code is null or bag_code ~ '^B-[0-9]{5}$' or bag_code ~ '^[0-9]{6}$');

alter table public.wms_pick_tasks
  add column if not exists bag_id uuid references public.wms_bags(id) on delete set null;
alter table public.wms_packing_sessions
  add column if not exists bag_id uuid references public.wms_bags(id) on delete set null;
