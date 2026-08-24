-- The Galluse cart has ten fixed physical bags. Operators never associate
-- them at the beginning of a picking mission.
create table if not exists public.wms_galluse_cart_positions (
  posizione integer primary key check (posizione between 1 and 10),
  bag_id uuid not null unique references public.wms_bags(id) on delete restrict,
  bag_code text not null unique check (bag_code ~ '^B-[0-9]{5}$'),
  updated_at timestamptz not null default now()
);

alter table public.wms_galluse_cart_positions enable row level security;

create policy "wms_galluse_cart_positions_staff_access" on public.wms_galluse_cart_positions
  for all using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.wms_galluse_cart_positions to authenticated;

insert into public.wms_galluse_cart_positions (posizione, bag_id, bag_code)
select position_number, bag.id, bag.codice
from generate_series(1, 10) as position_number
join public.wms_bags bag on bag.codice = 'B-' || lpad((73845 + position_number)::text, 5, '0')
on conflict (posizione) do update
set bag_id = excluded.bag_id,
    bag_code = excluded.bag_code,
    updated_at = now();

-- Remove the first Galluse demo safely, including any partial mission and bag locks.
with used_bags as (
  select distinct link.bag_id
  from public.wms_galluse_orders link
  join public.shopify_orders orders on orders.id = link.order_id
  where orders.shop_domain = 'wms-galluse-demo.aimago.local'
    and link.bag_id is not null
)
update public.wms_bags
set stato = 'disponibile', updated_at = now()
where id in (select bag_id from used_bags);

delete from public.wms_packing_sessions
where order_id in (
  select id from public.shopify_orders where shop_domain = 'wms-galluse-demo.aimago.local'
);

delete from public.wms_galluse_batches
where id in (
  select link.batch_id
  from public.wms_galluse_orders link
  join public.shopify_orders orders on orders.id = link.order_id
  where orders.shop_domain = 'wms-galluse-demo.aimago.local'
);

delete from public.shopify_orders
where shop_domain = 'wms-galluse-demo.aimago.local';

-- Fresh test: ten different orders and twenty-five different references spread
-- throughout the slot area, so the route has to cross the warehouse.
do $$
declare
  demo_client_id uuid;
  demo_entry_id uuid;
  demo_session_id uuid;
  demo_order_id uuid;
  demo_reference_id uuid;
  demo_entry_line_id uuid;
  target_location_id uuid;
  target_codes text[] := array[
    'S1+A1', 'S1+A4', 'S1+A7', 'S1+A10', 'S1+A14',
    'S1+A17', 'S1+A21', 'S1+A24', 'S1+A27', 'S1+A30',
    'S1+A34', 'S1+A40', 'S1+A43', 'S1+A46', 'S1+A49',
    'S1+A57', 'S1+A60', 'S1+A63', 'S1+A70', 'S1+A74',
    'S1+A78', 'S1+A82', 'S1+A86', 'S1+A90', 'S1+A94'
  ];
  product_index integer;
  order_index integer;
  line_index integer;
  line_count integer;
  running_product_index integer := 0;
