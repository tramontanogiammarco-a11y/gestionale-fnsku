-- One append-only ledger for every warehouse operation.
create table if not exists public.wms_operational_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  entity_type text not null,
  entity_id text,
  cliente_id uuid references public.clienti(id) on delete set null,
  order_id uuid references public.shopify_orders(id) on delete set null,
  session_id uuid,
  operator_id uuid references public.profiles(id) on delete set null,
  source text not null default 'database',
  status_from text,
  status_to text,
  location_from_id uuid references public.wms_locations(id) on delete set null,
  location_to_id uuid references public.wms_locations(id) on delete set null,
  product_key text,
  quantity_delta integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists wms_operational_events_created_idx
  on public.wms_operational_events(created_at desc);
create index if not exists wms_operational_events_client_idx
  on public.wms_operational_events(cliente_id, created_at desc);
create index if not exists wms_operational_events_operator_idx
  on public.wms_operational_events(operator_id, created_at desc);
create index if not exists wms_operational_events_order_idx
  on public.wms_operational_events(order_id, created_at desc);

alter table public.wms_operational_events enable row level security;

drop policy if exists "wms_operational_events_read" on public.wms_operational_events;
create policy "wms_operational_events_read" on public.wms_operational_events
  for select using (
    public.is_staff()
    or (cliente_id is not null and public.owns_cliente(cliente_id))
  );

-- The application can append events, but existing rows cannot be edited or removed.
drop policy if exists "wms_operational_events_staff_insert" on public.wms_operational_events;
create policy "wms_operational_events_staff_insert" on public.wms_operational_events
  for insert with check (public.is_staff());

grant select, insert on public.wms_operational_events to authenticated;
revoke update, delete, truncate on public.wms_operational_events from authenticated;

create or replace function public.audit_shopify_order_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed boolean;
  v_event_type text;
