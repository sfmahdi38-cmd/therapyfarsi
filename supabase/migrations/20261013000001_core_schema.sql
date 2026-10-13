create extension if not exists btree_gist;

create type public.user_role as enum ('client', 'doctor', 'admin');
create type public.booking_status as enum ('held', 'confirmed', 'expired', 'cancelled');
create type public.session_status as enum ('scheduled', 'completed', 'partial', 'no_show_client', 'no_show_doctor', 'needs_review', 'void');
create type public.payment_status as enum ('pending', 'paid', 'failed', 'refund_pending', 'refunded_partial', 'refunded_full', 'disputed');
create type public.ledger_type as enum ('session_earning', 'no_show_earning', 'late_cancel_earning', 'reversal', 'adjustment');
create type public.issue_type as enum ('connection', 'dispute', 'other');
create type public.job_status as enum ('pending', 'running', 'done', 'failed');
create type public.doctor_kind as enum ('psychiatrist', 'psychologist', 'counselor');
create type public.gender as enum ('female', 'male');

-- settings -------------------------------------------------------------------
create table public.settings (key text primary key, value jsonb not null);
insert into public.settings (key, value) values
  ('min_lead_hours', '12'), ('max_horizon_days', '30'), ('hold_minutes', '30'),
  ('refund_window_hours', '24'), ('choice_window_days', '7'),
  ('free_reschedule_min_lead_hours', '2'), ('dispute_window_hours', '24');

create function public.app_setting_int(p_key text) returns int
language sql stable set search_path = public as
$$ select (value #>> '{}')::int from settings where key = p_key $$;

create function public.app_share_cents(p_price int, p_bps int, p_fixed int) returns int
language sql immutable as
$$ select case when p_fixed is not null then p_fixed else round(p_price::numeric * p_bps / 10000)::int end $$;

create function public.app_forbid_change() returns trigger language plpgsql as
$$ begin raise exception 'immutable_table'; end $$;

-- people ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  phone text,
  country text,
  timezone text not null default 'UTC',
  locale text not null default 'fa' check (locale in ('fa', 'en')),
  adult_confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'client'
);

create function public.app_handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email) values (new.id, new.email);
  insert into user_roles (user_id, role) values (new.id, 'client');
  return new;
end $$;
create trigger app_on_auth_user_created after insert on auth.users
  for each row execute function public.app_handle_new_user();

create table public.doctors (
  id uuid primary key references public.profiles (id) on delete restrict,
  slug text not null unique,
  title_fa text, title_en text, bio_fa text, bio_en text,
  photo_path text, intro_video_path text,
  gender public.gender not null,
  kind public.doctor_kind not null,
  specialties text[] not null default '{}',
  credential_type text, credential_number text, credential_issuer text,
  verified_at timestamptz, verified_by uuid references public.profiles (id),
  price_cents int not null check (price_cents > 0),
  share_bps int check (share_bps between 0 and 10000),
  share_fixed_cents int check (share_fixed_cents >= 0),
  session_minutes int not null default 50 check (session_minutes > 0),
  buffer_minutes int not null default 10 check (buffer_minutes >= 0),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  check ((share_bps is null) <> (share_fixed_cents is null)),
  check (app_share_cents(price_cents, share_bps, share_fixed_cents) < price_cents),
  check (price_cents - app_share_cents(price_cents, share_bps, share_fixed_cents) - (ceil(price_cents * 0.044)::int + 30) > 0)
);

create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  check (end_time > start_time)
);

create table public.time_off (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  check (ends_at > starts_at)
);

-- intake & consent -------------------------------------------------------------
create table public.policy_versions (
  id uuid primary key default gen_random_uuid(),
  rules jsonb not null,
  effective_from timestamptz not null default now()
);
insert into public.policy_versions (rules) values ('{"refund_window_hours": 24}');
create trigger app_policy_versions_immutable before update or delete on public.policy_versions
  for each row execute function public.app_forbid_change();

create table public.intake_responses (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.profiles (id) on delete cascade,
  guest_token_hash text unique,
  answers_enc text not null,
  key_version int not null default 1,
  risk_flag boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (client_id is not null or guest_token_hash is not null)
);

