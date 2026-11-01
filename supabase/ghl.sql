-- ============================================================
-- GoHighLevel mirror — paste into the Supabase SQL Editor and Run.
-- Safe to re-run (create-if-not-exists everywhere).
-- These tables are a READ-ONLY copy of GHL, refreshed by /api/ghl-sync.
-- Kept separate from `records` so thousands of GHL rows never slow the tabs.
-- ============================================================

create table if not exists ghl_opportunities (
  id               text primary key,
  name             text,
  contact_id       text,
  contact_name     text,
  email            text,
  phone            text,
  pipeline_id      text,
  pipeline_name    text,
  stage_id         text,
  stage_name       text,
  stage_bucket     text,      -- lead | appointment | showed | no_show | cancelled | sale | purchase | lost | nurture
  status           text,      -- GHL status: open | won | lost | abandoned
  monetary_value   numeric default 0,
  assigned_to      text,
  rep_name         text,
  source           text,
  tags             text[],
  created_at       timestamptz,
  updated_at       timestamptz,
  stage_changed_at timestamptz,
  synced_at        timestamptz not null default now()
);
create index if not exists ghl_opps_created on ghl_opportunities (created_at desc);
create index if not exists ghl_opps_stage_changed on ghl_opportunities (stage_changed_at desc);
create index if not exists ghl_opps_contact on ghl_opportunities (contact_id);

create table if not exists ghl_appointments (
  id               text primary key,
  calendar_id      text,
  calendar_name    text,
  contact_id       text,
  title            text,
  status           text,      -- confirmed | showed | noshow | cancelled | invalid | new
  assigned_user_id text,
  rep_name         text,
  start_time       timestamptz,
  created_at       timestamptz,
  synced_at        timestamptz not null default now()
);
create index if not exists ghl_appts_start on ghl_appointments (start_time desc);

create table if not exists ghl_payments (
  id               text primary key,
  contact_id       text,
  contact_name     text,
  email            text,
  amount           numeric,   -- in the payment's own currency
  currency         text,
  fx_rate          numeric,   -- units of `currency` per 1 SGD at sync time
  amount_sgd       numeric,
  refunded_sgd     numeric default 0,
  status           text,
  source_name      text,
  created_at       timestamptz,
  synced_at        timestamptz not null default now()
);
create index if not exists ghl_pay_created on ghl_payments (created_at desc);

create table if not exists ghl_onboarding (
  id               text primary key,
  contact_id       text,
  name             text,
  email            text,
  phone            text,
  form_id          text,
  form_name        text,
  answers          jsonb not null default '{}'::jsonb,
  submitted_at     timestamptz,
  synced_at        timestamptz not null default now()
);
create index if not exists ghl_onb_submitted on ghl_onboarding (submitted_at desc);

-- Sync bookkeeping: cursors for the chunked first backfill + last-run summary.
create table if not exists ghl_sync_state (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- One call that returns every number the Sales tab needs, so the page never
-- pulls thousands of rows. p_pipeline = null means "all pipelines".
create or replace function ghl_summary(p_from timestamptz, p_pipeline text default null)
returns jsonb language sql stable as $$
  with o as (
    select * from ghl_opportunities where p_pipeline is null or pipeline_id = p_pipeline
  ),
  a as (
    select * from ghl_appointments
    where start_time >= p_from and coalesce(status, '') not in ('cancelled', 'invalid')
  ),
  p as (
    select * from ghl_payments where status = 'succeeded' and created_at >= p_from
  )
  select jsonb_build_object(
    'leads',        (select count(*) from o where created_at >= p_from),
    'booked',       (select count(*) from a where start_time <= now()),
    'upcoming',     (select count(*) from a where start_time > now()),
    'showed',       (select count(*) from a where status = 'showed'),
    'no_shows',     (select count(*) from a where status = 'noshow'),
    'unmarked',     (select count(*) from a where start_time <= now() and coalesce(status, '') not in ('showed', 'noshow')),
    'sales',        (select count(*) from o where stage_bucket = 'sale' and stage_changed_at >= p_from),
    'sales_value',  (select coalesce(sum(monetary_value), 0) from o where stage_bucket = 'sale' and stage_changed_at >= p_from),
    'lost',         (select count(*) from o where stage_bucket = 'lost' and stage_changed_at >= p_from),
    'cash_sgd',     (select coalesce(sum(amount_sgd - coalesce(refunded_sgd, 0)), 0) from p),
    'payments',     (select count(*) from p),
    'by_rep', (
      select coalesce(jsonb_agg(r order by r.sales desc, r.leads desc), '[]'::jsonb) from (
        select rep,
               sum(leads)  as leads,
               sum(booked) as booked,
               sum(showed) as showed,
               sum(noshow) as no_shows,
               sum(sales)  as sales,
               sum(lost)   as lost
        from (
          select coalesce(rep_name, 'Unassigned') as rep,
                 count(*) filter (where created_at >= p_from) as leads,
                 0 as booked, 0 as showed, 0 as noshow,
                 count(*) filter (where stage_bucket = 'sale' and stage_changed_at >= p_from) as sales,
                 count(*) filter (where stage_bucket = 'lost' and stage_changed_at >= p_from) as lost
          from o group by 1
          union all
          select coalesce(rep_name, 'Unassigned'),
                 0,
                 count(*) filter (where start_time <= now()),
                 count(*) filter (where status = 'showed'),
                 count(*) filter (where status = 'noshow'),
                 0, 0
          from a group by 1
        ) x
        group by rep
        having sum(leads) + sum(booked) + sum(sales) + sum(lost) > 0
      ) r
    )
  );
$$;
