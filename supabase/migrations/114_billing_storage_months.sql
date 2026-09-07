-- Persist the monthly storage quantity and rate so client invoices remain reproducible.
create table if not exists public.wms_billing_storage_months (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  anno integer not null check (anno between 2020 and 2200),
  mese integer not null check (mese between 1 and 12),
  pallet_quantity integer not null default 0 check (pallet_quantity >= 0),
  unit_price_snapshot numeric not null default 0 check (unit_price_snapshot >= 0),
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cliente_id, anno, mese)
);

create index if not exists wms_billing_storage_months_period_idx
  on public.wms_billing_storage_months(anno desc, mese desc, cliente_id);

alter table public.wms_billing_storage_months enable row level security;

drop policy if exists "wms_billing_storage_read_own_or_staff" on public.wms_billing_storage_months;
create policy "wms_billing_storage_read_own_or_staff"
on public.wms_billing_storage_months
for select
using (public.owns_cliente(cliente_id));

drop policy if exists "wms_billing_storage_staff_write" on public.wms_billing_storage_months;
create policy "wms_billing_storage_staff_write"
on public.wms_billing_storage_months
for all
using (public.is_staff())
with check (public.is_staff());

grant select, insert, update, delete on public.wms_billing_storage_months to authenticated;
