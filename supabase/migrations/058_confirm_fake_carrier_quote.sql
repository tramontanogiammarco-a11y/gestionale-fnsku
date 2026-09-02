create or replace function public.confirm_wms_shipping_choice(p_order_id uuid, p_carrier text)
returns public.shopify_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.shopify_orders;
  v_listino jsonb;
  v_actual numeric;
  v_volume numeric;
  v_divisor numeric;
  v_billable numeric;
  v_zone text;
  v_base numeric;
  v_extra numeric;
  v_price numeric;
  v_now timestamptz := now();
begin
  p_carrier := lower(trim(coalesce(p_carrier, '')));
  if p_carrier not in ('gls', 'brt') then
    raise exception 'Scegli GLS oppure BRT';
  end if;

  select * into v_order
  from public.shopify_orders
  where id = p_order_id;

  if not found then
    raise exception 'Ordine non trovato';
  end if;
  if not public.owns_cliente(v_order.cliente_id) then
    raise exception 'Ordine non accessibile';
  end if;
  if v_order.wms_status in ('in_packing', 'imballato', 'spedito', 'annullato')
    or exists (
      select 1 from public.wms_packing_sessions s
      where s.order_id = p_order_id
        and (s.started_at is not null or s.stato in ('in_corso', 'completata'))
    ) then
    raise exception 'Il packing è già iniziato: corriere e prezzo sono bloccati.';
  end if;
  if nullif(trim(coalesce(v_order.ship_zip, '')), '') is null then
    raise exception 'Inserisci il CAP di destinazione prima di calcolare la spedizione';
  end if;
  if upper(coalesce(nullif(trim(v_order.ship_country_code), ''), 'IT')) <> 'IT' then
    raise exception 'Il listino demo GLS/BRT copre per ora solo spedizioni nazionali italiane';
  end if;
  if exists (
    select 1 from public.shopify_order_items i
    left join public.referenze r on r.id = i.referenza_id
    where i.order_id = p_order_id and r.id is null
  ) then
    raise exception 'Collega tutti i prodotti dell''ordine al catalogo prima del preventivo';
  end if;

  select c.listino into v_listino from public.clienti c where c.id = v_order.cliente_id;
  select
    coalesce(sum(r.peso_kg * i.quantita), 0),
    coalesce(sum(r.lunghezza_cm * r.larghezza_cm * r.altezza_cm * i.quantita), 0)
  into v_actual, v_volume
  from public.shopify_order_items i
  join public.referenze r on r.id = i.referenza_id
  where i.order_id = p_order_id;

  if v_actual <= 0 then
    raise exception 'L''ordine non contiene prodotti con peso valido';
  end if;

  v_divisor := greatest(1, coalesce((v_listino->>'sped_peso_volumetrico_divisore')::numeric, 5000));
  v_billable := greatest(1, ceil(greatest(v_actual, v_volume / v_divisor) * 2) / 2);
  v_zone := case
    when upper(coalesce(v_order.ship_province, '')) in ('CS','CZ','KR','RC','VV','AG','CL','CT','EN','ME','PA','RG','SR','TP','CA','NU','OR','SS','SU','CI','OT','OG')
      or left(regexp_replace(coalesce(v_order.ship_zip, ''), '\D', '', 'g'), 2) in ('07','08','09','87','88','89','90','91','92','93','94','95','96','97','98')
    then 'speciale' else 'nazionale' end;

  v_base := coalesce(
    (v_listino->>(format('sped_%s_%s_base', p_carrier, v_zone)))::numeric,
    case
      when p_carrier = 'gls' and v_zone = 'nazionale' then 5.90
      when p_carrier = 'gls' then 8.90
      when v_zone = 'nazionale' then 6.20
      else 8.40
    end
  );
  v_extra := coalesce(
    (v_listino->>(format('sped_%s_kg_extra', p_carrier)))::numeric,
    case when p_carrier = 'gls' then 0.65 else 0.55 end
  );
  v_price := round(v_base + greatest(0, v_billable - 1) * v_extra, 2);

  update public.shopify_orders
  set selected_carrier = p_carrier,
      shipping_price = v_price,
      shipping_billable_weight = v_billable,
      shipping_zone = v_zone,
      shipping_quote = jsonb_build_object(
        'carrier', p_carrier,
        'net', v_price,
        'actual_weight_kg', round(v_actual, 3),
        'volumetric_weight_kg', round(v_volume / v_divisor, 3),
        'billable_weight_kg', v_billable,
        'zone', v_zone,
        'simulated', true
      ),
      shipping_confirmed_at = v_now,
      shipping_confirmed_by = auth.uid(),
      updated_at = v_now
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.confirm_wms_shipping_choice(uuid, text) from public;
grant execute on function public.confirm_wms_shipping_choice(uuid, text) to authenticated;
