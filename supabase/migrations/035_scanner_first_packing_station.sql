-- Packing is driven by scanner events: bag, bag double-check, then carrier labels.
alter table public.wms_packing_sessions
  drop constraint if exists wms_packing_sessions_stato_check;

alter table public.wms_packing_sessions
  add constraint wms_packing_sessions_stato_check
  check (stato in (
    'da_imballare',
    'in_attesa_packing',
    'in_verifica_bag',
    'in_attesa_etichetta',
    'in_corso',
    'completata',
    'annullata'
  ));

alter table public.wms_packing_sessions
  add column if not exists bag_first_scanned_at timestamptz,
  add column if not exists bag_double_checked_at timestamptz,
  add column if not exists carrier_label_code text,
  add column if not exists carrier_label_printed_at timestamptz,
  add column if not exists carrier_label_scanned_at timestamptz;

create unique index if not exists wms_packing_sessions_carrier_label_code_key
  on public.wms_packing_sessions(carrier_label_code)
  where carrier_label_code is not null;

update public.wms_packing_sessions
set stato = 'in_attesa_packing'
where stato = 'da_imballare';
