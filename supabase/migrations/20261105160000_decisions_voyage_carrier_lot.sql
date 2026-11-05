-- Idres's decisions, 5 Nov 2026:
--  * Voyage duplicate = same vessel + same voyage no. (spaces, dashes, dots, case ignored). A new voyage, or an
--    edit that changes vessel/voyage no. into an existing pair, is refused; the app suggests the existing record.
--    Existing pairs GAIRLOCH 634N, HARTFORD 635E, VIRGINIA 648N are NOT duplicates: kept as exceptions (dup_ok).
--  * CMA CGM VITORIA MO20D0E19: keep VY026, move VYMVZQR0GOBPL's containers to it, delete VYMVZQR0GOBPL.
--  * GOLDEN CARRIER INC: keep GOLDEN-CARRIER-INC-mw2lauyv, delete the identical copy; carrier names unique.
--  * Lot # (tw_lot) unique across all cars; empty allowed.

create or replace function app_private.voy_key(p_vessel text, p_no text) returns text
language sql immutable set search_path = '' as $$
  select case when coalesce(btrim(p_vessel), '') = '' or coalesce(btrim(p_no), '') = '' then null
    else upper(regexp_replace(p_vessel, '[\s\-_./]', '', 'g')) || '|' || upper(regexp_replace(p_no, '[\s\-_./]', '', 'g')) end
$$;

create or replace function app_private.voyage_dup_check() returns trigger
language plpgsql set search_path = '' as $$
declare k text := app_private.voy_key(new.vessel, new.voyage_no); other record;
begin
  if coalesce(current_setting('app.migrating', true), '') = 'on' or k is null then return new; end if;
  if tg_op = 'UPDATE' and k is not distinct from app_private.voy_key(old.vessel, old.voyage_no) then return new; end if;
  select id, vessel, voyage_no, etd, pod into other from public.voyages
    where id <> new.id and app_private.voy_key(vessel, voyage_no) = k limit 1;
  if found then
    raise exception 'Voyage % % already exists (%, ETD %, %). Pick it instead of creating a duplicate.',
      other.vessel, other.voyage_no, other.id, coalesce(other.etd::text, '?'), coalesce(other.pod, '?') using errcode = '23505';
  end if;
  return new;
end $$;
create trigger voyages_dup_check before insert or update of vessel, voyage_no on public.voyages
  for each row execute function app_private.voyage_dup_check();
create index voyages_key_idx on public.voyages (app_private.voy_key(vessel, voyage_no));

-- applied after every copy from docs (trial runs and the real switch)
create or replace function app_private.apply_decisions() returns jsonb
language plpgsql set search_path = '' as $$
declare res jsonb := '{}'::jsonb; n integer;
begin
  update public.containers set voyage_id = 'VY026' where voyage_id = 'VYMVZQR0GOBPL';
  get diagnostics n = row_count; res := res || jsonb_build_object('containers_moved_to_VY026', n);
  delete from public.voyages where id = 'VYMVZQR0GOBPL';
  get diagnostics n = row_count; res := res || jsonb_build_object('voyage_deleted', n);
  update public.voyages set extra = extra || '{"dup_ok":"Yes"}'::jsonb
    where id in ('VY042','VY049','VYMVZON6XTT0Z','VYMVZOR8G8CC4','VY044','VY048');
  get diagnostics n = row_count; res := res || jsonb_build_object('voyages_marked_not_duplicate', n);
  delete from public.carriers where id = 'GOLDEN-CARRIER-INC-mw2lav6a'
    and exists (select 1 from public.carriers where id = 'GOLDEN-CARRIER-INC-mw2lauyv');
  get diagnostics n = row_count; res := res || jsonb_build_object('carrier_copy_deleted', n);
  return res;
end $$;

-- copy_from_docs: drop the unique rules, copy, apply the decisions, re-create the rules
create or replace function app_private.copy_from_docs_with_decisions() returns jsonb
language plpgsql set search_path = '' as $$
declare res jsonb;
begin
  drop index if exists public.carriers_name_uq;
  drop index if exists public.vehicles_lot_uq;
  res := app_private.copy_from_docs();
  perform set_config('app.migrating', 'on', true);
  res := res || jsonb_build_object('decisions', app_private.apply_decisions());
  create unique index carriers_name_uq on public.carriers (lower(btrim(name)));
  create unique index vehicles_lot_uq on public.vehicles (upper(btrim(tw_lot))) where nullif(btrim(tw_lot), '') is not null;
  return res;
end $$;
revoke all on function app_private.apply_decisions(), app_private.copy_from_docs_with_decisions(), app_private.voyage_dup_check() from public, anon, authenticated;
