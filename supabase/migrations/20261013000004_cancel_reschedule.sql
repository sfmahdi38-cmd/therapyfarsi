create function public.app_payment_disputed(p_booking uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from payments p join bookings b on p.booking_id = coalesce(b.root_booking_id, b.id)
                 where b.id = p_booking and not p.is_duplicate and p.status = 'disputed')
$$;

create function public.app_request_refund(p_booking uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  p payments;
  v_root uuid;
begin
  select coalesce(root_booking_id, id) into v_root from bookings where id = p_booking;
  select * into p from payments where booking_id = v_root and not is_duplicate for update;
  if not found or p.amount_cents - p.refunded_cents <= 0 then return; end if;
  if p.status = 'disputed' then
    perform app_enqueue('admin_alert', jsonb_build_object('kind', 'refund_blocked_dispute', 'booking_id', p_booking),
                        'alert:refund_blocked_dispute:' || p_booking);
    return;
  end if;
  update payments set status = 'refund_pending' where id = p.id;
  perform app_enqueue('refund',
    jsonb_build_object('payment_id', p.id, 'amount_cents', p.amount_cents - p.refunded_cents, 'reason', 'booking:' || p_booking),
    'refund:' || p.id || ':full');
end $$;

-- True while the client may pick refund or free reschedule (doctor/admin cancel, partial, doctor no-show).
create function public.app_in_choice_state(b public.bookings) returns boolean
language sql stable as $$
  select b.refund_choice is null and b.choice_deadline is not null and b.choice_deadline > now()
     and ((b.booking_status = 'cancelled' and b.cancelled_by is distinct from b.client_id)
          or b.session_status in ('partial', 'no_show_doctor'))
$$;

create function public.cancel_booking(p_booking uuid, p_reason text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  b bookings;
  v_uid uuid := auth.uid();
  v_actor text;
  v_refund text;
  v_deadline timestamptz;
begin
  select * into b from bookings where id = p_booking for update;
  if not found then raise exception 'not_found'; end if;
  if b.client_id = v_uid then v_actor := 'client';
  elsif b.doctor_id = v_uid then v_actor := 'doctor';
  elsif app_is_admin() then v_actor := 'admin';
  else raise exception 'forbidden';
  end if;

  if b.booking_status = 'held' and v_actor = 'client' then
    update bookings set booking_status = 'cancelled', session_status = 'void', cancelled_by = v_uid,
                        cancelled_at = now(), cancel_reason = p_reason
    where id = b.id;
    return 'released';
  end if;
  if b.booking_status <> 'confirmed' or b.session_status <> 'scheduled' then raise exception 'not_cancellable'; end if;
  if now() >= b.starts_at then raise exception 'already_started'; end if;

  if v_actor = 'client' then
    v_refund := case when b.starts_at - now() >= make_interval(hours => app_setting_int('refund_window_hours'))
                     then 'full' else 'none' end;
  else
    v_refund := 'client_choice';
    v_deadline := now() + make_interval(days => app_setting_int('choice_window_days'));
  end if;

  update bookings set booking_status = 'cancelled', session_status = 'void', cancelled_by = v_uid,
                      cancelled_at = now(), cancel_reason = p_reason, choice_deadline = v_deadline
  where id = b.id;
  perform app_cancel_reminders(b.id);

  if v_refund = 'full' then
    perform app_request_refund(b.id);
  elsif v_refund = 'none' then
    if b.doctor_share_cents > 0 and not app_payment_disputed(b.id) then
      insert into doctor_ledger_entries (doctor_id, booking_id, type, amount_cents, source_key, created_by)
      values (b.doctor_id, b.id, 'late_cancel_earning', b.doctor_share_cents, 'booking:' || b.id || ':late_cancel', v_uid)
      on conflict (source_key) do nothing;
    end if;
  else
    perform app_enqueue('email', jsonb_build_object('template', 'client_choice_needed', 'booking_id', b.id),
                        'email:client_choice:' || b.id);
    perform app_enqueue('choice_deadline', jsonb_build_object('booking_id', b.id), 'choice_deadline:' || b.id, v_deadline);
  end if;
  return v_refund;
end $$;

create function public.choose_refund(p_booking uuid) returns void
language plpgsql security definer set search_path = public as $$
declare b bookings;
begin
  select * into b from bookings where id = p_booking for update;
  if not found or b.client_id is distinct from auth.uid() then raise exception 'forbidden'; end if;
  if not app_in_choice_state(b) then raise exception 'no_choice_pending'; end if;
  update bookings set refund_choice = 'refund' where id = b.id;
  perform app_request_refund(b.id);
end $$;

create function public.resolve_choice_deadline(p_booking uuid) returns text
language plpgsql security definer set search_path = public as $$
declare b bookings;
begin
  select * into b from bookings where id = p_booking for update;
  if not found or b.refund_choice is not null or b.choice_deadline is null or b.choice_deadline > now()
     or not ((b.booking_status = 'cancelled' and b.cancelled_by is distinct from b.client_id)
             or b.session_status in ('partial', 'no_show_doctor')) then
    return 'not_due';
  end if;
  update bookings set refund_choice = 'refund' where id = b.id;
  perform app_request_refund(b.id);
  return 'refunded';
end $$;

create function public.reschedule_booking(p_booking uuid, p_new_starts_at timestamptz,
                                          p_nonrefundable_ack boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  b bookings;
  v_uid uuid := auth.uid();
  v_free boolean;
  v_slot record;
  v_new uuid;
begin
  select * into b from bookings where id = p_booking for update;
  if not found then raise exception 'not_found'; end if;
  if b.client_id is distinct from v_uid and not app_is_admin() then raise exception 'forbidden'; end if;

  v_free := app_in_choice_state(b);
  if not v_free and not (b.booking_status = 'confirmed' and b.session_status = 'scheduled'
                         and b.starts_at - now() >= make_interval(hours => app_setting_int('refund_window_hours'))) then
    raise exception 'not_reschedulable';
  end if;

  perform pg_advisory_xact_lock(hashtext(b.doctor_id::text));
  update bookings set booking_status = 'expired'
  where doctor_id = b.doctor_id and booking_status = 'held' and hold_expires_at < now();

  select * into v_slot from app_check_slot(b.doctor_id, p_new_starts_at,
    case when v_free then app_setting_int('free_reschedule_min_lead_hours') else app_setting_int('min_lead_hours') end);
  if p_new_starts_at < now() + make_interval(hours => app_setting_int('refund_window_hours'))
     and not coalesce(p_nonrefundable_ack, false) then
    raise exception 'nonrefundable_ack_required';
  end if;

  if v_free then
    update bookings set refund_choice = 'reschedule' where id = b.id;
  else
    update bookings set booking_status = 'cancelled', session_status = 'void', cancelled_by = v_uid,
                        cancelled_at = now(), cancel_reason = 'rescheduled'
    where id = b.id;
    perform app_cancel_reminders(b.id);
  end if;

  begin
    insert into bookings (client_id, doctor_id, starts_at, ends_at, blocked_until, booking_status, policy_version_id,
                          price_cents, doctor_share_cents, share_rule, client_timezone, risk_flagged,
                          root_booking_id, previous_booking_id, nonrefundable_ack_at)
    values (b.client_id, b.doctor_id, p_new_starts_at, v_slot.o_ends_at, v_slot.o_blocked_until, 'confirmed',
            b.policy_version_id, b.price_cents, b.doctor_share_cents, b.share_rule, b.client_timezone, b.risk_flagged,
            coalesce(b.root_booking_id, b.id), b.id, case when p_nonrefundable_ack then now() end)
    returning id into v_new;
  exception when exclusion_violation then
    raise exception 'slot_taken';
  end;

  perform app_enqueue_reminders(v_new);
  perform app_enqueue('email', jsonb_build_object('template', 'booking_rescheduled', 'booking_id', v_new),
                      'email:rescheduled:' || v_new);
  return v_new;
end $$;

revoke execute on function public.app_request_refund(uuid) from public, anon, authenticated;
revoke execute on function public.app_payment_disputed(uuid) from public, anon, authenticated;
revoke execute on function public.cancel_booking(uuid, text) from public, anon;
grant execute on function public.cancel_booking(uuid, text) to authenticated;
revoke execute on function public.choose_refund(uuid) from public, anon;
grant execute on function public.choose_refund(uuid) to authenticated;
revoke execute on function public.reschedule_booking(uuid, timestamptz, boolean) from public, anon;
grant execute on function public.reschedule_booking(uuid, timestamptz, boolean) to authenticated;
revoke execute on function public.resolve_choice_deadline(uuid) from public, anon, authenticated;
grant execute on function public.resolve_choice_deadline(uuid) to service_role;
