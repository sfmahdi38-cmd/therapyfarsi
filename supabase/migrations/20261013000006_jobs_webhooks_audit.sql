create function public.claim_jobs(p_limit int) returns setof public.jobs
language sql security definer set search_path = public as $$
  update jobs set status = 'running', locked_at = now(), attempts = attempts + 1
  where id in (
    select id from jobs
    where (status = 'pending' and run_at <= now())
       or (status = 'running' and locked_at < now() - interval '5 minutes')
    order by run_at
    limit p_limit
    for update skip locked
  )
  returning *
$$;

create function public.complete_job(p_id uuid) returns void
language sql security definer set search_path = public as
$$ update jobs set status = 'done', locked_at = null where id = p_id $$;

create function public.fail_job(p_id uuid, p_error text) returns text
language plpgsql security definer set search_path = public as $$
declare j jobs;
begin
  select * into j from jobs where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if j.attempts >= j.max_attempts then
    update jobs set status = 'failed', locked_at = null, last_error = p_error where id = p_id;
    return 'failed';
  end if;
  update jobs set status = 'pending', locked_at = null, last_error = p_error,
                  run_at = now() + make_interval(mins => power(2, j.attempts)::int)
  where id = p_id;
  return 'retry';
end $$;

create function public.record_refund_result(p_stripe_refund_id text, p_payment_intent text, p_amount_cents int, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  p payments;
  v_refunded int;
begin
  select * into p from payments where stripe_payment_intent_id = p_payment_intent for update;
  if not found then raise exception 'unknown_payment'; end if;
  insert into refunds (payment_id, stripe_refund_id, amount_cents, status)
  values (p.id, p_stripe_refund_id, p_amount_cents, p_status)
  on conflict (stripe_refund_id) do update set status = excluded.status;
  select coalesce(sum(amount_cents), 0) into v_refunded from refunds where payment_id = p.id and status = 'succeeded';
  update payments set refunded_cents = v_refunded,
    status = (case
      when p.status = 'disputed' then 'disputed'
      when v_refunded >= p.amount_cents then 'refunded_full'
      when exists (select 1 from refunds where payment_id = p.id and status in ('failed', 'pending')) then 'refund_pending'
      when v_refunded > 0 then 'refunded_partial'
      else p.status::text end)::payment_status
  where id = p.id;
  if p_status = 'failed' then
    perform app_enqueue('admin_alert', jsonb_build_object('kind', 'refund_failed', 'payment_id', p.id),
                        'alert:refund_failed:' || p_stripe_refund_id);
  end if;
end $$;

create function public.mark_payment_disputed(p_payment_intent text) returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  update payments set status = 'disputed' where stripe_payment_intent_id = p_payment_intent returning id into v_id;
  if v_id is null then raise exception 'unknown_payment'; end if;
  perform app_enqueue('admin_alert', jsonb_build_object('kind', 'payment_disputed', 'payment_id', v_id),
                      'alert:payment_disputed:' || p_payment_intent);
end $$;

create function public.set_payment_fee(p_payment_intent text, p_fee_cents int, p_fee_currency text) returns void
language sql security definer set search_path = public as
$$ update payments set fee_cents = p_fee_cents, fee_currency = lower(p_fee_currency) where stripe_payment_intent_id = p_payment_intent $$;

create function public.app_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into audit_log (actor_id, action, entity, entity_id, before, after)
  values (auth.uid(), tg_op, tg_table_name, coalesce(v_row->>'id', v_row->>'user_id'),
          case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end);
  return null;
end $$;

create trigger app_audit_bookings after insert or update on public.bookings for each row execute function public.app_audit();
create trigger app_audit_payments after insert or update on public.payments for each row execute function public.app_audit();
create trigger app_audit_refunds after insert or update on public.refunds for each row execute function public.app_audit();
create trigger app_audit_ledger after insert on public.doctor_ledger_entries for each row execute function public.app_audit();
create trigger app_audit_settlements after insert on public.settlements for each row execute function public.app_audit();
create trigger app_audit_user_roles after insert or update or delete on public.user_roles for each row execute function public.app_audit();
create trigger app_audit_doctors after insert or update on public.doctors for each row execute function public.app_audit();

revoke execute on function public.claim_jobs(int) from public, anon, authenticated;
grant execute on function public.claim_jobs(int) to service_role;
revoke execute on function public.complete_job(uuid) from public, anon, authenticated;
grant execute on function public.complete_job(uuid) to service_role;
revoke execute on function public.fail_job(uuid, text) from public, anon, authenticated;
grant execute on function public.fail_job(uuid, text) to service_role;
revoke execute on function public.record_refund_result(text, text, int, text) from public, anon, authenticated;
grant execute on function public.record_refund_result(text, text, int, text) to service_role;
revoke execute on function public.mark_payment_disputed(text) from public, anon, authenticated;
grant execute on function public.mark_payment_disputed(text) to service_role;
revoke execute on function public.set_payment_fee(text, int, text) from public, anon, authenticated;
grant execute on function public.set_payment_fee(text, int, text) to service_role;