begin
  select id into demo_client_id
  from public.clienti
  where ragione_sociale = 'WMS Demo Picking'
  limit 1;

  if demo_client_id is null then
    raise exception 'Cliente demo WMS non trovato';
  end if;

  insert into public.entrate (
    cliente_id, tipo, colli, ddt, corriere, tracking, stato, data_annuncio, data_ricezione, note
  ) values (
    demo_client_id, 'pallet', 25, 'WMS-GALLUSE-ROUTE-025', 'Demo', 'WMS-GALLUSE-ROUTE-025',
    'ricevuto', now(), now(), 'Fixture Metodo Galluse: 25 referenze distribuite negli slot'
  ) returning id into demo_entry_id;

  insert into public.wms_inbound_sessions (entrata_id, stato, started_at, completed_at, note)
  values (demo_entry_id, 'completata', now(), now(), 'Ubicazione fixture Metodo Galluse')
  returning id into demo_session_id;

  for product_index in 1..25 loop
    select id into target_location_id
    from public.wms_locations
    where codice = target_codes[product_index]
      and tipo = 'slot'
      and stato = 'attiva';

    if target_location_id is null then
      raise exception 'Slot demo % non disponibile', target_codes[product_index];
    end if;

    if exists (
      select 1
      from public.wms_inbound_movements movement
      join public.entrate_righe entry_line on entry_line.id = movement.entrata_riga_id
      join public.entrate entry on entry.id = entry_line.entrata_id
      where movement.location_id = target_location_id
        and movement.disposizione = 'disponibile'
        and entry.cliente_id <> demo_client_id
    ) then
      raise exception 'Lo slot % contiene stock non demo', target_codes[product_index];
    end if;

    delete from public.wms_inbound_movements movement
    using public.entrate_righe entry_line, public.entrate entry
    where movement.location_id = target_location_id
      and movement.disposizione = 'disponibile'
      and movement.entrata_riga_id = entry_line.id
      and entry_line.entrata_id = entry.id
      and entry.cliente_id = demo_client_id;

    select id into demo_reference_id
    from public.referenze
    where cliente_id = demo_client_id
      and fnsku = 'GALLUSE-ROUTE-' || lpad(product_index::text, 3, '0')
    limit 1;

    if demo_reference_id is null then
      insert into public.referenze (cliente_id, titolo, ean, sku, fnsku, origine)
      values (
        demo_client_id,
        'Galluse route product ' || lpad(product_index::text, 2, '0'),
        'GALLUSE-EAN-' || lpad(product_index::text, 3, '0'),
        'GALLUSE-SKU-' || lpad(product_index::text, 3, '0'),
        'GALLUSE-ROUTE-' || lpad(product_index::text, 3, '0'),
        'wms-galluse-demo'
      ) returning id into demo_reference_id;
    end if;

    insert into public.entrate_righe (entrata_id, ean, quantita, quantita_ricevuta, fnsku)
    values (
      demo_entry_id,
      'GALLUSE-EAN-' || lpad(product_index::text, 3, '0'),
      100, 100,
      'GALLUSE-ROUTE-' || lpad(product_index::text, 3, '0')
    ) returning id into demo_entry_line_id;

    insert into public.wms_inbound_movements (
      session_id, entrata_riga_id, location_id, disposizione, quantita, codice_scansionato
    ) values (
      demo_session_id, demo_entry_line_id, target_location_id, 'disponibile', 100, target_codes[product_index]
    );
  end loop;

  for order_index in 1..10 loop
    insert into public.shopify_orders (
      cliente_id, shop_domain, shopify_order_id, order_name, financial_status,
      fulfillment_status, wms_status, processed_at, raw
    ) values (
      demo_client_id,
      'wms-galluse-demo.aimago.local',
      'WMS-GALLUSE-NEW-' || lpad(order_index::text, 3, '0'),
      '#WMS-GALLUSE-' || lpad(order_index::text, 3, '0'),
      'paid', null, 'da_preparare', now() - make_interval(mins => 10 - order_index),
      jsonb_build_object('source', 'wms_galluse_demo', 'cart_position', order_index)
    ) returning id into demo_order_id;

    line_count := case when order_index <= 5 then 3 else 2 end;
    for line_index in 1..line_count loop
      running_product_index := running_product_index + 1;
      select id into demo_reference_id
      from public.referenze
      where cliente_id = demo_client_id
        and fnsku = 'GALLUSE-ROUTE-' || lpad(running_product_index::text, 3, '0');

      insert into public.shopify_order_items (
        order_id, shopify_line_item_id, referenza_id, sku, ean, titolo,
        quantita, fulfillable_quantity, raw
      ) values (
        demo_order_id,
        'WMS-GALLUSE-NEW-' || lpad(order_index::text, 3, '0') || '-L' || line_index,
        demo_reference_id,
        'GALLUSE-SKU-' || lpad(running_product_index::text, 3, '0'),
        'GALLUSE-EAN-' || lpad(running_product_index::text, 3, '0'),
        'Galluse route product ' || lpad(running_product_index::text, 2, '0'),
        1 + ((order_index + line_index) % 3),
        1 + ((order_index + line_index) % 3),
        jsonb_build_object('source', 'wms_galluse_demo')
      );
    end loop;
  end loop;
end $$;
