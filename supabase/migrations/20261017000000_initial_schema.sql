-- Prospecting engine: initial schema.
-- Every table carries workspace_id so one engine can serve several products
-- and RLS can use a single membership check.

create extension if not exists citext;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sending_enabled boolean not null default false, -- global kill switch
  created_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create or replace function is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws and user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Products: everything product-specific is configuration
-- ---------------------------------------------------------------------------

create table products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  name text not null,
  description text not null default '',
  stage_label text not null default 'beta', -- how outreach must describe the product
  icp jsonb not null default '{}'::jsonb,
  qualification_rubric jsonb not null default '[]'::jsonb,
  value_props jsonb not null default '[]'::jsonb,
  -- [{ "feature": "...", "status": "working" | "roadmap" }]; drafts may cite only "working"
  approved_claims jsonb not null default '[]'::jsonb,
  discovery jsonb not null default '{}'::jsonb, -- { business_label, search_hints[] }
  sender_name text,
  sender_company text,
  postal_address text, -- required before any send (CAN-SPAM)
  demo_link text,
  daily_send_cap int not null default 40,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Prospects
-- ---------------------------------------------------------------------------

create table brokerages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  name text not null,
  domain citext,
  licensee_count int,
  licensee_count_fact_id uuid,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create type org_type as enum ('solo_agent', 'team', 'independent_brokerage', 'franchise_office', 'other', 'unknown');

create table organizations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  name text not null,
  org_type org_type not null default 'unknown',
  website text,
  domain citext, -- normalized: lowercase host without www.
  phone_e164 text,
  city text,
  county text,
  state text,
  brokerage_id uuid references brokerages on delete set null,
  team_size int, -- only set from a verified fact
  team_size_fact_id uuid,
  lead_source text not null, -- e.g. 'discovery', 'csv:<file>', 'manual'
  notes text not null default '',
  researched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index organizations_domain_uniq on organizations (workspace_id, domain) where domain is not null;
create index organizations_name_trgm on organizations using gin (name gin_trgm_ops);
create index organizations_market on organizations (workspace_id, state, county, city);

create type email_status as enum ('unknown', 'source_listed', 'deliverable', 'undeliverable', 'bounced');

create table contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  organization_id uuid not null references organizations on delete cascade,
  full_name text,
  role text,
  email citext,
  email_status email_status not null default 'unknown',
  email_fact_id uuid,
  phone_e164 text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index contacts_email_uniq on contacts (workspace_id, email) where email is not null;
create index contacts_org on contacts (organization_id);

create type fact_source_type as enum ('website', 'public_record', 'search_result', 'csv', 'manual');
create type fact_extractor as enum ('ai', 'human', 'import', 'rule');

-- Provenance ledger: every claim about a prospect, with where and when it came from.
create table facts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  organization_id uuid not null references organizations on delete cascade,
  contact_id uuid references contacts on delete cascade,
  field text not null,
  value jsonb not null,
  quote text, -- verbatim text from the source supporting the value
  source_url text,
  source_type fact_source_type not null,
  extracted_by fact_extractor not null,
  is_verified boolean not null default false, -- true only when quote was found verbatim in the source
  retrieved_at timestamptz not null default now()
);

create index facts_org on facts (organization_id, field);

alter table organizations
  add constraint organizations_team_size_fact_fk foreign key (team_size_fact_id) references facts on delete set null;
alter table contacts
  add constraint contacts_email_fact_fk foreign key (email_fact_id) references facts on delete set null;
alter table brokerages
  add constraint brokerages_licensee_fact_fk foreign key (licensee_count_fact_id) references facts on delete set null;

-- ---------------------------------------------------------------------------
-- Pipeline (one entry per organization per product)
-- ---------------------------------------------------------------------------

create type pipeline_stage as enum (
  'discovered', 'researched', 'qualified', 'disqualified', 'contact_ready',
  'drafted', 'approved', 'in_sequence', 'replied', 'interested',
  'demo_booked', 'trial', 'customer',
  'nurture', 'not_interested', 'unsubscribed', 'bounced', 'do_not_contact'
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  product_id uuid not null references products on delete cascade,
  name text not null,
  market jsonb not null default '{}'::jsonb, -- { state, counties[], cities[] }
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  daily_cap int not null default 40,
  created_at timestamptz not null default now()
);

create table sequence_steps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  campaign_id uuid not null references campaigns on delete cascade,
  step_number int not null,
  delay_days int not null default 0,
  kind text not null check (kind in ('first_touch', 'follow_up')),
  guidance text not null default '',
  unique (campaign_id, step_number)
);

create table pipeline_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  organization_id uuid not null references organizations on delete cascade,
  product_id uuid not null references products on delete cascade,
  campaign_id uuid references campaigns on delete set null,
  stage pipeline_stage not null default 'discovered',
  stage_changed_at timestamptz not null default now(),
  score int,
  fit_tier text check (fit_tier in ('A', 'B', 'C', 'D')),
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  disqualified_reason text,
  created_at timestamptz not null default now(),
  unique (organization_id, product_id)
);

create index pipeline_entries_stage on pipeline_entries (workspace_id, product_id, stage);

