-- Fill every free demo slot with stock so picking routes can be tested across the warehouse.
do $$
declare
  demo_client_id uuid;
  demo_entry_id uuid;
  demo_session_id uuid;
  reference_ids uuid[];
  slot_row record;
  reference_row record;
  entry_line_id uuid;
  slot_index integer := 0;
begin
  select id into demo_client_id
  from public.clienti
  where ragione_sociale = 'WMS Demo Picking'
  limit 1;

  if demo_client_id is null then
    raise exception 'Cliente demo WMS non trovato';
  end if;

  select array_agg(id order by fnsku) into reference_ids
  from public.referenze
  where cliente_id = demo_client_id
    and origine = 'wms-mass-demo';

  if coalesce(array_length(reference_ids, 1), 0) = 0 then
    raise exception 'Referenze demo WMS non trovate';
  end if;

  insert into public.entrate (
    cliente_id, tipo, colli, ddt, corriere, tracking, stato, data_annuncio, data_ricezione, note
  ) values (
    demo_client_id, 'pallet', 1, 'WMS-SLOT-DEMO-100', 'Demo', 'WMS-SLOT-DEMO-100',
    'ricevuto', now(), now(), 'Riempimento demo: 100 pezzi per ogni slot libero'
  ) returning id into demo_entry_id;

  insert into public.wms_inbound_sessions (entrata_id, stato, started_at, completed_at, note)
  values (demo_entry_id, 'completata', now(), now(), 'Riempimento automatico degli slot demo')
  returning id into demo_session_id;

  for slot_row in
    select location.*
    from public.wms_locations location
    where location.tipo = 'slot'
      and location.stato = 'attiva'
      and not exists (
        select 1
        from public.wms_inbound_movements movement
        where movement.location_id = location.id
          and movement.disposizione = 'disponibile'
      )
    order by location.codice collate "C"
  loop
    slot_index := slot_index + 1;
    select * into reference_row
    from public.referenze
    where id = reference_ids[((slot_index - 1) % array_length(reference_ids, 1)) + 1];

    insert into public.entrate_righe (entrata_id, ean, quantita, quantita_ricevuta, fnsku)
    values (demo_entry_id, reference_row.ean, 100, 100, reference_row.fnsku)
    returning id into entry_line_id;

    insert into public.wms_inbound_movements (
      session_id, entrata_riga_id, location_id, disposizione, quantita, codice_scansionato
    ) values (
      demo_session_id, entry_line_id, slot_row.id, 'disponibile', 100, slot_row.codice
    );
  end loop;
end $$;
