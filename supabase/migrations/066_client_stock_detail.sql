drop policy if exists "wms_locations_client_read" on public.wms_locations;
create policy "wms_locations_client_read" on public.wms_locations
  for select using (auth.uid() is not null);

drop policy if exists "wms_inbound_movements_client_read" on public.wms_inbound_movements;
create policy "wms_inbound_movements_client_read" on public.wms_inbound_movements
  for select using (
    exists (
      select 1
      from public.entrate_righe er
      join public.entrate e on e.id = er.entrata_id
      where er.id = wms_inbound_movements.entrata_riga_id
        and public.owns_cliente(e.cliente_id)
    )
  );

drop policy if exists "wms_stock_transfers_client_read" on public.wms_stock_transfers;
create policy "wms_stock_transfers_client_read" on public.wms_stock_transfers
  for select using (public.owns_cliente(cliente_id));

drop policy if exists "wms_outbound_movements_client_read" on public.wms_outbound_movements;
create policy "wms_outbound_movements_client_read" on public.wms_outbound_movements
  for select using (public.owns_cliente(cliente_id));

drop policy if exists "wms_inventory_counts_client_read" on public.wms_inventory_counts;
create policy "wms_inventory_counts_client_read" on public.wms_inventory_counts
  for select using (public.owns_cliente(cliente_id));

drop policy if exists "wms_inventory_sessions_client_read" on public.wms_inventory_sessions;
create policy "wms_inventory_sessions_client_read" on public.wms_inventory_sessions
  for select using (
    exists (
      select 1
      from public.wms_inventory_counts count_row
      where count_row.session_id = wms_inventory_sessions.id
        and public.owns_cliente(count_row.cliente_id)
    )
  );

create or replace function public.cascade_wms_product_key(
  p_cliente_id uuid,
  p_old_key text,
  p_new_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_staff() or public.owns_cliente(p_cliente_id)) then
    raise exception 'Accesso negato';
  end if;
  if nullif(trim(p_old_key), '') is null or nullif(trim(p_new_key), '') is null then
    raise exception 'Chiavi prodotto non valide';
  end if;

  update public.wms_stock_transfers
  set product_key = p_new_key
  where cliente_id = p_cliente_id and product_key = p_old_key;

  update public.wms_outbound_movements
  set product_key = p_new_key
  where cliente_id = p_cliente_id and product_key = p_old_key;

  update public.wms_inventory_counts
  set product_key = p_new_key
  where cliente_id = p_cliente_id and product_key = p_old_key;
end;
$$;

revoke all on function public.cascade_wms_product_key(uuid, text, text) from public;
grant execute on function public.cascade_wms_product_key(uuid, text, text) to authenticated;
