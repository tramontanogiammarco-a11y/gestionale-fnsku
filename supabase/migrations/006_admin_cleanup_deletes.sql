create or replace function public.admin_delete_entrata(entrata_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  if not public.is_staff() then
    raise exception 'Accesso riservato allo staff';
  end if;

  delete from public.entrate
  where id = entrata_id;

  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
end;
$$;

grant execute on function public.admin_delete_entrata(uuid) to authenticated;

create or replace function public.admin_delete_preparazione(prep_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  if not public.is_staff() then
    raise exception 'Accesso riservato allo staff';
  end if;

  delete from public.preparazioni
  where id = prep_id;

  get diagnostics deleted_count = row_count;
  return deleted_count > 0;
end;
$$;

grant execute on function public.admin_delete_preparazione(uuid) to authenticated;
