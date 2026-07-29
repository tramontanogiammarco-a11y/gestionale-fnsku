alter table public.preparazioni_righe
  add column if not exists stato text not null default 'richiesta'
    check (stato in ('richiesta', 'in_lavorazione', 'pronto', 'spedito')),
  add column if not exists data_in_lavorazione timestamptz,
  add column if not exists data_pronto timestamptz;

update public.preparazioni_righe pr
set
  stato = p.stato,
  data_in_lavorazione = case
    when p.stato in ('in_lavorazione', 'pronto', 'spedito') then coalesce(pr.data_in_lavorazione, p.created_at)
    else pr.data_in_lavorazione
  end,
  data_pronto = case
    when p.stato in ('pronto', 'spedito') then coalesce(pr.data_pronto, p.data_pronto, p.created_at)
    else pr.data_pronto
  end
from public.preparazioni p
where pr.preparazione_id = p.id
  and pr.stato = 'richiesta';

create index if not exists preparazioni_righe_stato_idx on public.preparazioni_righe(stato);
