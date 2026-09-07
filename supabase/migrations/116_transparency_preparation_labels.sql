-- Amazon Transparency is a preparation service with labels attached per product row.
create table if not exists public.preparazioni_righe_transparency_labels (
  id uuid primary key default gen_random_uuid(),
  preparazione_riga_id uuid not null references public.preparazioni_righe(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  file_size bigint not null default 0 check (file_size >= 0),
  uploaded_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists preparazioni_righe_transparency_labels_row_idx
  on public.preparazioni_righe_transparency_labels(preparazione_riga_id, created_at);

alter table public.preparazioni_righe_transparency_labels enable row level security;

create policy "transparency_labels_read_own_or_staff"
on public.preparazioni_righe_transparency_labels for select
using (
  exists (
    select 1
    from public.preparazioni_righe r
    join public.preparazioni p on p.id = r.preparazione_id
    where r.id = preparazione_riga_id
      and public.owns_cliente(p.cliente_id)
  )
);

create policy "transparency_labels_insert_own_or_staff"
on public.preparazioni_righe_transparency_labels for insert
with check (
  exists (
    select 1
    from public.preparazioni_righe r
    join public.preparazioni p on p.id = r.preparazione_id
    where r.id = preparazione_riga_id
      and 'transparency' in (select jsonb_array_elements_text(r.servizi))
      and p.stato <> 'spedito'
      and public.owns_cliente(p.cliente_id)
  )
);

create policy "transparency_labels_delete_own_or_staff"
on public.preparazioni_righe_transparency_labels for delete
using (
  exists (
    select 1
    from public.preparazioni_righe r
    join public.preparazioni p on p.id = r.preparazione_id
    where r.id = preparazione_riga_id
      and p.stato <> 'spedito'
      and public.owns_cliente(p.cliente_id)
  )
);

grant select, insert, update, delete on public.preparazioni_righe_transparency_labels to authenticated;

create or replace function public.default_listino()
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'fnsku', 0.10,
    'transparency', 0,
    'busta', 0,
    'nastratura', 0,
    'pluriball', 0,
    'bundle', 0,
    'inscatolamento', 0,
    'scatola_60', 0,
    'scatola_40', 0,
    'stoccaggio_slot', 0,
    'stoccaggio_pallet', 0,
    'entrata_pallet', 0,
    'entrata_scatola', 0,
    'sped_gls_nazionale_base', 5.90,
    'sped_gls_speciale_base', 8.90,
    'sped_gls_kg_extra', 0.65,
    'sped_brt_nazionale_base', 6.20,
    'sped_brt_speciale_base', 8.40,
    'sped_brt_kg_extra', 0.55,
    'sped_peso_volumetrico_divisore', 5000,
    'wms_order_base_fee', 0,
    'wms_extra_item_fee', 0,
    'wms_pack_scatola_piccola', 0,
    'wms_pack_scatola_media', 0,
    'wms_pack_scatola_grande', 0,
    'wms_pack_busta_corriere', 0,
    'iva', 22
  );
$$;

update public.clienti
set listino = jsonb_build_object('transparency', 0) || coalesce(listino, '{}'::jsonb)
where not coalesce(listino, '{}'::jsonb) ? 'transparency';

insert into public.client_price_versions (cliente_id, price_key, amount, effective_from)
select c.id, 'transparency', coalesce((c.listino ->> 'transparency')::numeric, 0), c.created_at::date
from public.clienti c
on conflict (cliente_id, price_key, effective_from) do nothing;
