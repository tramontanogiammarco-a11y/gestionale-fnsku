alter table public.preparazioni_righe
  add column if not exists quantita_originale integer,
  add column if not exists quantita_mancante integer not null default 0 check (quantita_mancante >= 0),
  add column if not exists motivo_rettifica text,
  add column if not exists rettificata_at timestamptz,
  add column if not exists rettificata_by uuid references auth.users(id) on delete set null;

update public.preparazioni_righe
set quantita_originale = quantita
where quantita_originale is null;

alter table public.preparazioni_righe
  alter column quantita_originale set not null;

create or replace function public.set_preparazione_original_quantity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.quantita_originale is null then new.quantita_originale := new.quantita; end if;
  return new;
end;
$$;

drop trigger if exists preparazioni_righe_original_quantity on public.preparazioni_righe;
create trigger preparazioni_righe_original_quantity
before insert on public.preparazioni_righe
for each row execute function public.set_preparazione_original_quantity();

create table if not exists public.preparazioni_rettifiche (
  id uuid primary key default gen_random_uuid(),
  preparazione_id uuid not null references public.preparazioni(id) on delete cascade,
  preparazione_riga_id uuid not null references public.preparazioni_righe(id) on delete cascade,
  quantita_precedente integer not null,
  quantita_effettiva integer not null,
  quantita_mancante integer not null check (quantita_mancante > 0),
  motivo text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.preparazioni_rettifiche enable row level security;
drop policy if exists "preparazioni_rettifiche_staff" on public.preparazioni_rettifiche;
create policy "preparazioni_rettifiche_staff" on public.preparazioni_rettifiche
  for all using (public.is_staff()) with check (public.is_staff());

create or replace function public.declare_preparazione_shortage(
  p_riga_id uuid,
  p_quantita_effettiva integer,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_row public.preparazioni_righe%rowtype;
  prep_status text;
  boxed_quantity integer := 0;
  other_requested integer := 0;
  missing_quantity integer;
begin
  if not public.is_staff() then raise exception 'Accesso riservato allo staff'; end if;

  select * into target_row from public.preparazioni_righe where id = p_riga_id for update;
  if target_row.id is null then raise exception 'Riga preparazione non trovata'; end if;
  select stato into prep_status from public.preparazioni where id = target_row.preparazione_id;
  if prep_status = 'spedito' then raise exception 'Una preparazione gia spedita non puo essere rettificata'; end if;
  if p_quantita_effettiva < 1 or p_quantita_effettiva >= target_row.quantita then
    raise exception 'La quantita effettiva deve essere compresa tra 1 e %', target_row.quantita - 1;
  end if;

  select coalesce(sum((item->>'quantita')::integer), 0)::integer into boxed_quantity
  from public.box b
  cross join lateral jsonb_array_elements(coalesce(b.contenuto, '[]'::jsonb)) item
  where b.preparazione_id = target_row.preparazione_id
    and item->>'ean' = target_row.ean;

  select coalesce(sum(r.quantita), 0)::integer into other_requested
  from public.preparazioni_righe r
  where r.preparazione_id = target_row.preparazione_id
    and r.ean = target_row.ean
    and r.id <> target_row.id;

  if p_quantita_effettiva + other_requested < boxed_quantity then
    raise exception 'Sono gia presenti % pezzi nei box: la quantita effettiva complessiva non puo essere inferiore', boxed_quantity;
  end if;

  missing_quantity := target_row.quantita - p_quantita_effettiva;
  update public.preparazioni_righe
  set quantita = p_quantita_effettiva,
      quantita_mancante = quantita_mancante + missing_quantity,
      motivo_rettifica = coalesce(nullif(trim(p_motivo), ''), 'Quantita fisica inferiore durante la preparazione'),
      rettificata_at = now(),
      rettificata_by = auth.uid()
  where id = p_riga_id;

  insert into public.preparazioni_rettifiche (
    preparazione_id, preparazione_riga_id, quantita_precedente, quantita_effettiva,
    quantita_mancante, motivo, created_by
  ) values (
    target_row.preparazione_id, target_row.id, target_row.quantita, p_quantita_effettiva,
    missing_quantity, coalesce(nullif(trim(p_motivo), ''), 'Quantita fisica inferiore durante la preparazione'), auth.uid()
  );

  return jsonb_build_object(
    'ok', true,
    'preparazione_id', target_row.preparazione_id,
    'riga_id', target_row.id,
    'quantita_effettiva', p_quantita_effettiva,
    'quantita_mancante', missing_quantity
  );
end;
$$;

revoke all on function public.declare_preparazione_shortage(uuid, integer, text) from public;
grant execute on function public.declare_preparazione_shortage(uuid, integer, text) to authenticated;

-- Corregge il caso operativo segnalato: 95 richiesti, 90 realmente trovati e gia inseriti nei box.
do $$
declare
  target record;
begin
  for target in
    select pr.id
    from public.preparazioni_righe pr
    join public.preparazioni p on p.id = pr.preparazione_id
    join public.clienti c on c.id = p.cliente_id
    where lower(c.ragione_sociale) = 'dvcommerce'
      and pr.ean = '8056389340543'
      and pr.quantita = 95
      and p.stato <> 'spedito'
  loop
    update public.preparazioni_righe
    set quantita = 90,
        quantita_mancante = 5,
        motivo_rettifica = 'Quantita fisica inferiore rilevata a fine preparazione',
        rettificata_at = now()
    where id = target.id;

    insert into public.preparazioni_rettifiche (
      preparazione_id, preparazione_riga_id, quantita_precedente, quantita_effettiva,
      quantita_mancante, motivo
    )
    select preparazione_id, id, 95, 90, 5, 'Quantita fisica inferiore rilevata a fine preparazione'
    from public.preparazioni_righe where id = target.id;
  end loop;
end;
$$;
