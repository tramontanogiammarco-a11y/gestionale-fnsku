do $$
declare
  target_user auth.users%rowtype;
begin
  select * into target_user
  from auth.users
  where lower(email) = 'tramontano.giammarco@gmail.com'
  limit 1;

  if target_user.id is null then
    raise exception 'Utente Auth tramontano.giammarco@gmail.com non trovato';
  end if;

  insert into public.profiles (id, email, name, role, cliente_id)
  values (
    target_user.id,
    lower(target_user.email),
    coalesce(target_user.raw_user_meta_data ->> 'name', 'Giammarco Tramontano'),
    'admin',
    null
  )
  on conflict (id) do update
  set
    email = excluded.email,
    name = coalesce(public.profiles.name, excluded.name),
    role = 'admin',
    cliente_id = null;
end;
$$;
