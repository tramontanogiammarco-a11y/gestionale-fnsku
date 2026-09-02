-- Associa a una posizione fisica lo stock contabile gia ricevuto, senza creare
-- nuove unita. Le quantita vengono sempre limitate dal residuo non ubicato.
create table if not exists public.wms_stock_placements (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  product_key text not null,
  location_id uuid not null references public.wms_locations(id) on delete restrict,
  quantita integer not null check (quantita > 0),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (cliente_id, product_key, location_id)
);

create index if not exists wms_stock_placements_product_idx
  on public.wms_stock_placements(cliente_id, product_key);

alter table public.wms_stock_placements enable row level security;

drop policy if exists "wms_stock_placements_read" on public.wms_stock_placements;
create policy "wms_stock_placements_read" on public.wms_stock_placements
  for select using (public.is_staff() or public.owns_cliente(cliente_id));

drop policy if exists "wms_stock_placements_staff_write" on public.wms_stock_placements;
create policy "wms_stock_placements_staff_write" on public.wms_stock_placements
  for all using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.wms_stock_placements to authenticated;

-- Lo stock storico Relifebattery era contabilmente disponibile ma privo di
-- ubicazione. Ne assegniamo fino a 100 pezzi per referenza a pallet sparsi.
with relife as (
  select id
  from public.clienti
  where lower(trim(ragione_sociale)) in ('relifebattery', 'relife battery')
     or lower(trim(email)) in ('relifebattery@gmail.com', 'relifebatterys@gmail.com')
  order by case when lower(trim(ragione_sociale)) = 'relifebattery' then 0 else 1 end
  limit 1
), products as (
  select
    reference.cliente_id,
    case
      when nullif(trim(reference.fnsku), '') is not null then 'fnsku:' || lower(trim(reference.fnsku))
      when nullif(trim(reference.ean), '') is not null then 'ean:' || lower(trim(reference.ean))
      else 'sku:' || lower(trim(reference.sku))
    end as product_key,
    reference.id as reference_id
  from public.referenze reference
  join relife on relife.id = reference.cliente_id
  where coalesce(reference.is_bundle, false) = false
    and coalesce(nullif(trim(reference.fnsku), ''), nullif(trim(reference.ean), ''), nullif(trim(reference.sku), '')) is not null
), placements as (
  select
    product.cliente_id,
    product.product_key,
    pallet.id as location_id,
    row_number() over (partition by product.reference_id order by md5(pallet.id::text || product.reference_id::text)) as choice
  from products product
  cross join public.wms_locations pallet
  where pallet.tipo = 'pallet' and pallet.stato = 'attiva'
)
insert into public.wms_stock_placements (cliente_id, product_key, location_id, quantita, note)
select cliente_id, product_key, location_id, 100, 'Ubicazione overstock Relifebattery esistente'
from placements
where choice = 1
on conflict (cliente_id, product_key, location_id) do update
set quantita = excluded.quantita,
    note = excluded.note;

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

  update public.wms_stock_placements
  set product_key = p_new_key
  where cliente_id = p_cliente_id and product_key = p_old_key;
end;
$$;

revoke all on function public.cascade_wms_product_key(uuid, text, text) from public;
grant execute on function public.cascade_wms_product_key(uuid, text, text) to authenticated;
