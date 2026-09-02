drop policy if exists "wms_packaging_usage_client_read_own" on public.wms_order_packaging_usage;

create policy "wms_packaging_usage_client_read_own"
on public.wms_order_packaging_usage
for select
using (public.owns_cliente(cliente_id));
