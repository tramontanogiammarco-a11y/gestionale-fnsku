-- Packaging is an explicit scanner step between the bag double-check and carrier label.
alter table public.wms_packing_sessions
  drop constraint if exists wms_packing_sessions_stato_check;

alter table public.wms_packing_sessions
  add constraint wms_packing_sessions_stato_check
  check (stato in (
    'da_imballare',
    'in_attesa_packing',
    'in_verifica_bag',
    'in_attesa_imballaggio',
    'in_attesa_etichetta',
    'in_corso',
    'completata',
    'annullata'
  ));

alter table public.wms_packing_sessions
  add column if not exists packaging_code text,
  add column if not exists packaging_scanned_at timestamptz;

create table if not exists public.wms_packaging_types (
  code text primary key,
  name text not null,
  barcode text not null unique,
  listino_key text not null unique,
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.wms_packaging_types (code, name, barcode, listino_key, stock_quantity)
values
  ('small_box', 'Scatola piccola', 'SCATOLA-PICCOLA', 'wms_pack_scatola_piccola', 100),
  ('medium_box', 'Scatola media', 'SCATOLA-MEDIA', 'wms_pack_scatola_media', 100),
  ('large_box', 'Scatola grande', 'SCATOLA-GRANDE', 'wms_pack_scatola_grande', 100),
  ('courier_bag', 'Busta corriere', 'BUSTA-CORRIERE', 'wms_pack_busta_corriere', 100)
on conflict (code) do update set
  name = excluded.name,
  barcode = excluded.barcode,
  listino_key = excluded.listino_key;

create table if not exists public.wms_order_packaging_usage (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.wms_packing_sessions(id) on delete cascade,
  order_id uuid not null unique references public.shopify_orders(id) on delete cascade,
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  packaging_code text not null references public.wms_packaging_types(code) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  unit_price_snapshot numeric not null default 0 check (unit_price_snapshot >= 0),
  operatore_id uuid references public.profiles(id) on delete set null,
  scanned_at timestamptz not null default now()
);

create table if not exists public.wms_packaging_stock_movements (
  id uuid primary key default gen_random_uuid(),
  packaging_code text not null references public.wms_packaging_types(code) on delete restrict,
  quantity_delta integer not null check (quantity_delta <> 0),
  reason text not null check (reason in ('packing', 'adjustment', 'receipt')),
  order_id uuid references public.shopify_orders(id) on delete set null,
  session_id uuid references public.wms_packing_sessions(id) on delete set null,
  operatore_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists wms_packaging_usage_client_date_idx
  on public.wms_order_packaging_usage(cliente_id, scanned_at);
create index if not exists wms_packaging_movements_code_date_idx
  on public.wms_packaging_stock_movements(packaging_code, created_at);

alter table public.wms_packaging_types enable row level security;
alter table public.wms_order_packaging_usage enable row level security;
alter table public.wms_packaging_stock_movements enable row level security;

create policy "wms_packaging_types_staff_access" on public.wms_packaging_types
  for all using (public.is_staff()) with check (public.is_staff());
create policy "wms_packaging_usage_staff_access" on public.wms_order_packaging_usage
  for all using (public.is_staff()) with check (public.is_staff());
create policy "wms_packaging_movements_staff_access" on public.wms_packaging_stock_movements
  for all using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.wms_packaging_types to authenticated;
grant select, insert, update, delete on public.wms_order_packaging_usage to authenticated;
grant select, insert, update, delete on public.wms_packaging_stock_movements to authenticated;

create or replace function public.register_wms_packaging(
  p_session_ids uuid[],
  p_barcode text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_packaging public.wms_packaging_types%rowtype;
  v_count integer;
  v_now timestamptz := now();
begin
  if not public.is_staff() then
    raise exception 'Accesso riservato allo staff';
  end if;

  select * into v_packaging
  from public.wms_packaging_types
  where upper(barcode) = upper(trim(p_barcode)) and active
  for update;

  if not found then
    raise exception 'Imballaggio non riconosciuto';
  end if;

  select count(*) into v_count
  from public.wms_packing_sessions s
  where s.id = any(p_session_ids)
    and s.stato = 'in_attesa_imballaggio'
    and not exists (
      select 1 from public.wms_order_packaging_usage u where u.session_id = s.id
    );

  if v_count = 0 then
    raise exception 'Nessun ordine attende la scansione dell''imballaggio';
  end if;
  if v_packaging.stock_quantity < v_count then
    raise exception 'Scorta insufficiente per %: disponibili %', v_packaging.name, v_packaging.stock_quantity;
  end if;

  insert into public.wms_order_packaging_usage (
    session_id, order_id, cliente_id, packaging_code,
    quantity, unit_price_snapshot, operatore_id, scanned_at
  )
  select
    s.id,
    s.order_id,
    o.cliente_id,
    v_packaging.code,
    1,
    coalesce((c.listino ->> v_packaging.listino_key)::numeric, 0),
    auth.uid(),
    v_now
  from public.wms_packing_sessions s
  join public.shopify_orders o on o.id = s.order_id
  join public.clienti c on c.id = o.cliente_id
  where s.id = any(p_session_ids)
    and s.stato = 'in_attesa_imballaggio'
  on conflict (session_id) do nothing;

  update public.wms_packaging_types
  set stock_quantity = stock_quantity - v_count, updated_at = v_now
  where code = v_packaging.code;

  insert into public.wms_packaging_stock_movements (
    packaging_code, quantity_delta, reason, order_id, session_id, operatore_id, created_at
  )
  select v_packaging.code, -1, 'packing', s.order_id, s.id, auth.uid(), v_now
  from public.wms_packing_sessions s
  where s.id = any(p_session_ids) and s.stato = 'in_attesa_imballaggio';

  update public.wms_packing_sessions
  set stato = 'in_attesa_etichetta',
      packaging_code = v_packaging.code,
      packaging_scanned_at = v_now,
      carrier_label_code = coalesce(
        carrier_label_code,
        'PK-' || upper(substr(replace(id::text, '-', ''), 1, 12))
      ),
      carrier_label_printed_at = v_now,
      updated_at = v_now
  where id = any(p_session_ids) and stato = 'in_attesa_imballaggio';

  return v_count;
end;
$$;

grant execute on function public.register_wms_packaging(uuid[], text) to authenticated;

