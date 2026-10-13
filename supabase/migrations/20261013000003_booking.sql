create function public.app_enqueue(p_type text, p_payload jsonb, p_key text, p_run_at timestamptz default now())
returns void language sql security definer set search_path = public as
$$ insert into jobs (type, payload, idempotency_key, run_at) values (p_type, p_payload, p_key, p_run_at)
   on conflict (idempotency_key) do nothing $$;

create function public.app_enqueue_reminders(p_booking uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b bookings;
begin
  select * into b from bookings where id = p_booking;
  if b.starts_at - interval '24 hours' > now() then
    perform app_enqueue('reminder', jsonb_build_object('booking_id', b.id, 'kind', '24h'),
                        'reminder:24h:' || b.id, b.starts_at - interval '24 hours');
  end if;
  if b.starts_at - interval '1 hour' > now() then
    perform app_enqueue('reminder', jsonb_build_object('booking_id', b.id, 'kind', '1h'),
                        'reminder:1h:' || b.id, b.starts_at - interval '1 hour');
  end if;
end $$;

create function public.app_cancel_reminders(p_booking uuid) returns void
language sql security definer set search_path = public as
$$ update jobs set status = 'done', last_error = 'cancelled'
   where idempotency_key in ('reminder:24h:' || p_booking, 'reminder:1h:' || p_booking) and status = 'pending' $$;

-- Validates a start against lead/horizon, the doctor's grid and time off.
create function public.app_check_slot(p_doctor uuid, p_starts_at timestamptz, p_min_lead_hours int)
returns table (o_ends_at timestamptz, o_blocked_until timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  d doctors;
  v_local timestamp := p_starts_at at time zone 'Asia/Tehran';
  v_min int := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
begin
  select * into d from doctors where id = p_doctor and is_active;
  if not found then raise exception 'doctor_unavailable'; end if;
  if p_starts_at < now() + make_interval(hours => p_min_lead_hours) then raise exception 'too_soon'; end if;
  if p_starts_at > now() + make_interval(days => app_setting_int('max_horizon_days')) then raise exception 'too_far'; end if;
  if extract(second from v_local) <> 0 then raise exception 'not_on_schedule'; end if;
  if not exists (
    select 1 from availability_rules r
    where r.doctor_id = p_doctor
      and r.weekday = extract(dow from v_local)::int
      and v_min >= extract(epoch from r.start_time)::int / 60
      and v_min + d.session_minutes <= extract(epoch from r.end_time)::int / 60
      and (v_min - extract(epoch from r.start_time)::int / 60) % (d.session_minutes + d.buffer_minutes) = 0
  ) then
    raise exception 'not_on_schedule';
  end if;
  o_ends_at := p_starts_at + make_interval(mins => d.session_minutes);
  o_blocked_until := o_ends_at + make_interval(mins => d.buffer_minutes);
  if exists (
    select 1 from time_off t
    where t.doctor_id = p_doctor
      and tstzrange(t.starts_at, t.ends_at, '[)') && tstzrange(p_starts_at, o_blocked_until, '[)')
  ) then
    raise exception 'not_on_schedule';
  end if;
  return next;
end $$;

create function public.hold_slot(p_doctor uuid, p_starts_at timestamptz, p_client_timezone text,
                                 p_nonrefundable_ack boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_client uuid := auth.uid();
  v_slot record;
  d doctors;
  v_id uuid;
begin
  if v_client is null then raise exception 'not_authenticated'; end if;
  if coalesce((select role from user_roles where user_id = v_client), 'client') <> 'client' then
    raise exception 'clients_only';
  end if;
  if not exists (select 1 from profiles where id = v_client and adult_confirmed_at is not null) then
    raise exception 'adult_confirmation_required';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_doctor::text));
  select * into v_slot from app_check_slot(p_doctor, p_starts_at, app_setting_int('min_lead_hours'));
  if p_starts_at < now() + make_interval(hours => app_setting_int('refund_window_hours'))
     and not coalesce(p_nonrefundable_ack, false) then
    raise exception 'nonrefundable_ack_required';
  end if;

  update bookings set booking_status = 'expired'
  where booking_status = 'held' and hold_expires_at < now() and (doctor_id = p_doctor or client_id = v_client);
  if exists (select 1 from bookings where client_id = v_client and booking_status = 'held') then
    raise exception 'hold_exists';
  end if;

  select * into d from doctors where id = p_doctor;
  begin
    insert into bookings (client_id, doctor_id, starts_at, ends_at, blocked_until, hold_expires_at,
                          policy_version_id, price_cents, doctor_share_cents, share_rule, client_timezone,
                          nonrefundable_ack_at, risk_flagged)
    values (v_client, p_doctor, p_starts_at, v_slot.o_ends_at, v_slot.o_blocked_until,
            now() + make_interval(mins => app_setting_int('hold_minutes')),
            (select id from policy_versions order by effective_from desc limit 1),
            d.price_cents, app_share_cents(d.price_cents, d.share_bps, d.share_fixed_cents),
            jsonb_build_object('share_bps', d.share_bps, 'share_fixed_cents', d.share_fixed_cents),
            p_client_timezone,
            case when p_nonrefundable_ack then now() end,
            coalesce((select risk_flag from intake_responses where client_id = v_client
                      order by created_at desc limit 1), false))
    returning id into v_id;
  exception
    when exclusion_violation then raise exception 'slot_taken';
    when unique_violation then raise exception 'hold_exists';
  end;
  return v_id;
end $$;

create function public.confirm_payment(p_event_id text, p_booking uuid, p_amount_cents int, p_currency text,
                                       p_checkout_session_id text, p_payment_intent_id text)
returns text language plpgsql security definer set search_path = public as $$
declare
  b bookings;
  v_payment uuid;
  v_result text;
begin
  insert into stripe_events (event_id, type) values (p_event_id, 'checkout.session.completed')
  on conflict do nothing;
  if not found then return 'duplicate'; end if;

  select * into b from bookings where id = p_booking for update;
  if not found then
    perform app_enqueue('admin_alert', jsonb_build_object('kind', 'payment_unknown_booking', 'payment_intent', p_payment_intent_id),
                        'alert:unknown_booking:' || p_payment_intent_id);
    update stripe_events set processed_at = now() where event_id = p_event_id;
    return 'unknown_booking';
  end if;
  perform pg_advisory_xact_lock(hashtext(b.doctor_id::text));

  if exists (select 1 from payments where booking_id = b.id and not is_duplicate) then
    insert into payments (booking_id, is_duplicate, stripe_checkout_session_id, stripe_payment_intent_id, amount_cents, currency, status)
    values (b.id, true, p_checkout_session_id, p_payment_intent_id, p_amount_cents, lower(p_currency), 'refund_pending')
    returning id into v_payment;
    perform app_enqueue('refund', jsonb_build_object('payment_id', v_payment, 'amount_cents', p_amount_cents, 'reason', 'duplicate_charge'),
                        'refund:' || v_payment);
    perform app_enqueue('admin_alert', jsonb_build_object('kind', 'duplicate_charge', 'booking_id', b.id, 'payment_intent', p_payment_intent_id),
                        'alert:duplicate_charge:' || p_payment_intent_id);
    update stripe_events set processed_at = now() where event_id = p_event_id;
    return 'duplicate_charge';
  end if;

  if p_amount_cents <> b.price_cents or lower(p_currency) <> 'usd' then
    v_result := 'mismatch';
  elsif b.booking_status in ('held', 'expired') then
    begin
      update bookings set booking_status = 'confirmed', hold_expires_at = null where id = b.id;
      v_result := 'confirmed';
    exception when exclusion_violation then
      v_result := 'slot_lost';
    end;
  else
    v_result := 'slot_lost';
  end if;

  insert into payments (booking_id, stripe_checkout_session_id, stripe_payment_intent_id, amount_cents, currency, status)
  values (b.id, p_checkout_session_id, p_payment_intent_id, p_amount_cents, lower(p_currency),
          (case when v_result = 'confirmed' then 'paid' else 'refund_pending' end)::payment_status)
  returning id into v_payment;

  if v_result = 'confirmed' then
    perform app_enqueue('email', jsonb_build_object('template', 'booking_confirmed', 'booking_id', b.id),
                        'email:booking_confirmed:' || b.id);
    perform app_enqueue_reminders(b.id);
  else
    perform app_enqueue('refund', jsonb_build_object('payment_id', v_payment, 'amount_cents', p_amount_cents, 'reason', v_result),
                        'refund:' || v_payment);
    perform app_enqueue('admin_alert', jsonb_build_object('kind', v_result, 'booking_id', b.id),
                        'alert:' || v_result || ':' || v_payment);
  end if;
  update stripe_events set processed_at = now() where event_id = p_event_id;
  return v_result;
end $$;

revoke execute on function public.app_enqueue(text, jsonb, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.app_enqueue_reminders(uuid) from public, anon, authenticated;
revoke execute on function public.app_cancel_reminders(uuid) from public, anon, authenticated;
revoke execute on function public.app_check_slot(uuid, timestamptz, int) from public, anon, authenticated;
revoke execute on function public.hold_slot(uuid, timestamptz, text, boolean) from public, anon;
grant execute on function public.hold_slot(uuid, timestamptz, text, boolean) to authenticated;
revoke execute on function public.confirm_payment(text, uuid, int, text, text, text) from public, anon, authenticated;
grant execute on function public.confirm_payment(text, uuid, int, text, text, text) to service_role;
