-- Resolve a completed packing audit from either its internal packing code or
-- the tracking/reference printed on a real carrier label.
create index if not exists wms_shipments_tracking_idx
  on public.wms_shipments(tracking)
  where tracking is not null;

create index if not exists wms_shipments_carrier_reference_idx
  on public.wms_shipments(carrier_reference)
  where carrier_reference is not null;

create or replace function public.lookup_wms_packing_label_audit(p_label_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scan text := regexp_replace(upper(trim(coalesce(p_label_code, ''))), '[^A-Z0-9]', '', 'g');
  v_result jsonb;
begin
  if not public.is_staff() then
    raise exception 'Accesso riservato allo staff';
  end if;

  if v_scan = '' then
    raise exception 'Scansiona un codice etichetta valido';
  end if;

  delete from public.wms_packing_label_audits where expires_at <= now();

  select to_jsonb(audit) || jsonb_build_object(
    'scanned_code', trim(p_label_code),
    'packing_label_code', audit.label_code,
    'label_source', 'packing'
  )
  into v_result
  from public.wms_packing_label_audits audit
  where regexp_replace(upper(trim(audit.label_code)), '[^A-Z0-9]', '', 'g') = v_scan
    and audit.expires_at > now()
  order by audit.completed_at desc
  limit 1;

  if v_result is null then
    select to_jsonb(audit) || jsonb_build_object(
      'label_code', trim(p_label_code),
      'scanned_code', trim(p_label_code),
      'packing_label_code', audit.label_code,
      'label_source', case
        when regexp_replace(upper(trim(coalesce(shipment.tracking, ''))), '[^A-Z0-9]', '', 'g') = v_scan
          then 'tracking'
        else 'carrier_reference'
      end,
      'carrier', shipment.corriere,
      'carrier_tracking', shipment.tracking,
      'carrier_reference', shipment.carrier_reference
    )
    into v_result
    from public.wms_shipments shipment
    join public.wms_packing_label_audits audit on audit.order_id = shipment.order_id
    where audit.expires_at > now()
      and shipment.stato = 'creata'
      and (
        regexp_replace(upper(trim(coalesce(shipment.tracking, ''))), '[^A-Z0-9]', '', 'g') = v_scan
        or regexp_replace(upper(trim(coalesce(shipment.carrier_reference, ''))), '[^A-Z0-9]', '', 'g') = v_scan
      )
    order by shipment.updated_at desc, audit.completed_at desc
    limit 1;
  end if;

  if v_result is null then
    raise exception 'Etichetta non trovata oppure controllo scaduto dopo 48 ore';
  end if;

  return v_result;
end;
$$;

revoke all on function public.lookup_wms_packing_label_audit(text) from public;
grant execute on function public.lookup_wms_packing_label_audit(text) to authenticated;
