-- Older received documents were imported with quantita_ricevuta = 0.
-- Restore their declared quantities once; future partial receipts keep using
-- the quantities explicitly recorded by the receiving workflow.
update public.entrate_righe as row
set quantita_ricevuta = row.quantita
from public.entrate as entry
where row.entrata_id = entry.id
  and entry.stato in ('ricevuto', 'in_lavorazione', 'pronto', 'spedito')
  and entry.data_ricezione is not null
  and coalesce(row.quantita_ricevuta, 0) = 0
  and row.quantita > 0;
