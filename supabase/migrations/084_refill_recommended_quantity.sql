-- Conserva separatamente il fabbisogno degli ordini e la quantita scelta dall'operatore.
alter table public.wms_refill_lines
  add column if not exists recommended_quantity integer;

update public.wms_refill_lines
set recommended_quantity = quantita
where recommended_quantity is null;

alter table public.wms_refill_lines
  alter column recommended_quantity set not null,
  add constraint wms_refill_lines_recommended_quantity_check
    check (recommended_quantity > 0 and recommended_quantity <= quantita);
