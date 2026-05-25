-- Adel Assistant — Invisible Admin MVP schema
-- Adds: businesses, role routing, drafts (HitL), documents (Q&A)
-- Run: psql <SUPABASE_DB_URL> -f supabase/migrations/0002_invisible_admin.sql

-- pgvector for document embeddings (Document Q&A)
create extension if not exists vector;

-- =============================================================
-- Loosen execution_log.route check to support new routes:
--   rag_grounded, draft_for_owner, llm_owner
-- =============================================================
alter table adel_execution_log
  drop constraint if exists adel_execution_log_route_check;
alter table adel_execution_log
  add constraint adel_execution_log_route_check
  check (route in (
    'script',
    'llm_fallback',
    'llm_owner',
    'rag_grounded',
    'draft_for_owner',
    'error'
  ));

-- =============================================================
-- Businesses — each owner registers a business; clients/employees
-- belong to it. One business = one Telegram bot conversation context.
-- =============================================================
create table if not exists adel_businesses (
  id              bigint generated always as identity primary key,
  name            text not null,
  owner_user_id   bigint,                          -- FK added after adel_users exists
  created_at      timestamptz not null default now()
);

-- =============================================================
-- Extend adel_users with role + business_id.
-- =============================================================
do $$ begin
  create type adel_role as enum ('owner', 'client', 'employee');
exception when duplicate_object then null; end $$;

alter table adel_users
  add column if not exists role         adel_role not null default 'client',
  add column if not exists business_id  bigint references adel_businesses(id) on delete set null;

create index if not exists adel_users_business_role_idx
  on adel_users (business_id, role);

-- Now we can wire owner_user_id back to adel_users
alter table adel_businesses
  drop constraint if exists adel_businesses_owner_fk;
alter table adel_businesses
  add constraint adel_businesses_owner_fk
  foreign key (owner_user_id) references adel_users(id) on delete set null;

-- =============================================================
-- Drafts — HitL queue. When the bot can't auto-reply to a client,
-- it drafts a response and pings the owner. Owner approves/rejects.
-- =============================================================
do $$ begin
  create type adel_draft_status as enum ('pending', 'approved', 'rejected', 'sent', 'expired');
exception when duplicate_object then null; end $$;

create table if not exists adel_drafts (
  id                bigint generated always as identity primary key,
  business_id       bigint not null references adel_businesses(id) on delete cascade,
  client_user_id    bigint not null references adel_users(id) on delete cascade,
  client_query      text not null,
  drafted_reply     text not null,
  reasoning         text,                  -- why the bot drafted this (citations / sources used)
  status            adel_draft_status not null default 'pending',
  owner_message_id  bigint,                -- telegram message_id of the approval ping
  approved_at       timestamptz,
  sent_at           timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists adel_drafts_business_status_idx
  on adel_drafts (business_id, status, created_at desc);

-- =============================================================
-- Documents — PDFs/text the owner uploaded. Chunked + embedded.
-- =============================================================
create table if not exists adel_documents (
  id            bigint generated always as identity primary key,
  business_id   bigint not null references adel_businesses(id) on delete cascade,
  filename      text not null,
  mime_type     text not null,
  size_bytes    integer not null,
  uploaded_by   bigint not null references adel_users(id) on delete set null,
  created_at    timestamptz not null default now()
);

create table if not exists adel_document_chunks (
  id            bigint generated always as identity primary key,
  document_id   bigint not null references adel_documents(id) on delete cascade,
  business_id   bigint not null references adel_businesses(id) on delete cascade,
  chunk_index   integer not null,
  content       text not null,
  embedding     vector(1536),              -- OpenAI text-embedding-3-small dim
  created_at    timestamptz not null default now()
);

create index if not exists adel_document_chunks_business_idx
  on adel_document_chunks (business_id);

-- HNSW index for fast similarity search per business
create index if not exists adel_document_chunks_embedding_idx
  on adel_document_chunks
  using hnsw (embedding vector_cosine_ops);

-- =============================================================
-- RPC for vector search scoped to a business.
-- =============================================================
create or replace function adel_match_chunks(
  p_business_id bigint,
  p_query_embedding vector(1536),
  p_match_count int default 5
)
returns table (
  chunk_id    bigint,
  document_id bigint,
  filename    text,
  content     text,
  similarity  float
)
language sql stable
as $$
  select
    c.id,
    c.document_id,
    d.filename,
    c.content,
    1 - (c.embedding <=> p_query_embedding) as similarity
  from adel_document_chunks c
  join adel_documents d on d.id = c.document_id
  where c.business_id = p_business_id
    and c.embedding is not null
  order by c.embedding <=> p_query_embedding
  limit p_match_count;
$$;

-- =============================================================
-- RLS: lock down new tables. Service role bypasses.
-- =============================================================
alter table adel_businesses       enable row level security;
alter table adel_drafts           enable row level security;
alter table adel_documents        enable row level security;
alter table adel_document_chunks  enable row level security;
