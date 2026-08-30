create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  order_id uuid references public.shopify_orders(id) on delete set null,
  subject text not null,
  category text not null default 'ordine' check (category in ('ordine', 'spedizione', 'stock', 'reso', 'fatturazione', 'altro')),
  status text not null default 'aperto' check (status in ('aperto', 'in_lavorazione', 'attesa_cliente', 'attesa_corriere', 'risolto', 'chiuso')),
  priority text not null default 'normale' check (priority in ('bassa', 'normale', 'alta', 'urgente')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.wms_shipments drop constraint if exists wms_shipments_stato_check;
alter table public.wms_shipments add constraint wms_shipments_stato_check check (stato in (
  'bozza', 'da_inviare', 'creata', 'in_transito', 'in_consegna', 'consegnata',
  'giacenza', 'indirizzo_errato', 'consegna_fallita', 'ritardo', 'danneggiata',
  'smarrita', 'rientro_mittente', 'errore', 'annullata'
));
alter table public.wms_shipments
  add column if not exists tracking_updated_at timestamptz,
  add column if not exists delivered_at timestamptz;

create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null,
  internal boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.wms_returns (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clienti(id) on delete cascade,
  order_id uuid references public.shopify_orders(id) on delete set null,
  shipment_id uuid references public.wms_shipments(id) on delete set null,
  status text not null default 'richiesto' check (status in ('richiesto', 'autorizzato', 'in_transito', 'ricevuto', 'controllato', 'reintegrato', 'rimborsato', 'chiuso')),
  reason text,
  tracking text,
  notes text,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_cliente_status_idx on public.support_tickets(cliente_id, status, updated_at desc);
create index if not exists support_tickets_order_idx on public.support_tickets(order_id);
create index if not exists support_ticket_messages_ticket_idx on public.support_ticket_messages(ticket_id, created_at);
create index if not exists wms_returns_cliente_status_idx on public.wms_returns(cliente_id, status, updated_at desc);

create or replace function public.touch_support_ticket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.support_tickets set updated_at = now() where id = new.ticket_id;
  return new;
end;
$$;

drop trigger if exists support_ticket_message_touch on public.support_ticket_messages;
create trigger support_ticket_message_touch
after insert on public.support_ticket_messages
for each row execute function public.touch_support_ticket();

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;
alter table public.wms_returns enable row level security;

create policy "support_tickets_read_own_or_staff" on public.support_tickets
  for select using (public.owns_cliente(cliente_id));
create policy "support_tickets_insert_own_or_staff" on public.support_tickets
  for insert with check (public.owns_cliente(cliente_id) and created_by = auth.uid());
create policy "support_tickets_staff_update" on public.support_tickets
  for update using (public.is_staff()) with check (public.is_staff());

create policy "support_messages_read_own_or_staff" on public.support_ticket_messages
  for select using (exists (
    select 1 from public.support_tickets t
    where t.id = ticket_id and public.owns_cliente(t.cliente_id)
  ) and (not internal or public.is_staff()));
create policy "support_messages_insert_own_or_staff" on public.support_ticket_messages
  for insert with check (
    author_id = auth.uid()
    and (not internal or public.is_staff())
    and exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id and public.owns_cliente(t.cliente_id)
    )
  );

create policy "wms_returns_read_own_or_staff" on public.wms_returns
  for select using (public.owns_cliente(cliente_id));
create policy "wms_returns_insert_own_or_staff" on public.wms_returns
  for insert with check (public.owns_cliente(cliente_id) and created_by = auth.uid());
create policy "wms_returns_staff_update" on public.wms_returns
  for update using (public.is_staff()) with check (public.is_staff());

grant select, insert, update on public.support_tickets to authenticated;
grant select, insert on public.support_ticket_messages to authenticated;
grant select, insert, update on public.wms_returns to authenticated;
