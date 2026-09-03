-- Consente di sostituire la scansione dello slot con il barcode del prodotto.
alter table public.referenze
  add column if not exists picking_scan_product_enabled boolean not null default false;

comment on column public.referenze.picking_scan_product_enabled is
  'Se attivo, durante il picking EAN, FNSKU o SKU confermano la posizione prevista al posto del barcode slot.';
