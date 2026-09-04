-- Mantiene il limite fisico del pallet anche quando la quantita viene scelta
-- dall'operatore dopo la scansione dell'origine.
alter table public.wms_refill_lines
  add column if not exists maximum_quantity integer;

update public.wms_refill_lines
set maximum_quantity = quantita
where maximum_quantity is null;

alter table public.wms_refill_lines
  alter column maximum_quantity set not null,
  add constraint wms_refill_lines_maximum_quantity_check
    check (maximum_quantity > 0 and quantita <= maximum_quantity);
