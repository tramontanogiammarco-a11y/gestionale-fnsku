create table if not exists public.shopify_connections (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  shop_domain text not null,
  access_token text not null,
  scopes text[] not null default '{}',
  connected_by uuid references auth.users(id) on delete set null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cliente_id, shop_domain)
);

create index if not exists shopify_connections_cliente_id_idx
  on public.shopify_connections(cliente_id);

alter table public.shopify_connections enable row level security;

create policy "shopify_connections_staff_read" on public.shopify_connections
  for select using (public.is_staff());

create policy "shopify_connections_staff_write" on public.shopify_connections
  for all using (public.is_staff()) with check (public.is_staff());
