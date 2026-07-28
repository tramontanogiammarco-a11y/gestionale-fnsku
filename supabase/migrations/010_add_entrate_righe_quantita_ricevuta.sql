alter table public.entrate_righe
  add column if not exists quantita_ricevuta integer
  check (quantita_ricevuta is null or quantita_ricevuta >= 0);

update public.entrate_righe r
set quantita_ricevuta = r.quantita
from public.entrate e
where r.entrata_id = e.id
  and e.stato in ('ricevuto', 'in_lavorazione', 'pronto', 'spedito')
  and r.quantita_ricevuta is null;