create table public.consents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  document text not null check (document in ('terms', 'privacy', 'treatment_consent', 'nonrefundable_window', 'review_publish')),
  version text not null,
  locale text not null,
  accepted_at timestamptz not null default now()
);

-- bookings & money ---------------------------------------------------------------
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id),
  doctor_id uuid not null references public.doctors (id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  blocked_until timestamptz not null,
  booking_status public.booking_status not null default 'held',
  session_status public.session_status not null default 'scheduled',
  hold_expires_at timestamptz,
  policy_version_id uuid references public.policy_versions (id),
  price_cents int not null check (price_cents > 0),
  doctor_share_cents int not null check (doctor_share_cents >= 0),
  share_rule jsonb not null,
  client_timezone text not null,
  nonrefundable_ack_at timestamptz,
  risk_flagged boolean not null default false,
  root_booking_id uuid references public.bookings (id),
  previous_booking_id uuid references public.bookings (id),
  cancelled_by uuid references public.profiles (id),
  cancelled_at timestamptz,
  cancel_reason text,
  refund_choice text check (refund_choice in ('refund', 'reschedule')),
  choice_deadline timestamptz,
  outcome_decided_by uuid references public.profiles (id),
  outcome_decided_at timestamptz,
  overlap_seconds int,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at and blocked_until >= ends_at),
  exclude using gist (doctor_id with =, tstzrange(starts_at, blocked_until, '[)') with &&)
    where (booking_status in ('held', 'confirmed'))
);
create index bookings_client_idx on public.bookings (client_id);
create index bookings_doctor_starts_idx on public.bookings (doctor_id, starts_at);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  amount_cents int not null check (amount_cents >= 0),
  currency text not null default 'usd',
  fee_cents int,
  fee_currency text,
  refunded_cents int not null default 0 check (refunded_cents >= 0),
  status public.payment_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id),
  stripe_refund_id text unique,
  amount_cents int not null check (amount_cents > 0),
  status text not null check (status in ('pending', 'succeeded', 'failed')),
  reason text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.session_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id),
  profile_id uuid not null references public.profiles (id),
  provider_event_id text not null unique,
  connection_id text,
  type text not null check (type in ('joined', 'left')),
  occurred_at timestamptz not null
);

create table public.issues (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id),
  reporter_id uuid not null references public.profiles (id),
  type public.issue_type not null,
  message text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text
);

create table public.doctor_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors (id),
  booking_id uuid references public.bookings (id),
  type public.ledger_type not null,
  amount_cents int not null check (amount_cents <> 0),
  source_key text not null unique,
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create trigger app_ledger_immutable before update or delete on public.doctor_ledger_entries
  for each row execute function public.app_forbid_change();

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid not null references public.doctors (id),
  amount_cents int not null check (amount_cents > 0),
  amount_toman bigint,
  toman_per_usd numeric,
  paid_at timestamptz not null,
  receipt_path text,
  note text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create trigger app_settlements_immutable before update or delete on public.settlements
  for each row execute function public.app_forbid_change();

create table public.settlement_allocations (
  settlement_id uuid not null references public.settlements (id),
  ledger_entry_id uuid not null references public.doctor_ledger_entries (id),
  amount_cents int not null check (amount_cents > 0),
  primary key (settlement_id, ledger_entry_id)
);
create trigger app_allocations_immutable before update or delete on public.settlement_allocations
  for each row execute function public.app_forbid_change();

-- notes, reviews ---------------------------------------------------------------
create table public.doctor_notes (
  booking_id uuid primary key references public.bookings (id),
  doctor_id uuid not null references public.doctors (id),
  body_enc text not null,
  key_version int not null default 1,
  updated_at timestamptz not null default now()
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id),
  rating smallint not null check (rating between 1 and 5),
  body text,
  display_name text,
  publish_consent_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create table public.client_admin_notes (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles (id),
  body text not null,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

-- infrastructure ---------------------------------------------------------------
create table public.stripe_events (
  event_id text primary key,
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  payload jsonb not null default '{}',
  idempotency_key text not null unique,
  status public.job_status not null default 'pending',
  attempts int not null default 0,
  max_attempts int not null default 5,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index jobs_due_idx on public.jobs (status, run_at);

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create trigger app_audit_immutable before update or delete on public.audit_log
  for each row execute function public.app_forbid_change();
