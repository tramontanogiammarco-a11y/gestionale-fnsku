alter table public.profiles
  add column if not exists is_operator boolean not null default false,
  add column if not exists operator_active boolean not null default true;

create index if not exists profiles_operator_idx
  on public.profiles (is_operator, operator_active, name)
  where is_operator = true;

comment on column public.profiles.is_operator is
  'Identifica gli account staff destinati esclusivamente alle operazioni di magazzino.';

comment on column public.profiles.operator_active is
  'Consente agli amministratori di sospendere un operatore senza eliminare lo storico.';
