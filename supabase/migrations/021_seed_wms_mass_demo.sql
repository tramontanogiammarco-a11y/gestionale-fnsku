do $$
declare
  demo_client_id uuid;
  demo_entry_id uuid;
  demo_session_id uuid;
  row_id uuid;
  demo_order_id uuid;
  reference_ids uuid[];
  selected_ids uuid[];
  order_index integer;
  line_index integer;
  reference_row record;
  location_row record;
begin
  select id into demo_client_id from public.clienti
  where ragione_sociale = 'WMS Demo Picking' limit 1;

  if demo_client_id is null then
    insert into public.clienti (ragione_sociale, email, note)
    values ('WMS Demo Picking', 'wms-demo-picking@aimago.local', 'Dati isolati per test picking e packing')
    returning id into demo_client_id;
  end if;

  for order_index in 1..10 loop
    if not exists (
      select 1 from public.referenze
      where cliente_id = demo_client_id and fnsku = 'MASS-FNSKU-' || lpad(order_index::text, 3, '0')
    ) then
      insert into public.referenze (cliente_id, titolo, ean, sku, fnsku, origine)
      values (
        demo_client_id,
        'Massivo demo ' || lpad(order_index::text, 2, '0'),
        'MASS-EAN-' || lpad(order_index::text, 3, '0'),
        'MASS-SKU-' || lpad(order_index::text, 3, '0'),
        'MASS-FNSKU-' || lpad(order_index::text, 3, '0'),
        'wms-mass-demo'
      );
    end if;
  end loop;

  select array_agg(id order by fnsku) into reference_ids
  from public.referenze
  where cliente_id = demo_client_id and origine = 'wms-mass-demo';

  insert into public.entrate (
    cliente_id, tipo, colli, ddt, corriere, tracking, stato, data_annuncio, data_ricezione, note
  ) values (
    demo_client_id, 'pallet', 1, 'WMS-MASS-DEMO-100', 'Demo', 'WMS-MASS-DEMO-100',
    'ricevuto', now(), now(), 'Massivo demo: 100 pezzi per referenza'
  ) returning id into demo_entry_id;

  insert into public.wms_inbound_sessions (entrata_id, stato, started_at, completed_at, note)
  values (demo_entry_id, 'completata', now(), now(), 'Ubicazione automatica Massivo demo')
  returning id into demo_session_id;

  for line_index in 1..array_length(reference_ids, 1) loop
    select * into reference_row from public.referenze where id = reference_ids[line_index];
    insert into public.entrate_righe (entrata_id, ean, quantita, quantita_ricevuta, fnsku)
    values (demo_entry_id, reference_row.ean, 100, 100, reference_row.fnsku)
    returning id into row_id;

    select location.* into location_row
    from public.wms_locations location
    where location.tipo = 'slot' and location.stato = 'attiva'
      and not exists (
        select 1 from public.wms_inbound_movements movement
        where movement.location_id = location.id and movement.disposizione = 'disponibile'
      )
    order by location.codice collate "C" limit 1;

    if location_row.id is null then
      raise exception 'Servono almeno 10 slot liberi per creare lo stock demo';
    end if;

    insert into public.wms_inbound_movements (
      session_id, entrata_riga_id, location_id, disposizione, quantita, codice_scansionato
    ) values (demo_session_id, row_id, location_row.id, 'disponibile', 100, location_row.codice);
  end loop;

  for order_index in 1..30 loop
    if order_index <= 6 then
      selected_ids := array[reference_ids[1], reference_ids[2], reference_ids[3]];
    else
      select array[a.id, b.id, c.id] into selected_ids
      from unnest(reference_ids) with ordinality a(id, ai)
      join unnest(reference_ids) with ordinality b(id, bi) on b.bi > a.ai
      join unnest(reference_ids) with ordinality c(id, ci) on c.ci > b.bi
      where not (a.ai = 1 and b.bi = 2 and c.ci = 3)
      order by a.ai, b.bi, c.ci offset (order_index - 7) limit 1;
    end if;

    insert into public.shopify_orders (
      cliente_id, shop_domain, shopify_order_id, order_name, financial_status,
      fulfillment_status, wms_status, processed_at, raw
    ) values (
      demo_client_id, 'wms-mass-demo.aimago.local',
      'WMS-MASS-' || lpad(order_index::text, 3, '0'), '#MASS-' || lpad(order_index::text, 3, '0'),
      'paid', null, 'da_preparare', now() - make_interval(mins => 31 - order_index),
      jsonb_build_object('source', 'wms_mass_demo')
    ) returning id into demo_order_id;

    for line_index in 1..3 loop
      select * into reference_row from public.referenze where id = selected_ids[line_index];
      insert into public.shopify_order_items (
        order_id, shopify_line_item_id, referenza_id, sku, ean, titolo,
        quantita, fulfillable_quantity, raw
      ) values (
        demo_order_id,
        'WMS-MASS-' || lpad(order_index::text, 3, '0') || '-' || line_index,
        reference_row.id, reference_row.sku, reference_row.ean, reference_row.titolo,
        1, 1, jsonb_build_object('source', 'wms_mass_demo', 'fnsku', reference_row.fnsku)
      );
    end loop;
  end loop;
end $$;
