-- Read-only picking snapshot: current physical balances without rebuilding the full stock UI payload.
create or replace function public.wms_picking_stock_balances(p_cliente_id uuid)
returns table (
  location_id uuid,
  product_key text,
  quantity bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with deltas as (
    select
      movement.location_id,
      entry.cliente_id,
      case
        when nullif(trim(row.fnsku), '') is not null then 'fnsku:' || lower(trim(row.fnsku))
        when nullif(trim(row.ean), '') is not null then 'ean:' || lower(trim(row.ean))
      end as product_key,
      movement.quantita::bigint as quantity
    from public.wms_inbound_movements movement
    join public.entrate_righe row on row.id = movement.entrata_riga_id
    join public.entrate entry on entry.id = row.entrata_id
    where entry.cliente_id = p_cliente_id
      and movement.disposizione = 'disponibile'
      and movement.location_id is not null

    union all

    select placement.location_id, placement.cliente_id,
      lower(trim(placement.product_key)), placement.quantita::bigint
    from public.wms_stock_placements placement
    where placement.cliente_id = p_cliente_id

    union all

    select transfer.source_location_id, transfer.cliente_id,
      lower(trim(transfer.product_key)), -transfer.quantita::bigint
    from public.wms_stock_transfers transfer
    where transfer.cliente_id = p_cliente_id

    union all

    select transfer.target_location_id, transfer.cliente_id,
      lower(trim(transfer.product_key)), transfer.quantita::bigint
    from public.wms_stock_transfers transfer
    where transfer.cliente_id = p_cliente_id

    union all

    select count.location_id, count.cliente_id, lower(trim(count.product_key)),
      (count.quantita_contata - count.quantita_attesa)::bigint
    from public.wms_inventory_counts count
    join public.wms_inventory_sessions session on session.id = count.session_id
    where count.cliente_id = p_cliente_id
      and session.stato = 'completata'

    union all

    select movement.location_id, movement.cliente_id,
      lower(trim(movement.product_key)), -movement.quantita::bigint
    from public.wms_outbound_movements movement
    where movement.cliente_id = p_cliente_id
  )
  select delta.location_id, delta.product_key, sum(delta.quantity)::bigint
  from deltas delta
  join public.wms_locations location on location.id = delta.location_id
  where delta.product_key is not null
    and location.tipo in ('slot', 'pallet')
  group by delta.location_id, delta.product_key
  having sum(delta.quantity) > 0;
$$;

revoke all on function public.wms_picking_stock_balances(uuid) from public;
grant execute on function public.wms_picking_stock_balances(uuid) to authenticated;

create index if not exists shopify_orders_operational_sort_idx
  on public.shopify_orders(processed_at desc, created_at desc, order_name desc)
  where wms_status <> 'annullato';

create index if not exists shopify_orders_client_operational_sort_idx
  on public.shopify_orders(cliente_id, processed_at desc, created_at desc, order_name desc)
  where wms_status <> 'annullato';

create index if not exists shopify_orders_wms_queue_idx
  on public.shopify_orders(cliente_id, wms_status, gate_status, processed_at, created_at, id)
  where wms_status in ('da_preparare', 'in_attesa_refill', 'in_preparazione');

create index if not exists wms_mass_pick_batches_queue_idx
  on public.wms_mass_pick_batches(cliente_id, picking_mode, stato, created_at desc);

create index if not exists wms_galluse_batches_queue_idx
  on public.wms_galluse_batches(cliente_id, stato, created_at desc);
