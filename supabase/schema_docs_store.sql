-- Current Supabase schema (project aqs-tracker, ref tkqfqoldatouwxktglqt) as applied 5 Nov 2026.
-- Applied migrations: tracker_core, role_helpers_private_nondestructive.
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null, name text,
  role text not null default 'staff' check (role in ('owner','staff')),
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.docs (
  collection text not null, id text not null, data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(), updated_by uuid default auth.uid(),
  primary key (collection, id)
);
-- RLS on both. Role helpers: app_private.is_active_user(), app_private.is_owner() (security definer).
-- docs: select/insert/update = active user (rates: owner; 'user:<uid>' collections: own only); delete = owner.
-- profiles: select own or active user; update owner only.
-- Trigger docs_touch sets updated_at/updated_by. RPC public.doc_update(collection, id, patch jsonb) merges fields.
-- Realtime publication includes public.docs.
-- Old public.is_active_user()/is_owner() exist but EXECUTE revoked (unused).
