-- Missioni refill a due fasi: prelievo pallet -> bag, poi deposito bag -> slot.
alter table public.wms_bags drop constraint if exists wms_bags_stato_check;
alter table public.wms_bags
  add constraint wms_bags_stato_check
  check (stato in ('disponibile', 'in_packing', 'in_refill'));

create table if not exists public.wms_refill_missions (
  id uuid primary key default gen_random_uuid(),
  stato text not null default 'configurazione'
    check (stato in ('configurazione', 'prelievo', 'deposito', 'completata', 'annullata')),
  operatore_id uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wms_refill_lines (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references public.wms_refill_missions(id) on delete cascade,
  cliente_id uuid not null references public.clienti(id) on delete restrict,
  order_ids uuid[] not null default '{}'::uuid[],
  product_key text not null,
  titolo text not null,
  ean text,
  fnsku text,
  source_location_id uuid not null references public.wms_locations(id) on delete restrict,
  target_location_id uuid not null references public.wms_locations(id) on delete restrict,
  quantita integer not null check (quantita > 0),
  bag_id uuid references public.wms_bags(id) on delete restrict,
  bag_code text check (bag_code is null or bag_code ~ '^B-[A-Z0-9]{5}$'),
  source_sequence integer not null check (source_sequence > 0),
  target_sequence integer not null check (target_sequence > 0),
  stato text not null default 'da_associare_bag'
    check (stato in ('da_associare_bag', 'da_prelevare', 'in_bag', 'completata', 'annullata')),
  pallet_scanned_at timestamptz,
  pick_bag_scanned_at timestamptz,
  putaway_bag_scanned_at timestamptz,
  slot_scanned_at timestamptz,
  moved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_location_id <> target_location_id),
  unique (mission_id, product_key, source_location_id, target_location_id)
);

create unique index if not exists wms_refill_one_active_mission_per_operator_idx
  on public.wms_refill_missions(operatore_id)
  where stato in ('configurazione', 'prelievo', 'deposito');

create unique index if not exists wms_refill_active_bag_idx
  on public.wms_refill_lines(bag_id)
  where bag_id is not null and stato not in ('completata', 'annullata');

create index if not exists wms_refill_lines_mission_source_idx
  on public.wms_refill_lines(mission_id, source_sequence);
create index if not exists wms_refill_lines_mission_target_idx
  on public.wms_refill_lines(mission_id, target_sequence);
create index if not exists wms_refill_lines_reservations_idx
  on public.wms_refill_lines(cliente_id, product_key, source_location_id)
  where stato in ('da_associare_bag', 'da_prelevare', 'in_bag');

alter table public.wms_refill_missions enable row level security;
alter table public.wms_refill_lines enable row level security;

create policy "wms_refill_missions_staff_access" on public.wms_refill_missions
  for all using (public.is_staff()) with check (public.is_staff());
create policy "wms_refill_lines_staff_access" on public.wms_refill_lines
  for all using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.wms_refill_missions to authenticated;
grant select, insert, update, delete on public.wms_refill_lines to authenticated;

create or replace function public.complete_wms_refill_line(
  p_line_id uuid,
  p_slot_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line public.wms_refill_lines%rowtype;
  v_mission public.wms_refill_missions%rowtype;
  v_target_code text;
  v_now timestamptz := now();
  v_transfer_id uuid;
  v_finished boolean;
begin
  if not public.is_staff() then
    raise exception 'Operazione non autorizzata';
  end if;

  select * into v_line
  from public.wms_refill_lines
  where id = p_line_id
  for update;
  if not found then raise exception 'Riga refill non trovata'; end if;

  select * into v_mission
  from public.wms_refill_missions
  where id = v_line.mission_id
  for update;

  if v_mission.stato <> 'deposito' or v_line.stato <> 'in_bag' then
    raise exception 'La riga refill non e pronta per il deposito';
  end if;
  if v_line.pallet_scanned_at is null or v_line.pick_bag_scanned_at is null
    or v_line.putaway_bag_scanned_at is null then
    raise exception 'Completa le scansioni pallet e bag prima dello slot';
  end if;

  select codice into v_target_code
  from public.wms_locations
  where id = v_line.target_location_id and stato = 'attiva';
  if v_target_code is null or upper(regexp_replace(v_target_code, '\\s+', '', 'g'))
      <> upper(regexp_replace(coalesce(p_slot_code, ''), '\\s+', '', 'g')) then
    raise exception 'Slot di destinazione errato';
  end if;

  perform 1 from public.wms_bags
  where id = v_line.bag_id and stato = 'in_refill'
  for update;
  if not found then raise exception 'Bag refill non disponibile'; end if;

  insert into public.wms_stock_transfers (
    cliente_id, product_key, source_location_id, target_location_id,
    quantita, order_id, operatore_id
  ) values (
    v_line.cliente_id, v_line.product_key, v_line.source_location_id,
    v_line.target_location_id, v_line.quantita, v_line.order_ids[1], auth.uid()
  ) returning id into v_transfer_id;

  update public.wms_refill_lines
  set stato = 'completata', slot_scanned_at = v_now, moved_at = v_now, updated_at = v_now
  where id = v_line.id;

  update public.wms_bags
  set stato = 'disponibile', updated_at = v_now
  where id = v_line.bag_id;

  select not exists (
    select 1 from public.wms_refill_lines
    where mission_id = v_line.mission_id and stato <> 'completata'
  ) into v_finished;

  if v_finished then
    update public.wms_refill_missions
    set stato = 'completata', completed_at = v_now, updated_at = v_now
    where id = v_line.mission_id;
  end if;

  return jsonb_build_object(
    'line_id', v_line.id,
    'mission_id', v_line.mission_id,
    'transfer_id', v_transfer_id,
    'mission_completed', v_finished
  );
end;
$$;

revoke all on function public.complete_wms_refill_line(uuid, text) from public;
grant execute on function public.complete_wms_refill_line(uuid, text) to authenticated;
