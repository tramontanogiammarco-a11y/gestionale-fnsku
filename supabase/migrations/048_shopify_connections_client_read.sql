drop policy if exists "shopify_connections_client_read_own" on public.shopify_connections;

create policy "shopify_connections_client_read_own" on public.shopify_connections
  for select using (
    cliente_id = public.current_cliente_id()
  );
