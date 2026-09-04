update public.clienti
set listino = jsonb_build_object('bundle', 0) || coalesce(listino, '{}'::jsonb)
where not coalesce(listino, '{}'::jsonb) ? 'bundle';

create or replace function public.enforce_admin_preparazione_service_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.servizi is not distinct from new.servizi then
    return new;
  end if;

  if auth.role() = 'service_role' or exists (
    select 1
    from public.profiles
    where id = auth.uid() and role = 'admin'
  ) then
    if exists (
      select 1
      from public.preparazioni
      where id = new.preparazione_id and stato = 'spedito'
    ) then
      raise exception 'Le lavorazioni di una preparazione completata non possono essere modificate';
    end if;
    return new;
  end if;

  raise exception 'Le lavorazioni di una preparazione inviata possono essere modificate solo da un amministratore';
end;
$$;

drop trigger if exists preparazioni_righe_admin_services on public.preparazioni_righe;
create trigger preparazioni_righe_admin_services
before update of servizi on public.preparazioni_righe
for each row execute function public.enforce_admin_preparazione_service_changes();

