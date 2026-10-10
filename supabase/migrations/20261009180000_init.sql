-- Shopify CSV Sanitizer: complete database setup.
--
-- Idempotent: safe to run on an empty project, and safe to run again on a project that already has some or all of
-- these tables (it only adds what is missing). Apply it with `supabase db push`, or paste it into
-- Supabase Dashboard -> SQL Editor -> New query -> Run.
--
-- Only the server (the service-role key) touches these tables. Row level security is switched on and there are no
-- policies, so the public (anon / authenticated) keys can read and write nothing.

-- ---------------------------------------------------------------------------------------------------------------
-- usage_telemetry: one row per cleaned file. Counts, timings and sizes only, never file contents or real file names.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.usage_telemetry (
  id uuid primary key default gen_random_uuid(),
  file_name_anonymized text not null,             -- one-way hash + extension, never the real name
  total_rows integer not null,
  processing_time_ms integer not null,
  created_at timestamptz not null default timezone('utc', now()),
  email text,
  is_unlocked boolean default false
);

alter table public.usage_telemetry
  add column if not exists fix_count integer not null default 0,
  add column if not exists file_size_bytes bigint not null default 0;

create index if not exists usage_telemetry_created_at_idx on public.usage_telemetry (created_at desc);

-- ---------------------------------------------------------------------------------------------------------------
-- payment_intents: one row per checkout attempt. paid_at makes a purchase real; refunded_at takes it away again.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.payment_intents (
  id uuid primary key default gen_random_uuid(),
  email text,                                     -- the Stripe receipt email, lower case (used by /recover)
  clicked_at timestamptz not null default timezone('utc', now())
);

alter table public.payment_intents
  add column if not exists telemetry_id uuid references public.usage_telemetry (id) on delete set null,
  add column if not exists stripe_session_id text,
  add column if not exists paid_at timestamptz,
  add column if not exists file_fingerprint text,
  add column if not exists stripe_payment_intent_id text,   -- how a refund or dispute finds its purchase
  add column if not exists refunded_at timestamptz,         -- set by the webhook on a full refund or a dispute
  add column if not exists refund_reason text,              -- 'refund' | 'dispute'
  add column if not exists refund_requested_at timestamptz; -- set when an admin presses Refund in /admin; refunded_at still comes from the webhook

-- A unique INDEX (not an inline UNIQUE) so this also repairs a table whose column existed without the constraint.
-- NULLs are allowed more than once, so rows without a session id do not collide.
create unique index if not exists payment_intents_stripe_session_id_key on public.payment_intents (stripe_session_id);
create index if not exists payment_intents_telemetry_id_idx on public.payment_intents (telemetry_id);
create index if not exists payment_intents_stripe_payment_intent_id_idx on public.payment_intents (stripe_payment_intent_id);
create index if not exists payment_intents_email_paid_idx on public.payment_intents (email) where paid_at is not null;

-- ---------------------------------------------------------------------------------------------------------------
-- stripe_events: webhook idempotency. One row per Stripe event that was received; a redelivery finds its row.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.stripe_events (
  event_id text primary key,
  event_type text not null,
  status text not null default 'processing' check (status in ('processing', 'processed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

-- ---------------------------------------------------------------------------------------------------------------
-- free_trials: the one free unlock of a file over the free row limit, per person.
-- Personal data, kept minimal: email_hash is a keyed hash (HMAC with TRIAL_HASH_SECRET) of the normalised email, so the
-- email itself is NOT stored; browser_id is a random id held in the browser (localStorage + an httpOnly cookie);
-- marketing_email is filled ONLY when the person ticked the separate "product updates" box, together with the time.
-- One trial per email_hash and one per browser_id: the unique indexes below are what makes that race-safe.
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.free_trials (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null,
  browser_id text not null,
  file_fingerprint text not null,          -- the file this trial unlocked (a hash of its content, see fingerprintRows)
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.free_trials
  add column if not exists marketing_email text,            -- null unless the person opted in to product updates
  add column if not exists marketing_opt_in_at timestamptz; -- when they opted in (consent record); null otherwise

create unique index if not exists free_trials_email_hash_key on public.free_trials (email_hash);
create unique index if not exists free_trials_browser_id_key on public.free_trials (browser_id);
create index if not exists free_trials_created_at_idx on public.free_trials (created_at);

-- ---------------------------------------------------------------------------------------------------------------
-- Row level security: on, with no policies. Only the service role (which bypasses RLS) can read or write.
-- ---------------------------------------------------------------------------------------------------------------
alter table public.usage_telemetry enable row level security;
alter table public.payment_intents enable row level security;
alter table public.stripe_events enable row level security;
alter table public.free_trials enable row level security;

-- Housekeeping, optional: Stripe stops retrying an event after three days, so old rows can go.
--   delete from public.stripe_events where received_at < now() - interval '30 days';
-- Keep free_trials as long as your privacy policy says (COMPANY.trialRetention in src/site/company.ts). Deleting a row
-- gives that person (and browser) a new free file, so purge only on that schedule:
--   delete from public.free_trials where created_at < now() - interval '24 months';
-- Withdrawing consent to product updates (they ask you to stop): update public.free_trials set marketing_email = null,
-- marketing_opt_in_at = null where marketing_email = 'their@address';
