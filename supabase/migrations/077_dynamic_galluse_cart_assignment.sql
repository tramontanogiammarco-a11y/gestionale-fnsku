alter table public.wms_galluse_batches
  add column if not exists cart_id uuid references public.wms_carts(id) on delete restrict,
  add column if not exists cart_code text;

create unique index if not exists wms_galluse_batches_active_cart_idx
  on public.wms_galluse_batches(cart_id)
  where stato in ('da_associare_bag', 'in_corso');

create or replace function public.claim_wms_galluse_cart(
  p_batch_id uuid,
  p_cart_code text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_batch public.wms_galluse_batches%rowtype;
  v_cart public.wms_carts%rowtype;
  v_position_count integer;
  v_link_count integer;
  v_assigned_count integer;
  v_problem_bags text;
begin
  if not public.is_staff() then
    raise exception 'Permessi insufficienti';
  end if;

  select * into v_batch
  from public.wms_galluse_batches
  where id = p_batch_id
  for update;

  if not found then
    raise exception 'Missione Metodo Galluse non trovata';
  end if;
  if v_batch.stato <> 'da_associare_bag' then
    raise exception 'Il carrello Galluse non e in attesa di associazione';
  end if;

  select * into v_cart
  from public.wms_carts
  where codice = upper(trim(p_cart_code))
  for update;

  if not found then
    raise exception 'Carrello % non configurato', upper(trim(p_cart_code));
  end if;

  if exists (
    select 1
    from public.wms_galluse_batches other_batch
    where other_batch.cart_id = v_cart.id
      and other_batch.id <> v_batch.id
      and other_batch.stato in ('da_associare_bag', 'in_corso')
  ) then
    raise exception 'Il carrello % e gia in uso', v_cart.codice;
  end if;

  select count(*) into v_position_count
  from public.wms_cart_bag_positions position
  where position.cart_id = v_cart.id
    and position.posizione between 1 and v_batch.numero_bag;

  if v_position_count <> v_batch.numero_bag then
    raise exception 'Il carrello % non ha tutte le % bag richieste nelle prime posizioni', v_cart.codice, v_batch.numero_bag;
  end if;

  select count(*), count(bag_id)
  into v_link_count, v_assigned_count
  from public.wms_galluse_orders
  where batch_id = v_batch.id;

  if v_link_count <> v_batch.numero_bag then
    raise exception 'La missione non contiene il numero atteso di ordini';
  end if;

  perform bag.id
  from public.wms_cart_bag_positions position
  join public.wms_bags bag on bag.id = position.bag_id
  where position.cart_id = v_cart.id
    and position.posizione between 1 and v_batch.numero_bag
  for update of bag;

  if v_assigned_count = 0 then
    select string_agg(position.bag_code, ', ' order by position.posizione)
    into v_problem_bags
    from public.wms_cart_bag_positions position
    join public.wms_bags bag on bag.id = position.bag_id
    where position.cart_id = v_cart.id
      and position.posizione between 1 and v_batch.numero_bag
      and bag.stato <> 'disponibile';

    if v_problem_bags is not null then
      raise exception 'Le bag % sono ancora occupate al packing', v_problem_bags;
    end if;

    update public.wms_bags bag
    set stato = 'in_packing', updated_at = now()
    from public.wms_cart_bag_positions position
    where position.cart_id = v_cart.id
      and position.posizione between 1 and v_batch.numero_bag
      and bag.id = position.bag_id;

    update public.wms_galluse_orders galluse_order
    set bag_id = position.bag_id,
        bag_code = position.bag_code
    from public.wms_cart_bag_positions position
    where galluse_order.batch_id = v_batch.id
      and position.cart_id = v_cart.id
      and position.posizione = galluse_order.posizione_bag;
  elsif v_assigned_count = v_link_count then
    if exists (
      select 1
      from public.wms_galluse_orders galluse_order
      join public.wms_cart_bag_positions position
        on position.cart_id = v_cart.id
       and position.posizione = galluse_order.posizione_bag
      where galluse_order.batch_id = v_batch.id
        and galluse_order.bag_id is distinct from position.bag_id
    ) then
      raise exception 'Le bag della missione non corrispondono al carrello %', v_cart.codice;
    end if;
  else
    raise exception 'La missione ha una configurazione bag incompleta';
  end if;

  update public.wms_galluse_batches
  set cart_id = v_cart.id,
      cart_code = v_cart.codice,
      stato = 'in_corso',
      started_at = now(),
      updated_at = now()
  where id = v_batch.id;
end;
$$;

grant execute on function public.claim_wms_galluse_cart(uuid, text) to authenticated;
