-- ============================================================
-- CASHFLOWOS AI AGENTS — your Money Robot's database.
-- Paste this WHOLE block into the Supabase SQL Editor (your own free project)
-- and click Run once. Safe to re-run: it never duplicates or deletes your rows
-- (create-if-not-exists · add-column-if-not-exists · seeds guarded by NOT EXISTS).
-- ============================================================

-- ------------------------------------------------------------
-- 1) records — the business spine. One row = one thing you track.
--    Categories: cash_in | cash_out | lead | customer | content | task | doc
-- ------------------------------------------------------------
create table if not exists records (
  id          bigint generated always as identity primary key,
  title       text        not null,
  status      text        not null default 'open',   -- free text; leads use the funnel stages
  amount      numeric     default 0,                 -- RM value if money-related, else 0
  category    text,                                  -- cash_in | cash_out | lead | customer | content | task | doc
  due_date    date,
  notes       text,
  meta        jsonb       not null default '{}'::jsonb, -- extra per-tab fields (platform, format, views, next...)
  created_at  timestamptz not null default now()
);
alter table records add column if not exists meta jsonb not null default '{}'::jsonb;

-- ------------------------------------------------------------
-- 2) agent_actions — the proposals/approvals table. THE HITL HEART.
--    A robot's wish is written here ONCE, a human (or the autopilot dial) decides,
--    then it's claimed + executed exactly once. Never fold this into records.
-- ------------------------------------------------------------
create table if not exists agent_actions (
  id                bigint generated always as identity primary key,
  agent_key         text        not null,
  idempotency_key   text        not null unique,      -- dedupe: one wish per event
  payload           jsonb       not null,             -- written once, immutable
  status            text        not null default 'proposed',
                    -- proposed | approved | rejected | expired | executing | executed | failed
  proposed_at       timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '24 hours'),
  decided_at        timestamptz,
  executed_at       timestamptz,
  approver_chat_id  bigint,                            -- null = decided by the robot (autopilot)
  result            jsonb,
  error             text,
  notify_chat_id    bigint,                            -- captured from sendWithButtons()...
  notify_message_id bigint                             -- ...so the in-app approve path can strip the buttons
);
-- add-column-if-not-exists guards, in case an older version of this file ran first
alter table agent_actions add column if not exists notify_chat_id    bigint;
alter table agent_actions add column if not exists notify_message_id bigint;
alter table agent_actions add column if not exists result            jsonb;
alter table agent_actions add column if not exists error             text;

-- ------------------------------------------------------------
-- 3) agent_runs — one row per agent invocation. Feeds the Activity view.
-- ------------------------------------------------------------
create table if not exists agent_runs (
  id          bigint generated always as identity primary key,
  agent_key   text        not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  outcome     text,                                    -- ok | escalated | failed | noop ...
  detail      jsonb       not null default '{}'::jsonb
);

-- ------------------------------------------------------------
-- 4) vault_files — uploaded receipts/docs. The dedupe constraint lives HERE
--    (sha256 unique), not in a jsonb expression index.
-- ------------------------------------------------------------
create table if not exists vault_files (
  id                   bigint generated always as identity primary key,
  sha256               text        not null unique,     -- same file twice = same hash = skip
  storage_path         text,
  mime                 text,
  size_bytes           bigint,
  uploaded_by_chat_id  bigint,
  record_id            bigint,                           -- links to the records row it created
  created_at           timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 5) bot_memory — the bot's short-term memory + per-chat daily counters
--    (e.g. the vision-call cost cap). Read/written by lib/bot-memory.ts.
-- ------------------------------------------------------------
create table if not exists bot_memory (
  chat_id     bigint      primary key,
  turns       jsonb       not null default '[]'::jsonb,
  counters    jsonb       not null default '{}'::jsonb,  -- {"vision:2026-07-23": 3}
  updated_at  timestamptz not null default now()
);
alter table bot_memory add column if not exists counters jsonb not null default '{}'::jsonb;

-- ------------------------------------------------------------
-- 6) tg_updates — Telegram delivery dedupe. Telegram RETRIES un-acked webhooks;
--    inserting the update_id here 'on conflict do nothing' means a retry of an
--    in-flight update is a 0-row no-op → we never double-process a photo.
-- ------------------------------------------------------------
create table if not exists tg_updates (
  update_id   bigint      primary key,
  received_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Security: server-side only. Your Next.js server uses the SERVICE_ROLE key,
-- which bypasses RLS. Enabling RLS with NO policies means anon/public gets
-- nothing — exactly what we want. Never expose these rows via a public route.
-- ------------------------------------------------------------
alter table records       enable row level security;
alter table agent_actions enable row level security;
alter table agent_runs    enable row level security;
alter table vault_files   enable row level security;
alter table bot_memory    enable row level security;
alter table tg_updates    enable row level security;

-- ------------------------------------------------------------
-- Private storage bucket for uploaded photos/PDFs. public=false → the UI can only
-- reach files through short-lived server-generated signed URLs.
-- If your Supabase blocks this insert, create a bucket named "vault" (Public =
-- OFF) in the dashboard Storage tab — 2 clicks. The app shows a calm banner if
-- the bucket is missing.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('vault', 'vault', false)
on conflict (id) do nothing;

-- ============================================================
-- No demo seed rows: real data comes from the Google Sheets sync (lib/sheets.ts).
-- Each imported row carries a stable source_id so re-syncs never duplicate it.
-- ============================================================
alter table records add column if not exists source_id text;
create unique index if not exists records_source_id_key on records (source_id);
