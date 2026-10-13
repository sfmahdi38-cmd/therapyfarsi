create function public.app_role() returns public.user_role
language sql stable security definer set search_path = public as
$$ select role from user_roles where user_id = auth.uid() $$;

create function public.app_is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select role from user_roles where user_id = auth.uid()) = 'admin'
                   and coalesce(auth.jwt()->>'aal', '') = 'aal2', false) $$;

create function public.app_is_doctor() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select role from user_roles where user_id = auth.uid()) = 'doctor', false) $$;

alter table public.settings enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.doctors enable row level security;
alter table public.availability_rules enable row level security;
alter table public.time_off enable row level security;
alter table public.policy_versions enable row level security;
alter table public.intake_responses enable row level security;
alter table public.consents enable row level security;
alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.session_events enable row level security;
alter table public.issues enable row level security;
alter table public.doctor_ledger_entries enable row level security;
alter table public.settlements enable row level security;
alter table public.settlement_allocations enable row level security;
alter table public.doctor_notes enable row level security;
alter table public.reviews enable row level security;
alter table public.client_admin_notes enable row level security;
alter table public.stripe_events enable row level security;
alter table public.jobs enable row level security;
alter table public.audit_log enable row level security;

-- settings & policy versions: readable by all, written by admin
create policy settings_read on public.settings for select to anon, authenticated using (true);
create policy settings_admin on public.settings for all to authenticated using (app_is_admin()) with check (app_is_admin());
create policy policy_versions_read on public.policy_versions for select to anon, authenticated using (true);
create policy policy_versions_admin on public.policy_versions for insert to authenticated with check (app_is_admin());

-- profiles
create policy profiles_self_read on public.profiles for select to authenticated using (id = auth.uid());
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin on public.profiles for all to authenticated using (app_is_admin()) with check (app_is_admin());

-- roles: read own; only admin writes
create policy user_roles_self_read on public.user_roles for select to authenticated using (user_id = auth.uid());
create policy user_roles_admin on public.user_roles for all to authenticated using (app_is_admin()) with check (app_is_admin());

-- doctors
create policy doctors_public_read on public.doctors for select to anon, authenticated using (is_active);
create policy doctors_self_read on public.doctors for select to authenticated using (id = auth.uid());
create policy doctors_admin on public.doctors for all to authenticated using (app_is_admin()) with check (app_is_admin());

-- availability & time off
create policy rules_public_read on public.availability_rules for select to anon, authenticated
  using (exists (select 1 from doctors d where d.id = doctor_id and d.is_active));
create policy rules_doctor_own on public.availability_rules for all to authenticated
  using (doctor_id = auth.uid()) with check (doctor_id = auth.uid() and app_is_doctor());
create policy rules_admin on public.availability_rules for all to authenticated using (app_is_admin()) with check (app_is_admin());
create policy time_off_public_read on public.time_off for select to anon, authenticated
  using (exists (select 1 from doctors d where d.id = doctor_id and d.is_active));
create policy time_off_doctor_own on public.time_off for all to authenticated
  using (doctor_id = auth.uid()) with check (doctor_id = auth.uid() and app_is_doctor());
create policy time_off_admin on public.time_off for all to authenticated using (app_is_admin()) with check (app_is_admin());

-- intake & consent
create policy intake_client_own on public.intake_responses for select to authenticated using (client_id = auth.uid());
create policy intake_doctor_read on public.intake_responses for select to authenticated
  using (exists (select 1 from bookings b where b.client_id = intake_responses.client_id and b.doctor_id = auth.uid()
                 and b.booking_status = 'confirmed'));
create policy intake_admin_read on public.intake_responses for select to authenticated using (app_is_admin());
create policy consents_own on public.consents for select to authenticated using (profile_id = auth.uid());
create policy consents_own_insert on public.consents for insert to authenticated with check (profile_id = auth.uid());
create policy consents_admin_read on public.consents for select to authenticated using (app_is_admin());