create table qualification_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  pipeline_entry_id uuid not null references pipeline_entries on delete cascade,
  score int not null,
  fit_tier text not null,
  -- [{ key, label, weight, score (0-1), basis: verified|inferred|unknown, evidence_fact_ids[], note }]
  criteria jsonb not null,
  explanation text not null,
  hypotheses jsonb not null default '[]'::jsonb, -- inferred pain points, never treated as facts
  model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Messaging (used from Phase 2/3)
-- ---------------------------------------------------------------------------

create type message_status as enum ('draft', 'approved', 'scheduled', 'sent', 'bounced', 'replied', 'cancelled', 'rejected');

create table messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  pipeline_entry_id uuid not null references pipeline_entries on delete cascade,
  contact_id uuid references contacts on delete set null,
  step_id uuid references sequence_steps on delete set null,
  status message_status not null default 'draft',
  subject text not null,
  body text not null,
  lint_issues jsonb not null default '[]'::jsonb,
  generated_by_model text,
  prompt_version text,
  approved_by uuid references auth.users,
  approved_at timestamptz,
  rejection_reason text,
  scheduled_for timestamptz,
  sent_at timestamptz,
  gmail_message_id text,
  gmail_thread_id text,
  created_at timestamptz not null default now()
);

create index messages_status on messages (workspace_id, status);

create table message_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  message_id uuid not null references messages on delete cascade,
  type text not null check (type in ('sent', 'bounce', 'reply', 'unsubscribe', 'complaint')),
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create table activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  organization_id uuid not null references organizations on delete cascade,
  contact_id uuid references contacts on delete set null,
  type text not null check (type in ('email_out', 'email_in', 'note', 'call', 'stage_change', 'demo', 'system')),
  summary text not null,
  occurred_at timestamptz not null default now(),
  user_id uuid references auth.users
);

create index activities_org on activities (organization_id, occurred_at desc);

-- Workspace-wide: an opt-out from one product suppresses all products.
create table suppressions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  email citext,
  domain citext,
  reason text not null check (reason in ('unsubscribe', 'bounce', 'complaint', 'manual', 'do_not_contact')),
  source text,
  created_at timestamptz not null default now(),
  check (email is not null or domain is not null),
  unique (workspace_id, email),
  unique (workspace_id, domain)
);

-- ---------------------------------------------------------------------------
-- Imports, discovery runs and background jobs
-- ---------------------------------------------------------------------------

create table imports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  file_name text not null,
  column_mapping jsonb not null,
  rows_total int not null default 0,
  rows_created int not null default 0,
  rows_merged int not null default 0,
  rows_flagged int not null default 0,
  created_by uuid references auth.users,
  created_at timestamptz not null default now()
);

create table discovery_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  product_id uuid not null references products on delete cascade,
  criteria jsonb not null, -- { state, county, city, org_types[], limit, notes }
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  candidates_found int not null default 0,
  candidates_created int not null default 0,
  candidates_skipped int not null default 0,
  error text,
  created_by uuid references auth.users,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces on delete cascade,
  type text not null check (type in ('discover', 'research', 'qualify')),
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index jobs_ready on jobs (status, run_after) where status = 'queued';

-- Claim up to n ready jobs atomically; stale 'running' jobs (crashed worker) are retried.
create or replace function claim_jobs(n int)
returns setof jobs
language sql
as $$
  update jobs set status = 'running', locked_at = now(), attempts = attempts + 1
  where id in (
    select id from jobs
    where (status = 'queued' and run_after <= now())
       or (status = 'running' and locked_at < now() - interval '10 minutes')
    order by created_at
    limit n
    for update skip locked
  )
  returning *;
$$;

-- Possible duplicates: similar names in the same city, for manual review.
create or replace function possible_duplicates(ws uuid, min_similarity real default 0.6)
returns table (a_id uuid, a_name text, b_id uuid, b_name text, city text, similarity real)
language sql
stable
as $$
  select a.id, a.name, b.id, b.name, a.city, similarity(a.name, b.name)
  from organizations a
  join organizations b
    on a.workspace_id = b.workspace_id
   and a.id < b.id
   and coalesce(lower(a.city), '') = coalesce(lower(b.city), '')
   and similarity(a.name, b.name) >= min_similarity
  where a.workspace_id = ws and is_workspace_member(ws)
  order by 6 desc
  limit 200;
$$;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_touch before update on organizations
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security: members of a workspace can read and write its rows.
-- Background jobs use the service role, which bypasses RLS.
-- ---------------------------------------------------------------------------

alter table workspaces enable row level security;
create policy workspaces_member on workspaces for all to authenticated
  using (is_workspace_member(id)) with check (is_workspace_member(id));

alter table workspace_members enable row level security;
create policy workspace_members_self on workspace_members for select to authenticated
  using (user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array[
    'products', 'brokerages', 'organizations', 'contacts', 'facts', 'campaigns',
    'sequence_steps', 'pipeline_entries', 'qualification_runs', 'messages',
    'message_events', 'activities', 'suppressions', 'imports', 'discovery_runs', 'jobs'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy %I on %I for all to authenticated using (is_workspace_member(workspace_id)) with check (is_workspace_member(workspace_id))',
      t || '_member', t
    );
  end loop;
end $$;

revoke execute on function claim_jobs(int) from public, anon, authenticated;

grant execute on function claim_jobs(int) to service_role;
