-- Lo scanner universale consulta la cronologia recente per codice bag.
create index if not exists wms_packing_label_audits_bag_expires_idx
  on public.wms_packing_label_audits(bag_code, expires_at desc)
  where bag_code is not null;

create index if not exists wms_refill_lines_bag_created_idx
  on public.wms_refill_lines(bag_code, created_at desc)
  where bag_code is not null;
