-- Carico di prova richiesto per verificare il refill dell'ordine manuale 55.
-- Registra una ricezione completa su un pallet attivo, mantenendo la tracciabilita stock.
do $$
declare
  v_reference_id uuid;
  v_ean text;
  v_sku text;
  v_fnsku text;
  v_client_id uuid;
  v_pallet_id uuid;
  v_pallet_code text;
  v_entry_id uuid;
  v_entry_row_id uuid;
  v_session_id uuid;
begin
  if exists (
    select 1 from public.entrate
    where ddt = 'TEST-REFILL-ORDER-55-20260902'
  ) then
    return;
  end if;

  select reference.id, reference.ean, reference.sku, reference.fnsku, order_row.cliente_id
  into v_reference_id, v_ean, v_sku, v_fnsku, v_client_id
  from public.shopify_orders order_row
  join public.shopify_order_items item on item.order_id = order_row.id
  join public.referenze reference on reference.id = item.referenza_id
  where order_row.shop_domain = 'manual-entry'
    and order_row.order_name = '55'
  order by order_row.created_at desc, item.created_at
  limit 1;

  if v_reference_id is null or v_client_id is null then
    raise exception 'Referenza dell ordine manuale 55 non trovata';
  end if;

  select location.id, location.codice
  into v_pallet_id, v_pallet_code
  from public.wms_locations location
  where location.tipo = 'pallet'
    and location.stato = 'attiva'
  order by random()
  limit 1;

  if v_pallet_id is null then
    raise exception 'Nessun pallet attivo disponibile';
  end if;

  insert into public.entrate (
    cliente_id, tipo, colli, ddt, corriere, tracking, stato,
    data_annuncio, data_ricezione, note
  ) values (
    v_client_id, 'pallet', 1, 'TEST-REFILL-ORDER-55-20260902',
    'Carico test WMS', 'TEST-REFILL-55', 'ricevuto',
    now(), now(), '100 pezzi di prova per verifica refill ordine 55 su ' || v_pallet_code
  ) returning id into v_entry_id;

  insert into public.entrate_righe (
    entrata_id, ean, quantita, quantita_ricevuta, fnsku
  ) values (
    v_entry_id,
    coalesce(nullif(trim(v_ean), ''), nullif(trim(v_sku), ''), nullif(trim(v_fnsku), '')),
    100,
    100,
    nullif(trim(v_fnsku), '')
  ) returning id into v_entry_row_id;

  insert into public.wms_inbound_sessions (
    entrata_id, stato, note, started_at, completed_at
  ) values (
    v_entry_id, 'completata', 'Ricezione test refill ordine 55', now(), now()
  ) returning id into v_session_id;

  insert into public.wms_inbound_movements (
    session_id, entrata_riga_id, location_id, disposizione,
    quantita, codice_scansionato
  ) values (
    v_session_id, v_entry_row_id, v_pallet_id, 'disponibile',
    100, v_pallet_code
  );
end;
$$;
