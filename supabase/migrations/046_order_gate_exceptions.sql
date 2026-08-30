alter table public.shopify_orders
  drop constraint if exists shopify_orders_wms_status_check;

alter table public.shopify_orders
  add constraint shopify_orders_wms_status_check
  check (wms_status in (
    'in_verifica',
    'eccezione',
    'da_preparare',
    'in_preparazione',
    'pronto',
    'in_attesa_packing',
    'in_packing',
    'spedito',
    'annullato'
  ));

alter table public.shopify_orders
  add column if not exists gate_status text not null default 'da_verificare',
  add column if not exists exception_type text,
  add column if not exists exception_reasons jsonb not null default '[]'::jsonb,
  add column if not exists address_validation jsonb not null default '{}'::jsonb,
  add column if not exists stock_shortages jsonb not null default '[]'::jsonb,
  add column if not exists gate_checked_at timestamptz,
  add column if not exists unblocked_at timestamptz;

alter table public.shopify_orders
  drop constraint if exists shopify_orders_gate_status_check,
  drop constraint if exists shopify_orders_exception_type_check;

alter table public.shopify_orders
  add constraint shopify_orders_gate_status_check check (gate_status in (
    'da_verificare',
    'verifica_indirizzo',
    'eccezione_indirizzo',
    'verifica_stock',
    'eccezione_stock',
    'sbloccato',
    'ignorato'
  )),
  add constraint shopify_orders_exception_type_check check (
    exception_type is null or exception_type in ('indirizzo', 'stock')
  );

update public.shopify_orders
set
  gate_status = case when wms_status = 'annullato' then 'ignorato' else 'sbloccato' end,
  gate_checked_at = coalesce(gate_checked_at, now()),
  unblocked_at = case when wms_status <> 'annullato' then coalesce(unblocked_at, now()) else unblocked_at end
where gate_status = 'da_verificare';

alter table public.shopify_orders alter column wms_status set default 'in_verifica';

create index if not exists shopify_orders_gate_status_idx
  on public.shopify_orders(gate_status, updated_at desc);
create index if not exists shopify_orders_exception_type_idx
  on public.shopify_orders(exception_type, updated_at desc)
  where exception_type is not null;

create table if not exists public.wms_order_gate_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.shopify_orders(id) on delete cascade,
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  from_status text,
  to_status text not null,
  reason text,
  details jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists wms_order_gate_events_order_idx
  on public.wms_order_gate_events(order_id, created_at desc);

alter table public.wms_order_gate_events enable row level security;

create policy "wms_order_gate_events_read_own_or_staff" on public.wms_order_gate_events
  for select using (public.owns_cliente(cliente_id));
create policy "wms_order_gate_events_staff_insert" on public.wms_order_gate_events
  for insert with check (public.is_staff());

grant select, insert on public.wms_order_gate_events to authenticated;
