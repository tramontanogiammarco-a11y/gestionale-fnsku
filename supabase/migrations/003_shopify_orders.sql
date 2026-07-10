create table if not exists public.shopify_orders (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  shop_domain text not null,
  shopify_order_id text not null,
  order_name text not null,
  financial_status text,
  fulfillment_status text,
  wms_status text not null default 'da_preparare'
    check (wms_status in ('da_preparare', 'in_preparazione', 'pronto', 'spedito', 'annullato')),
  total_price numeric,
  currency text,
  processed_at timestamptz,
  tags text[] not null default '{}',
  note text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cliente_id, shop_domain, shopify_order_id)
);

create index if not exists shopify_orders_cliente_id_idx
  on public.shopify_orders(cliente_id);

create index if not exists shopify_orders_status_idx
  on public.shopify_orders(wms_status);

create table if not exists public.shopify_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.shopify_orders(id) on delete cascade,
  shopify_line_item_id text not null,
  referenza_id uuid references public.referenze(id) on delete set null,
  sku text,
  ean text,
  titolo text not null,
  quantita integer not null check (quantita > 0),
  fulfillable_quantity integer not null default 0,
  fulfillment_status text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, shopify_line_item_id)
);

create index if not exists shopify_order_items_order_id_idx
  on public.shopify_order_items(order_id);

create index if not exists shopify_order_items_referenza_id_idx
  on public.shopify_order_items(referenza_id);

alter table public.shopify_orders enable row level security;
alter table public.shopify_order_items enable row level security;

create policy "shopify_orders_read_own_or_staff" on public.shopify_orders
  for select using (public.owns_cliente(cliente_id));

create policy "shopify_orders_staff_write" on public.shopify_orders
  for all using (public.is_staff()) with check (public.is_staff());

create policy "shopify_order_items_read_own_or_staff" on public.shopify_order_items
  for select using (
    exists (
      select 1 from public.shopify_orders o
      where o.id = order_id and public.owns_cliente(o.cliente_id)
    )
  );

create policy "shopify_order_items_staff_write" on public.shopify_order_items
  for all using (public.is_staff()) with check (public.is_staff());
