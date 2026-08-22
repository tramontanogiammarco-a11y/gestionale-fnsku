alter table public.wms_mass_pick_batches
  drop constraint if exists wms_mass_pick_batches_stato_check;

alter table public.wms_mass_pick_batches
  add constraint wms_mass_pick_batches_stato_check
  check (stato in ('in_corso', 'da_confermare_bag', 'completata', 'in_packing', 'completata_packing', 'annullata'));

alter table public.wms_mass_pick_batches
  add column if not exists bag_confirmed_at timestamptz;

do $$
declare
  demo_client_id uuid;
begin
  select id into demo_client_id
  from public.clienti
  where ragione_sociale = 'WMS Demo Picking'
  limit 1;

  if demo_client_id is null then
    return;
  end if;

  -- Remove only the temporary Massivo mission created for the isolated demo data.
  delete from public.wms_mass_pick_batches
  where cliente_id = demo_client_id;

  update public.shopify_orders
  set
    wms_status = 'da_preparare',
    order_name = case
      when shopify_order_id ~ '^WMS-MASS-00[1-6]$'
        then '#' || shopify_order_id
      when shopify_order_id ~ '^WMS-MASS-[0-9]{3}$'
        then '#1X1-' || lpad((substring(shopify_order_id from '([0-9]{3})$')::integer - 6)::text, 3, '0')
      else order_name
    end,
    updated_at = now()
  where cliente_id = demo_client_id
    and raw->>'source' = 'wms_mass_demo';
end $$;
