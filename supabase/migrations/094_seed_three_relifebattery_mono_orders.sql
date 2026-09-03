-- Tre nuovi ordini Reliefbattery per il picking mono-prodotto.
do $$
declare
  v_client_id uuid;
  v_order_id uuid;
  v_count integer;
  candidate record;
begin
  select id into v_client_id
  from public.clienti
  where lower(trim(ragione_sociale)) in ('relifebattery', 'relife battery')
     or lower(trim(email)) in ('relifebattery@gmail.com', 'relifebatterys@gmail.com')
  order by case when lower(trim(ragione_sociale)) = 'relifebattery' then 0 else 1 end
  limit 1;

  if v_client_id is null then
    raise exception 'Cliente Reliefbattery non trovato';
  end if;

  delete from public.shopify_orders
  where cliente_id = v_client_id
    and shop_domain = 'wms-mono-relifebattery-extra-three-c.aimago.local';

  create temporary table tmp_mono_three_c on commit drop as
  with products as (
    select
      r.id as reference_id, r.titolo, r.ean, r.sku, r.fnsku,
      case
        when nullif(trim(r.fnsku), '') is not null then 'fnsku:' || lower(trim(r.fnsku))
        when nullif(trim(r.ean), '') is not null then 'ean:' || lower(trim(r.ean))
        else 'sku:' || lower(trim(r.sku))
      end as product_key
    from public.referenze r
    where r.cliente_id = v_client_id
      and coalesce(r.is_bundle, false) = false
      and coalesce(nullif(trim(r.fnsku), ''), nullif(trim(r.ean), ''), nullif(trim(r.sku), '')) is not null
  ), deltas as (
    select p.reference_id, m.location_id, sum(m.quantita)::bigint as quantity
    from products p
    join public.entrate e on e.cliente_id = v_client_id
    join public.entrate_righe er on er.entrata_id = e.id
      and ((nullif(trim(p.fnsku), '') is not null and lower(trim(er.fnsku)) = lower(trim(p.fnsku)))
        or (nullif(trim(p.fnsku), '') is null and lower(trim(er.ean)) = lower(trim(p.ean))))
    join public.wms_inbound_movements m on m.entrata_riga_id = er.id
      and m.disposizione = 'disponibile' and m.location_id is not null
    group by p.reference_id, m.location_id
    union all
    select p.reference_id, sp.location_id, sum(sp.quantita)::bigint
    from products p
    join public.wms_stock_placements sp on sp.cliente_id = v_client_id and sp.product_key = p.product_key
    group by p.reference_id, sp.location_id
    union all
    select p.reference_id, st.source_location_id, -sum(st.quantita)::bigint
    from products p
    join public.wms_stock_transfers st on st.cliente_id = v_client_id and st.product_key = p.product_key
    group by p.reference_id, st.source_location_id
    union all
    select p.reference_id, st.target_location_id, sum(st.quantita)::bigint
    from products p
    join public.wms_stock_transfers st on st.cliente_id = v_client_id and st.product_key = p.product_key
    group by p.reference_id, st.target_location_id
    union all
    select p.reference_id, ic.location_id, sum(ic.quantita_contata - ic.quantita_attesa)::bigint
    from products p
    join public.wms_inventory_counts ic on ic.cliente_id = v_client_id and ic.product_key = p.product_key
    join public.wms_inventory_sessions s on s.id = ic.session_id and s.stato = 'completata'
    group by p.reference_id, ic.location_id
    union all
    select p.reference_id, om.location_id, -sum(om.quantita)::bigint
    from products p
    join public.wms_outbound_movements om on om.cliente_id = v_client_id and om.product_key = p.product_key
    group by p.reference_id, om.location_id
  ), balances as (
    select reference_id, location_id, greatest(0, sum(quantity))::integer as quantity
    from deltas
    group by reference_id, location_id
  ), available as (
    select p.*, l.codice as location_code, b.quantity,
      row_number() over (partition by p.reference_id order by b.quantity desc, l.codice) as location_rank
    from products p
    join balances b on b.reference_id = p.reference_id and b.quantity > 0
    join public.wms_locations l on l.id = b.location_id and l.tipo = 'slot' and l.stato = 'attiva'
    where not exists (
      select 1
      from public.shopify_order_items oi
      join public.shopify_orders o on o.id = oi.order_id
      where oi.referenza_id = p.reference_id
        and o.wms_status not in ('imballato', 'spedito', 'annullato')
    )
  ), ranked as (
    select a.*, row_number() over (order by md5(a.reference_id::text || 'RLB-MONO-EXTRA-3-C')) as sequence
    from available a
    where a.location_rank = 1
  )
  select sequence::integer, reference_id, titolo, ean, sku, fnsku, location_code
  from ranked
  where sequence <= 3;

  select count(*) into v_count from tmp_mono_three_c;
  if v_count <> 3 then
    raise exception 'Servono 3 SKU Reliefbattery libere con stock negli slot; trovate %', v_count;
  end if;

  for candidate in select * from tmp_mono_three_c order by sequence loop
    insert into public.shopify_orders (
      cliente_id, shop_domain, shopify_order_id, order_name,
      financial_status, fulfillment_status, wms_status, gate_status,
      gate_checked_at, unblocked_at, processed_at, total_price, currency,
      ship_name, ship_company, ship_address1, ship_zip, ship_city,
      ship_province, ship_country, ship_country_code,
      customer_email, customer_phone, selected_carrier,
      shipping_price, shipping_billable_weight, shipping_zone,
      shipping_quote, shipping_confirmed_at, address_validation, note, raw
    ) values (
      v_client_id, 'wms-mono-relifebattery-extra-three-c.aimago.local',
      'RLB-MONO-EXTRA3C-20260903-' || lpad(candidate.sequence::text, 3, '0'),
      '#RLB-MONO-EXTRA3C-' || lpad(candidate.sequence::text, 3, '0'),
      'paid', null, 'da_preparare', 'sbloccato', now(), now(),
      now() - make_interval(secs => 5 - candidate.sequence), 0, 'EUR',
      'Cliente Mono C ' || lpad(candidate.sequence::text, 2, '0'), 'Reliefbattery Test',
      'Via Lanciani 69', '00162', 'Roma', 'RM', 'Italia', 'IT',
      'mono.extra3c.' || candidate.sequence || '@example.com',
      '3333031' || lpad(candidate.sequence::text, 3, '0'),
      'gls', 4.00, 1, 'nazionale',
      jsonb_build_object('carrier', 'gls', 'net', 4.00, 'source', 'mono_extra_test'), now(),
      jsonb_build_object('valid', true, 'source', 'mono_extra_test'),
      'Test picking mono-prodotto: SKU ' || candidate.sku || ' da ' || candidate.location_code,
      jsonb_build_object('source', 'wms_mono_relifebattery_extra', 'picking_mode', 'mono', 'expected_location', candidate.location_code)
    ) returning id into v_order_id;

    insert into public.shopify_order_items (
      order_id, shopify_line_item_id, referenza_id, sku, ean, titolo,
      quantita, fulfillable_quantity, raw
    ) values (
      v_order_id,
      'RLB-MONO-EXTRA3C-' || lpad(candidate.sequence::text, 3, '0') || '-1',
      candidate.reference_id, candidate.sku, candidate.ean, candidate.titolo, 1, 1,
      jsonb_build_object('source', 'wms_mono_relifebattery_extra', 'expected_location', candidate.location_code)
    );

    insert into public.wms_order_gate_events (
      order_id, cliente_id, from_status, to_status, reason, details
    ) values (
      v_order_id, v_client_id, 'da_verificare', 'sbloccato',
      'Ordine di test mono-prodotto verificato',
      jsonb_build_object('source', 'wms_mono_relifebattery_extra', 'stock_location', candidate.location_code)
    );
  end loop;
end;
$$;
