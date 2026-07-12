-- ===========================================================================
-- Business Apps — Supabase cloud schema for multi-device sync
-- ===========================================================================
-- Run this ONCE in your Supabase project: Dashboard -> SQL Editor -> New query
-- -> paste -> Run. It is safe to re-run (idempotent).
--
-- The whole sync transport is a SINGLE table. Each row is one local record from
-- any device, stored as a JSON payload and keyed by (business_id, table_name,
-- uuid). The app never queries these relationally in the cloud — Supabase is
-- purely the shared "meeting point" that devices push to and pull from.
--
-- Security model: the app ships with the PUBLIC anon/publishable key and no
-- login, so the policies below grant the `anon` role read/insert/update on this
-- one table only. Anyone with the app + project URL can reach the data; this is
-- the accepted tradeoff for private, own-device distribution (see
-- docs/sync-design.md). There is deliberately no DELETE policy — deletions are
-- represented by setting `deleted_at`, never by removing cloud rows, so lagging
-- devices still receive the tombstone.
-- ===========================================================================

create table if not exists public.sync_rows (
  business_id text        not null,          -- 'laundry' | 'cleaning'
  table_name  text        not null,          -- source local table
  uuid        text        not null,          -- the row's cross-device key
  updated_at  timestamptz not null default now(), -- SERVER clock (authority)
  deleted_at  timestamptz,                    -- set => the row was deleted
  data        jsonb,                          -- { cols: {...}, refs: {...} }
  primary key (business_id, table_name, uuid)
);

-- Pull queries filter by business_id and "changed since" -> index that path.
create index if not exists idx_sync_rows_business_updated
  on public.sync_rows (business_id, updated_at);

-- ---------------------------------------------------------------------------
-- Server-authoritative updated_at: stamp now() on every insert AND update, so
-- the high-water mark devices pull against is driven by the server clock and is
-- immune to device clock skew. Clients send a placeholder updated_at; this
-- overwrites it.
-- ---------------------------------------------------------------------------
create or replace function public.sync_rows_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_sync_rows_updated_at on public.sync_rows;
create trigger trg_sync_rows_updated_at
  before insert or update on public.sync_rows
  for each row execute function public.sync_rows_set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security: enabled, with explicit anon policies scoped to this
-- table. anon may read, insert, and update — but not delete.
-- ---------------------------------------------------------------------------
alter table public.sync_rows enable row level security;

drop policy if exists sync_rows_anon_select on public.sync_rows;
create policy sync_rows_anon_select
  on public.sync_rows for select
  to anon
  using (true);

drop policy if exists sync_rows_anon_insert on public.sync_rows;
create policy sync_rows_anon_insert
  on public.sync_rows for insert
  to anon
  with check (true);

drop policy if exists sync_rows_anon_update on public.sync_rows;
create policy sync_rows_anon_update
  on public.sync_rows for update
  to anon
  using (true)
  with check (true);

-- Done. Verify with:
--   select count(*) from public.sync_rows;
