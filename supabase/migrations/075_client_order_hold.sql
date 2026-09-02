alter table public.shopify_orders
  drop constraint if exists shopify_orders_wms_status_check;

alter table public.shopify_orders
  add constraint shopify_orders_wms_status_check
  check (wms_status in (
    'in_verifica',
    'eccezione',
    'in_attesa_refill',
    'da_preparare',
    'hold',
    'in_preparazione',
    'in_attesa_packing',
    'in_packing',
    'imballato',
    'spedito',
    'annullato'
  ));

alter table public.shopify_orders
  drop constraint if exists shopify_orders_gate_status_check;

alter table public.shopify_orders
  add constraint shopify_orders_gate_status_check check (gate_status in (
    'da_verificare',
    'verifica_indirizzo',
    'eccezione_indirizzo',
    'verifica_stock',
    'eccezione_stock',
    'attesa_refill',
    'sbloccato',
    'hold_cliente',
    'ignorato'
  ));

alter table public.shopify_orders
  add column if not exists hold_previous_status text,
  add column if not exists hold_previous_gate_status text,
  add column if not exists held_at timestamptz,
  add column if not exists held_by uuid references public.profiles(id) on delete set null;

create index if not exists shopify_orders_hold_idx
  on public.shopify_orders(cliente_id, held_at desc)
  where wms_status = 'hold';