-- bookings: read only; all writes go through security-definer functions
create policy bookings_client_read on public.bookings for select to authenticated using (client_id = auth.uid());
create policy bookings_doctor_read on public.bookings for select to authenticated using (doctor_id = auth.uid());
create policy bookings_admin_read on public.bookings for select to authenticated using (app_is_admin());

-- money: client sees own payment; doctors see none
create policy payments_client_read on public.payments for select to authenticated
  using (exists (select 1 from bookings b where b.id = payments.booking_id and b.client_id = auth.uid()));
create policy payments_admin_read on public.payments for select to authenticated using (app_is_admin());
create policy refunds_admin_read on public.refunds for select to authenticated using (app_is_admin());
create policy ledger_doctor_read on public.doctor_ledger_entries for select to authenticated using (doctor_id = auth.uid());
create policy ledger_admin_read on public.doctor_ledger_entries for select to authenticated using (app_is_admin());
create policy settlements_doctor_read on public.settlements for select to authenticated using (doctor_id = auth.uid());
create policy settlements_admin_read on public.settlements for select to authenticated using (app_is_admin());
create policy allocations_doctor_read on public.settlement_allocations for select to authenticated
  using (exists (select 1 from settlements s where s.id = settlement_id and s.doctor_id = auth.uid()));
create policy allocations_admin_read on public.settlement_allocations for select to authenticated using (app_is_admin());

-- sessions & issues
create policy session_events_admin_read on public.session_events for select to authenticated using (app_is_admin());
create policy issues_reporter_read on public.issues for select to authenticated using (reporter_id = auth.uid());
create policy issues_doctor_read on public.issues for select to authenticated
  using (exists (select 1 from bookings b where b.id = issues.booking_id and b.doctor_id = auth.uid()));
create policy issues_admin on public.issues for all to authenticated using (app_is_admin()) with check (app_is_admin());

-- doctor notes: the doctor only. No admin policy on purpose.
create policy doctor_notes_own on public.doctor_notes for all to authenticated
  using (doctor_id = auth.uid())
  with check (doctor_id = auth.uid() and exists (select 1 from bookings b where b.id = booking_id and b.doctor_id = auth.uid()));

-- reviews
create policy reviews_public_read on public.reviews for select to anon, authenticated using (status = 'approved');
create policy reviews_client_read on public.reviews for select to authenticated
  using (exists (select 1 from bookings b where b.id = reviews.booking_id and b.client_id = auth.uid()));
create policy reviews_client_insert on public.reviews for insert to authenticated
  with check (status = 'pending' and exists (
    select 1 from bookings b where b.id = booking_id and b.client_id = auth.uid() and b.session_status = 'completed'));
create policy reviews_admin on public.reviews for all to authenticated using (app_is_admin()) with check (app_is_admin());

-- admin-only tables
create policy client_admin_notes_admin on public.client_admin_notes for all to authenticated using (app_is_admin()) with check (app_is_admin());
create policy stripe_events_admin_read on public.stripe_events for select to authenticated using (app_is_admin());
create policy jobs_admin_read on public.jobs for select to authenticated using (app_is_admin());
create policy audit_admin_read on public.audit_log for select to authenticated using (app_is_admin());

-- First name of a client, only for a doctor who has a confirmed booking with them.
create function public.app_client_first_name(p_client uuid) returns text
language sql stable security definer set search_path = public as $$
  select split_part(coalesce(p.full_name, ''), ' ', 1)
  from profiles p
  where p.id = p_client
    and exists (select 1 from bookings b where b.client_id = p_client and b.doctor_id = auth.uid()
                and b.booking_status = 'confirmed')
$$;

-- doctor's view of own bookings (no money columns, no contact details)
create view public.doctor_bookings with (security_invoker = true) as
select b.id, b.doctor_id, b.client_id,
       app_client_first_name(b.client_id) as client_first_name,
       b.starts_at, b.ends_at, b.booking_status, b.session_status, b.risk_flagged
from public.bookings b
where b.doctor_id = auth.uid();
