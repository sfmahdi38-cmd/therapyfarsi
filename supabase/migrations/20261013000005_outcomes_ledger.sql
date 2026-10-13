-- Brings the booking's outcome rows (source_key booking:{id}:outcome:n) in line with its session status.
create function public.app_sync_outcome_earning(p_booking uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  b bookings;
  v_target int;
  v_current int;
  v_n int;
  v_delta int;
begin
  select * into b from bookings where id = p_booking;
  if b.session_status = 'needs_review' then return; end if;
  v_target := case when b.session_status in ('completed', 'no_show_client') then b.doctor_share_cents else 0 end;
  select coalesce(sum(amount_cents), 0), count(*) into v_current, v_n
  from doctor_ledger_entries where source_key like 'booking:' || b.id || ':outcome:%';
  v_delta := v_target - v_current;
  if v_delta = 0 then return; end if;
  if v_delta > 0 and p_actor is null and app_payment_disputed(b.id) then return; end if;
  insert into doctor_ledger_entries (doctor_id, booking_id, type, amount_cents, source_key, created_by)
  values (b.doctor_id, b.id,
          (case when v_delta < 0 then 'reversal'
                when b.session_status = 'no_show_client' then 'no_show_earning'
                else 'session_earning' end)::ledger_type,
          v_delta, 'booking:' || b.id || ':outcome:' || (v_n + 1), p_actor);
end $$;

create function public.app_open_client_choice(p_booking uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_deadline timestamptz;
begin
  update bookings
  set choice_deadline = coalesce(choice_deadline, now() + make_interval(days => app_setting_int('choice_window_days')))
  where id = p_booking
  returning choice_deadline into v_deadline;
  perform app_enqueue('email', jsonb_build_object('template', 'client_choice_needed', 'booking_id', p_booking),
                      'email:client_choice:' || p_booking);
  perform app_enqueue('choice_deadline', jsonb_build_object('booking_id', p_booking), 'choice_deadline:' || p_booking, v_deadline);
end $$;

create function public.record_session_outcome(p_booking uuid, p_status public.session_status, p_overlap_seconds int)
returns text language plpgsql security definer set search_path = public as $$
declare b bookings;
begin
  select * into b from bookings where id = p_booking for update;
  if not found then raise exception 'not_found'; end if;
  if b.booking_status <> 'confirmed' then raise exception 'not_confirmed'; end if;
  if now() < b.ends_at + interval '10 minutes' then raise exception 'too_early'; end if;
  if p_status not in ('completed', 'partial', 'no_show_client', 'no_show_doctor', 'needs_review') then
    raise exception 'invalid_status';
  end if;
  if b.outcome_decided_by is not null then return 'admin_locked'; end if;
  if exists (select 1 from issues where booking_id = b.id and type = 'dispute' and resolved_at is null) then
    return 'under_review';
  end if;
  if b.refund_choice is not null then return 'choice_made'; end if;
  update bookings set session_status = p_status, overlap_seconds = p_overlap_seconds,
    choice_deadline = case when p_status in ('partial', 'no_show_doctor') then choice_deadline end
  where id = b.id;
  if p_status in ('partial', 'no_show_doctor') then perform app_open_client_choice(b.id); end if;
  perform app_sync_outcome_earning(b.id, null);
  return 'recorded';
end $$;

create function public.admin_set_outcome(p_booking uuid, p_status public.session_status, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare b bookings;
begin
  if not app_is_admin() then raise exception 'forbidden'; end if;
  select * into b from bookings where id = p_booking for update;
  if not found then raise exception 'not_found'; end if;
  if b.booking_status <> 'confirmed' then raise exception 'not_confirmed'; end if;
  if b.refund_choice is not null and p_status in ('completed', 'no_show_client') then
    raise exception 'choice_already_made';
  end if;
  update bookings set session_status = p_status, outcome_decided_by = auth.uid(), outcome_decided_at = now(),
    choice_deadline = case when p_status in ('partial', 'no_show_doctor') or b.refund_choice is not null
                           then choice_deadline end
  where id = b.id;
  update issues set resolved_at = now(), resolution = p_note
  where booking_id = b.id and type = 'dispute' and resolved_at is null;
  if p_status in ('partial', 'no_show_doctor') then perform app_open_client_choice(b.id); end if;
  perform app_sync_outcome_earning(b.id, auth.uid());
end $$;

create function public.open_dispute(p_booking uuid, p_message text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  b bookings;
  v_id uuid;
begin
  select * into b from bookings where id = p_booking for update;
  if not found or auth.uid() is null or auth.uid() not in (b.client_id, b.doctor_id) then raise exception 'forbidden'; end if;
  if b.booking_status <> 'confirmed' then raise exception 'not_confirmed'; end if;
  if now() < b.starts_at then raise exception 'not_started'; end if;
  if now() > b.ends_at + make_interval(hours => app_setting_int('dispute_window_hours')) then
    raise exception 'dispute_window_closed';
  end if;
  insert into issues (booking_id, reporter_id, type, message) values (b.id, auth.uid(), 'dispute', p_message)
  returning id into v_id;
  update bookings set session_status = 'needs_review' where id = b.id;
  perform app_enqueue('admin_alert', jsonb_build_object('kind', 'dispute', 'booking_id', b.id, 'issue_id', v_id),
                      'alert:dispute:' || v_id);
  return v_id;
end $$;

create function public.report_connection_issue(p_booking uuid, p_message text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  b bookings;
  v_id uuid;
begin
  select * into b from bookings where id = p_booking;
  if not found or auth.uid() is null or auth.uid() not in (b.client_id, b.doctor_id) then raise exception 'forbidden'; end if;
  insert into issues (booking_id, reporter_id, type, message) values (b.id, auth.uid(), 'connection', p_message)
  returning id into v_id;
  perform app_enqueue('admin_alert', jsonb_build_object('kind', 'connection', 'booking_id', b.id, 'issue_id', v_id),
                      'alert:connection:' || v_id);
  return v_id;
end $$;

create function public.record_settlement(p_doctor uuid, p_amount_cents int, p_amount_toman bigint, p_toman_per_usd numeric,
                                         p_paid_at timestamptz, p_receipt_path text, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_left int := p_amount_cents;
  v_take int;
  e record;
begin
  if not app_is_admin() then raise exception 'forbidden'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'invalid_amount'; end if;
  perform pg_advisory_xact_lock(hashtext('settle:' || p_doctor::text));
  insert into settlements (doctor_id, amount_cents, amount_toman, toman_per_usd, paid_at, receipt_path, note, created_by)
  values (p_doctor, p_amount_cents, p_amount_toman, p_toman_per_usd, p_paid_at, p_receipt_path, p_note, auth.uid())
  returning id into v_id;
  for e in
    select l.id,
           l.amount_cents - coalesce((select sum(a.amount_cents) from settlement_allocations a where a.ledger_entry_id = l.id), 0) as cap
    from doctor_ledger_entries l
    where l.doctor_id = p_doctor and l.amount_cents > 0
    order by l.created_at, l.id
  loop
    exit when v_left <= 0;
    continue when e.cap <= 0;
    v_take := least(e.cap, v_left);
    insert into settlement_allocations (settlement_id, ledger_entry_id, amount_cents) values (v_id, e.id, v_take);
    v_left := v_left - v_take;
  end loop;
  return v_id;
end $$;

create view public.doctor_balances with (security_invoker = true) as
select d.id as doctor_id,
       coalesce((select sum(l.amount_cents) from public.doctor_ledger_entries l where l.doctor_id = d.id), 0)
     - coalesce((select sum(s.amount_cents) from public.settlements s where s.doctor_id = d.id), 0) as balance_cents
from public.doctors d
where d.id = auth.uid() or app_is_admin();

revoke execute on function public.app_sync_outcome_earning(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.app_open_client_choice(uuid) from public, anon, authenticated;
revoke execute on function public.record_session_outcome(uuid, public.session_status, int) from public, anon, authenticated;
grant execute on function public.record_session_outcome(uuid, public.session_status, int) to service_role;
revoke execute on function public.admin_set_outcome(uuid, public.session_status, text) from public, anon;
grant execute on function public.admin_set_outcome(uuid, public.session_status, text) to authenticated;
revoke execute on function public.open_dispute(uuid, text) from public, anon;
grant execute on function public.open_dispute(uuid, text) to authenticated;
revoke execute on function public.report_connection_issue(uuid, text) from public, anon;
grant execute on function public.report_connection_issue(uuid, text) to authenticated;
revoke execute on function public.record_settlement(uuid, int, bigint, numeric, timestamptz, text, text) from public, anon;
grant execute on function public.record_settlement(uuid, int, bigint, numeric, timestamptz, text, text) to authenticated;
