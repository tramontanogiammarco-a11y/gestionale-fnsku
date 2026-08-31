alter table public.shopify_orders
  drop constraint if exists shopify_orders_wms_status_check;

update public.shopify_orders
set wms_status = 'imballato'
where wms_status = 'pronto';

alter table public.shopify_orders
  add constraint shopify_orders_wms_status_check
  check (wms_status in (
    'in_verifica',
    'eccezione',
    'da_preparare',
    'in_preparazione',
    'in_attesa_packing',
    'in_packing',
    'imballato',
    'spedito',
    'annullato'
  ));
