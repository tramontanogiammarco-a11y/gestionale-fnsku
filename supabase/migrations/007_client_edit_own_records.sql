create policy "entrate_update_own_or_staff" on public.entrate
  for update using (public.owns_cliente(cliente_id)) with check (public.owns_cliente(cliente_id));

create policy "entrate_delete_own_or_staff" on public.entrate
  for delete using (public.owns_cliente(cliente_id));

create policy "preparazioni_update_own_or_staff" on public.preparazioni
  for update using (public.owns_cliente(cliente_id)) with check (public.owns_cliente(cliente_id));

create policy "preparazioni_delete_own_or_staff" on public.preparazioni
  for delete using (public.owns_cliente(cliente_id));
