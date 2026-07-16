alter table public.referenze
  alter column ean drop not null;

drop index if exists referenze_cliente_ean_unique_idx;
drop index if exists referenze_cliente_ean_unique;

create unique index if not exists referenze_cliente_ean_unique_idx
  on public.referenze(cliente_id, ean)
  where ean is not null;
