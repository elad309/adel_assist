-- Adel Assistant — initial schema (multi-tenant)
-- Run: psql <SUPABASE_DB_URL> -f supabase/migrations/0001_init.sql

-- =============================================================
-- Users — source of truth for identity. Channel-specific IDs
-- (telegram_id, whatsapp_phone, ...) point back here.
-- =============================================================
create table if not exists adel_users (
  id              bigint generated always as identity primary key,
  telegram_id     bigint unique,
  whatsapp_phone  text unique,
  display_name    text,
  language        text not null default 'he',
  timezone        text not null default 'Asia/Jerusalem',
  is_admin        boolean not null default false,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);

create index if not exists adel_users_telegram_idx on adel_users (telegram_id);

-- =============================================================
-- Personal data — preferences, contacts, etc. Per user.
-- =============================================================
create table if not exists adel_personal_data (
  id          bigint generated always as identity primary key,
  user_id     bigint not null references adel_users(id) on delete cascade,
  key         text not null,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  unique (user_id, key)
);

-- =============================================================
-- CausaDB — W* memory: things the user told Adel to remember.
-- =============================================================
do $$ begin
  create type adel_w_type as enum (
    'what', 'where', 'when', 'who', 'why', 'how', 'how_much'
  );
exception when duplicate_object then null; end $$;

create table if not exists adel_causa_memory (
  id          bigint generated always as identity primary key,
  user_id     bigint not null references adel_users(id) on delete cascade,
  w_type      adel_w_type not null,
  subject     text not null,
  content     text not null,
  raw_query   text,
  created_at  timestamptz not null default now()
);

create index if not exists adel_causa_user_subject_idx
  on adel_causa_memory (user_id, subject);
create index if not exists adel_causa_user_w_type_idx
  on adel_causa_memory (user_id, w_type);

-- =============================================================
-- Execution log — every routed query. Per user. Drives 80% target.
-- =============================================================
create table if not exists adel_execution_log (
  id            bigint generated always as identity primary key,
  user_id       bigint not null references adel_users(id) on delete cascade,
  channel       text not null,
  query         text not null,
  intent        jsonb,
  route         text not null check (route in ('script', 'llm_fallback', 'error')),
  handler       text,
  latency_ms    integer,
  success       boolean,
  response      text,
  created_at    timestamptz not null default now()
);

create index if not exists adel_execution_user_route_idx
  on adel_execution_log (user_id, route, created_at desc);

-- =============================================================
-- Pending scripts — Teacher Guard logs LLM fallbacks here.
-- The RESULTING scripts are global; this table is per-user gap log.
-- Admin reviews these and merges into the (global) Scripts Bank.
-- =============================================================
create table if not exists adel_pending_scripts (
  id            bigint generated always as identity primary key,
  user_id       bigint not null references adel_users(id) on delete cascade,
  source_query  text not null,
  intent        jsonb not null,
  llm_response  text not null,
  status        text not null default 'pending'
                check (status in ('pending', 'drafted', 'merged', 'rejected')),
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists adel_pending_status_idx
  on adel_pending_scripts (status, created_at desc);

-- =============================================================
-- Row Level Security
-- Service role (which the bot uses) bypasses RLS, but we still
-- enable it so any future client/anon access is locked down.
-- =============================================================
alter table adel_users           enable row level security;
alter table adel_personal_data   enable row level security;
alter table adel_causa_memory    enable row level security;
alter table adel_execution_log   enable row level security;
alter table adel_pending_scripts enable row level security;

-- Default: deny all to anon/authenticated. Service role bypasses RLS.
-- When we add a user-facing web UI we'll add per-user policies here.
