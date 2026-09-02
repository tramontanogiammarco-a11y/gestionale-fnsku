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

  insert into public.profiles (
    id,
    email,
    name,
    role,
    cliente_id,
    is_operator,
    operator_active
  )
  values (
    target_user.id,
    lower(target_user.email),
    coalesce(target_user.raw_user_meta_data ->> 'name', 'Giammarco Tramontano'),
    'admin',
    null,
    false,
    true
  )
  on conflict (id) do update
  set
    email = excluded.email,
    name = coalesce(nullif(public.profiles.name, ''), excluded.name),
    role = 'admin',
    cliente_id = null,
    is_operator = false,
    operator_active = true;

  update auth.users
  set
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
      || jsonb_build_object('name', 'Giammarco Tramontano', 'role', 'admin'),
    raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || jsonb_build_object('role', 'admin'),
    updated_at = now()
  where id = target_user.id;
end;
$$;
