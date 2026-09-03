-- Keep a short-lived immutable packing snapshot for post-pack label checks.
create table if not exists public.wms_packing_label_audits (
  label_code text primary key,
  carrier text not null,
  order_id uuid not null,
  order_name text not null,
  bag_code text,
  packaging_code text,
  recipient_name text,
  items jsonb not null default '[]'::jsonb,
  completed_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists wms_packing_label_audits_expires_idx
  on public.wms_packing_label_audits(expires_at);

alter table public.wms_packing_label_audits enable row level security;

drop policy if exists "wms_packing_label_audits_staff_read" on public.wms_packing_label_audits;
create policy "wms_packing_label_audits_staff_read" on public.wms_packing_label_audits
  for select using (public.is_staff());

grant select on public.wms_packing_label_audits to authenticated;

create or replace function public.capture_wms_packing_label_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_completed_at timestamptz := coalesce(new.completed_at, now());
begin
  if new.stato <> 'completata' or new.carrier_label_code is null then
    return new;
  end if;

  delete from public.wms_packing_label_audits where expires_at <= now();

  insert into public.wms_packing_label_audits (
    label_code, carrier, order_id, order_name, bag_code, packaging_code,
    recipient_name, items, completed_at, expires_at
  )
  select
    new.carrier_label_code,
    coalesce(orders.selected_carrier, 'gls'),
    new.order_id,
    orders.order_name,
    new.bag_code,
    new.packaging_code,
    orders.ship_name,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', lines.id,
          'titolo', lines.titolo,
          'ean', lines.ean,
          'fnsku', lines.fnsku,
          'sku', lines.sku,
          'foto_url', lines.foto_url,
          'quantita_attesa', lines.quantita_attesa
        ) order by lines.created_at
      ) filter (where lines.id is not null),
      '[]'::jsonb
    ),
    v_completed_at,
    v_completed_at + interval '48 hours'
  from public.shopify_orders orders
  left join public.wms_packing_lines lines on lines.session_id = new.id
  where orders.id = new.order_id
  group by orders.id, orders.selected_carrier, orders.order_name, orders.ship_name
  on conflict (label_code) do update set
    carrier = excluded.carrier,
    order_id = excluded.order_id,
    order_name = excluded.order_name,
    bag_code = excluded.bag_code,
    packaging_code = excluded.packaging_code,
    recipient_name = excluded.recipient_name,
    items = excluded.items,
    completed_at = excluded.completed_at,
    expires_at = excluded.expires_at;

  return new;
end;
$$;

drop trigger if exists capture_wms_packing_label_audit on public.wms_packing_sessions;
create trigger capture_wms_packing_label_audit
after insert or update of stato, carrier_label_code on public.wms_packing_sessions
for each row execute function public.capture_wms_packing_label_audit();

create or replace function public.lookup_wms_packing_label_audit(p_label_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_staff() then
    raise exception 'Accesso riservato allo staff';
  end if;

  delete from public.wms_packing_label_audits where expires_at <= now();

  select to_jsonb(audit)
  into v_result
  from public.wms_packing_label_audits audit
  where upper(trim(audit.label_code)) = upper(trim(p_label_code))
    and audit.expires_at > now();

  if v_result is null then
    raise exception 'Etichetta non trovata oppure controllo scaduto dopo 48 ore';
  end if;
  return v_result;
end;
$$;

revoke all on function public.lookup_wms_packing_label_audit(text) from public;
grant execute on function public.lookup_wms_packing_label_audit(text) to authenticated;

create or replace function public.purge_expired_wms_packing_label_audits()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.wms_packing_label_audits where expires_at <= now();
$$;

revoke all on function public.purge_expired_wms_packing_label_audits() from public;

-- Supabase projects with pg_cron enabled purge hourly. Inserts and lookups also
-- purge expired rows, so retention remains enforced if the extension is disabled.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
    and not exists (select 1 from cron.job where jobname = 'purge-wms-packing-label-audits') then
    perform cron.schedule(
      'purge-wms-packing-label-audits',
      '17 * * * *',
      'select public.purge_expired_wms_packing_label_audits()'
    );
  end if;
exception when others then
  raise notice 'pg_cron non disponibile: pulizia audit eseguita su inserimento e consultazione';
end;
$$;

-- Make labels completed shortly before this feature immediately inspectable.
insert into public.wms_packing_label_audits (
  label_code, carrier, order_id, order_name, bag_code, packaging_code,
  recipient_name, items, completed_at, expires_at
)
select
  sessions.carrier_label_code,
  coalesce(orders.selected_carrier, 'gls'),
  sessions.order_id,
  orders.order_name,
  sessions.bag_code,
  sessions.packaging_code,
  orders.ship_name,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', lines.id,
        'titolo', lines.titolo,
        'ean', lines.ean,
        'fnsku', lines.fnsku,
        'sku', lines.sku,
        'foto_url', lines.foto_url,
        'quantita_attesa', lines.quantita_attesa
      ) order by lines.created_at
    ) filter (where lines.id is not null),
    '[]'::jsonb
  ),
  sessions.completed_at,
  sessions.completed_at + interval '48 hours'
from public.wms_packing_sessions sessions
join public.shopify_orders orders on orders.id = sessions.order_id
left join public.wms_packing_lines lines on lines.session_id = sessions.id
where sessions.stato = 'completata'
  and sessions.carrier_label_code is not null
  and sessions.completed_at > now() - interval '48 hours'
group by sessions.id, orders.id, orders.selected_carrier, orders.order_name, orders.ship_name
on conflict (label_code) do nothing;