begin
  v_changed := tg_op = 'INSERT'
    or old.wms_status is distinct from new.wms_status
    or old.gate_status is distinct from new.gate_status
    or old.exception_type is distinct from new.exception_type;
  if not v_changed then return new; end if;

  v_event_type := case
    when tg_op = 'INSERT' then 'order.created'
    when new.wms_status = 'eccezione' then 'order.exception'
    when new.wms_status = 'annullato' then 'order.cancelled'
    when new.wms_status = 'spedito' then 'order.shipped'
    else 'order.status_changed'
  end;

  insert into public.wms_operational_events (
    event_type, entity_type, entity_id, cliente_id, order_id, operator_id,
    status_from, status_to, metadata
  ) values (
    v_event_type, 'order', new.id::text, new.cliente_id, new.id, auth.uid(),
    case when tg_op = 'UPDATE' then old.wms_status else null end,
    new.wms_status,
    jsonb_build_object(
      'order_name', new.order_name,
      'gate_status', new.gate_status,
      'exception_type', new.exception_type,
      'exception_reasons', coalesce(new.exception_reasons, '[]'::jsonb)
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_audit_shopify_order on public.shopify_orders;
create trigger trg_audit_shopify_order
after insert or update on public.shopify_orders
for each row execute function public.audit_shopify_order_event();

create or replace function public.audit_wms_stock_transfer_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.wms_operational_events (
    event_type, entity_type, entity_id, cliente_id, order_id, operator_id,
    location_from_id, location_to_id, product_key, quantity_delta, metadata
  ) values (
    'stock.transferred', 'stock_transfer', new.id::text, new.cliente_id,
    new.order_id, coalesce(new.operatore_id, auth.uid()), new.source_location_id,
    new.target_location_id, new.product_key, new.quantita,
    jsonb_build_object('quantity', new.quantita)
  );
  return new;
end;
$$;

drop trigger if exists trg_audit_wms_stock_transfer on public.wms_stock_transfers;
create trigger trg_audit_wms_stock_transfer
after insert on public.wms_stock_transfers
for each row execute function public.audit_wms_stock_transfer_event();

create or replace function public.audit_wms_inbound_movement_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente_id uuid;
  v_product_key text;
begin
  select e.cliente_id,
    case when nullif(trim(er.fnsku), '') is not null then 'fnsku:' || lower(trim(er.fnsku))
         else 'ean:' || lower(trim(er.ean)) end
  into v_cliente_id, v_product_key
  from public.entrate_righe er
  join public.entrate e on e.id = er.entrata_id
  where er.id = new.entrata_riga_id;

  insert into public.wms_operational_events (
    event_type, entity_type, entity_id, cliente_id, session_id, operator_id,
    location_to_id, product_key, quantity_delta, metadata
  ) values (
    'inbound.received', 'inbound_movement', new.id::text, v_cliente_id,
    new.session_id, coalesce(new.created_by, auth.uid()), new.location_id,
    v_product_key, new.quantita,
    jsonb_build_object('disposition', new.disposizione, 'scan', new.codice_scansionato)
  );
  return new;
end;
$$;

drop trigger if exists trg_audit_wms_inbound_movement on public.wms_inbound_movements;
create trigger trg_audit_wms_inbound_movement
after insert on public.wms_inbound_movements
for each row execute function public.audit_wms_inbound_movement_event();

create or replace function public.audit_wms_outbound_movement_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.wms_operational_events (
    event_type, entity_type, entity_id, cliente_id, order_id, operator_id,
    location_from_id, product_key, quantity_delta, metadata
  ) values (
    'picking.stock_removed', 'outbound_movement', new.id::text, new.cliente_id,
    new.order_id, coalesce(new.operatore_id, auth.uid()), new.location_id,
    new.product_key, -new.quantita,
    jsonb_build_object('quantity', new.quantita)
  );
  return new;
end;
$$;

drop trigger if exists trg_audit_wms_outbound_movement on public.wms_outbound_movements;
create trigger trg_audit_wms_outbound_movement
after insert on public.wms_outbound_movements
for each row execute function public.audit_wms_outbound_movement_event();

create or replace function public.audit_wms_inventory_count_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
    and old.quantita_contata is not distinct from new.quantita_contata
    and old.verificata is not distinct from new.verificata then
    return new;
  end if;
  insert into public.wms_operational_events (
    event_type, entity_type, entity_id, cliente_id, session_id, operator_id,
    location_to_id, product_key, quantity_delta, metadata
  ) values (
    case when new.verificata then 'inventory.verified' else 'inventory.counted' end,
    'inventory_count', new.id::text, new.cliente_id, new.session_id,
    coalesce(new.created_by, auth.uid()), new.location_id, new.product_key,
    new.quantita_contata - new.quantita_attesa,
    jsonb_build_object('expected', new.quantita_attesa, 'counted', new.quantita_contata, 'title', new.titolo)
  );
  return new;
end;
$$;

drop trigger if exists trg_audit_wms_inventory_count on public.wms_inventory_counts;
create trigger trg_audit_wms_inventory_count
after insert or update on public.wms_inventory_counts
for each row execute function public.audit_wms_inventory_count_event();

create or replace function public.audit_wms_session_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_status_from text;
  v_status_to text := v_new ->> 'stato';
  v_operator_id uuid;
  v_order_id uuid;
  v_cliente_id uuid;
  v_event_prefix text;
begin
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_status_from := v_old ->> 'stato';
    if v_status_from is not distinct from v_status_to
      and (v_old ->> 'operatore_id') is not distinct from (v_new ->> 'operatore_id') then
      return new;
    end if;
  end if;

  v_operator_id := coalesce(nullif(v_new ->> 'operatore_id', '')::uuid, auth.uid());
  v_order_id := nullif(v_new ->> 'order_id', '')::uuid;
  v_cliente_id := nullif(v_new ->> 'cliente_id', '')::uuid;
  if v_cliente_id is null and v_order_id is not null then
    select cliente_id into v_cliente_id from public.shopify_orders where id = v_order_id;
  end if;
  if v_cliente_id is null and nullif(v_new ->> 'entrata_id', '') is not null then
    select cliente_id into v_cliente_id from public.entrate where id = (v_new ->> 'entrata_id')::uuid;
  end if;

  v_event_prefix := case tg_table_name
    when 'wms_pick_tasks' then 'picking'
    when 'wms_mass_pick_batches' then 'picking.massivo'
    when 'wms_galluse_batches' then 'picking.galluse'
    when 'wms_packing_sessions' then 'packing'
    when 'wms_inbound_sessions' then 'inbound'
    when 'wms_inventory_sessions' then 'inventory'
    else 'operation'
  end;

  insert into public.wms_operational_events (
    event_type, entity_type, entity_id, cliente_id, order_id, session_id,
    operator_id, status_from, status_to, metadata
  ) values (
    v_event_prefix || '.status_changed', tg_table_name, new.id::text,
    v_cliente_id, v_order_id, new.id, v_operator_id, v_status_from, v_status_to,
    jsonb_strip_nulls(jsonb_build_object(
      'bag_code', v_new ->> 'bag_code',
      'station_code', v_new ->> 'station_code',
      'number_of_bags', v_new ->> 'numero_bag'
    ))
  );
  return new;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'wms_pick_tasks', 'wms_mass_pick_batches', 'wms_galluse_batches',
    'wms_packing_sessions', 'wms_inbound_sessions', 'wms_inventory_sessions'
  ] loop
    execute format('drop trigger if exists trg_audit_%I on public.%I', v_table, v_table);
    execute format(
      'create trigger trg_audit_%I after insert or update on public.%I for each row execute function public.audit_wms_session_event()',
      v_table, v_table
    );
  end loop;
end;
$$;

create or replace function public.audit_wms_packaging_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente_id uuid;
begin
  if new.order_id is not null then
    select cliente_id into v_cliente_id from public.shopify_orders where id = new.order_id;
  end if;
  insert into public.wms_operational_events (
    event_type, entity_type, entity_id, cliente_id, order_id, session_id,
    operator_id, product_key, quantity_delta, metadata
  ) values (
    'packing.packaging_used', 'packaging_movement', new.id::text, v_cliente_id,
    new.order_id, new.session_id, coalesce(new.operatore_id, auth.uid()),
    'packaging:' || new.packaging_code, new.quantity_delta,
    jsonb_build_object('reason', new.reason, 'packaging_code', new.packaging_code)
  );
  return new;
end;
$$;

drop trigger if exists trg_audit_wms_packaging on public.wms_packaging_stock_movements;
create trigger trg_audit_wms_packaging
after insert on public.wms_packaging_stock_movements
for each row execute function public.audit_wms_packaging_event();

create or replace function public.audit_preparazione_shortage_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cliente_id uuid;
begin
  select cliente_id into v_cliente_id
  from public.preparazioni where id = new.preparazione_id;
  insert into public.wms_operational_events (
    event_type, entity_type, entity_id, cliente_id, operator_id,
    product_key, quantity_delta, metadata
  ) values (
    'amazon_prep.shortage_declared', 'preparazioni_rettifiche', new.id::text,
    v_cliente_id, coalesce(new.created_by, auth.uid()), null, -new.quantita_mancante,
    jsonb_build_object(
      'preparation_id', new.preparazione_id,
      'line_id', new.preparazione_riga_id,
      'previous_quantity', new.quantita_precedente,
      'effective_quantity', new.quantita_effettiva,
      'reason', new.motivo
    )
  );
  return new;
end;
$$;

drop trigger if exists trg_audit_preparazione_shortage on public.preparazioni_rettifiche;
create trigger trg_audit_preparazione_shortage
after insert on public.preparazioni_rettifiche
for each row execute function public.audit_preparazione_shortage_event();

comment on table public.wms_operational_events is
  'Registro operativo append-only: unica fonte per audit, Control Room e tracciabilita operatore.';
