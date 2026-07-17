with ranked_title_only_refs as (
  select
    id,
    row_number() over (
      partition by cliente_id, lower(btrim(titolo))
      order by
        case when nullif(btrim(coalesce(ean, '')), '') is not null then 0 else 1 end,
        created_at,
        id
    ) as rn
  from public.referenze
  where not is_bundle
    and nullif(btrim(titolo), '') is not null
    and (
      nullif(btrim(coalesce(ean, '')), '') is null
      or lower(btrim(ean)) = lower(btrim(titolo))
    )
)
delete from public.referenze r
using ranked_title_only_refs d
where r.id = d.id
  and d.rn > 1;

create unique index if not exists referenze_cliente_title_only_unique_idx
  on public.referenze(cliente_id, (lower(btrim(titolo))))
  where not is_bundle
    and nullif(btrim(titolo), '') is not null
    and (
      nullif(btrim(coalesce(ean, '')), '') is null
      or lower(btrim(ean)) = lower(btrim(titolo))
    );
