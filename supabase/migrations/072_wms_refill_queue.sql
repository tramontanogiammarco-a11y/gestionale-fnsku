alter table public.shopify_orders
  drop constraint if exists shopify_orders_wms_status_check;

alter table public.shopify_orders
  add constraint shopify_orders_wms_status_check
  check (wms_status in (
    'in_verifica',
    'eccezione',
    'in_attesa_refill',
    'da_preparare',
    'in_preparazione',
    'in_attesa_packing',
    'in_packing',
    'imballato',
    'spedito',
    'annullato'
  ));

alter table public.shopify_orders
  add column if not exists refill_requirements jsonb not null default '[]'::jsonb;

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
    'ignorato'
  ));

create index if not exists shopify_orders_refill_queue_idx
  on public.shopify_orders(processed_at, created_at)
  where wms_status = 'in_attesa_refill';
