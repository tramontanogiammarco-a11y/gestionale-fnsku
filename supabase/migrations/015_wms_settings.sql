create table if not exists public.wms_settings (
  id smallint primary key default 1 check (id = 1),
  cutoff_time time not null default '12:00:00',
  timezone text not null default 'Europe/Rome',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.wms_settings (id, cutoff_time, timezone)
values (1, '12:00:00', 'Europe/Rome')
on conflict (id) do nothing;

alter table public.wms_settings enable row level security;

create policy "wms_settings_staff_access" on public.wms_settings
  for all using (public.is_staff()) with check (public.is_staff());

grant select, insert, update on public.wms_settings to authenticated;
