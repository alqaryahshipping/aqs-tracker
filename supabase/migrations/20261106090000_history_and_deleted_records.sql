-- Record history + Deleted records (requested by Idres, 5 Nov 2026). Additive: read/restore functions only.
-- The delete-permission change for Staff is in a separate migration, applied at go-live.

-- History of one record: every add / change / delete with the person's name and time.
-- Carrier driver rows are rewritten on every carrier save, so they are collapsed into one
-- "drivers: old list -> new list" entry per save and skipped when the list did not change.
create or replace function public.record_history(p_table text, p_id text)
returns table (at timestamptz, action text, who text, changes jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_active_user() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_table = 'rates' and not app_private.is_owner() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_table not in ('vehicles','containers','voyages','customers','carriers','pickups','declarations','rates') then
    raise exception 'Unsupported table: %', p_table using errcode = '22023';
  end if;
  return query
  select x.at, x.action, x.who, x.changes from (
    select a.at, a.action,
           coalesce(p.name, case when a.user_id is null then 'System' else 'Former user' end) as who,
           a.changes, a.id::numeric as ord
    from public.audit_log a left join public.profiles p on p.user_id = a.user_id
    where a.table_name = p_table and a.record_id = p_id
    union all
    select d.at, 'update',
           coalesce(p.name, case when d.user_id is null then 'System' else 'Former user' end),
           jsonb_build_object('drivers', jsonb_build_array(d.old_list, d.new_list)), d.ord
    from (
      select a.at, a.user_id, max(a.id)::numeric + 0.5 as ord,
        coalesce(string_agg(case when a.action = 'delete' then (a.changes->>'name') || coalesce(' (' || nullif(a.changes->>'phone','') || ')', '') end, ', ' order by (a.changes->>'pos')::int), '') as old_list,
        coalesce(string_agg(case when a.action = 'insert' then (a.changes->>'name') || coalesce(' (' || nullif(a.changes->>'phone','') || ')', '') end, ', ' order by (a.changes->>'pos')::int), '') as new_list
      from public.audit_log a
      where p_table = 'carriers' and a.table_name = 'carrier_drivers' and a.record_id = p_id
      group by a.at, a.user_id
    ) d left join public.profiles p on p.user_id = d.user_id
    where d.old_list is distinct from d.new_list
  ) x
  order by x.ord desc
  limit 300;
end $$;

-- Deleted records (Owners): who deleted what, when, the record as it was, and whether it was restored since.
create or replace function public.deleted_records(p_limit integer default 500)
returns table (audit_id bigint, at timestamptz, table_name text, record_id text, who text, record jsonb,
               restored_at timestamptz, restored_by text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_owner() then raise exception 'permission denied' using errcode = '42501'; end if;
  return query
  select a.id, a.at, a.table_name, a.record_id,
         coalesce(p.name, case when a.user_id is null then 'System' else 'Former user' end),
         a.changes, r.at, coalesce(rp.name, case when r.at is not null and r.user_id is null then 'System' end)
  from public.audit_log a
  left join public.profiles p on p.user_id = a.user_id
  left join lateral (
    select a2.at, a2.user_id from public.audit_log a2
    where a2.table_name = a.table_name and a2.record_id = a.record_id and a2.action = 'insert' and a2.id > a.id
    order by a2.id limit 1) r on true
  left join public.profiles rp on rp.user_id = r.user_id
  where a.action = 'delete'
    and a.table_name in ('vehicles','containers','voyages','customers','carriers','pickups','declarations','rates')
  order by a.id desc
  limit greatest(1, least(coalesce(p_limit, 500), 2000));
end $$;

-- Restore one deleted record (Owners). Runs with the caller's rights, so all database rules still apply
-- (e.g. a car whose customer was deleted too is refused with a clear message). Carriers get their drivers back.
create or replace function public.restore_deleted(p_audit_id bigint)
returns text
language plpgsql security invoker set search_path = '' as $$
declare a record; keycol text; exists_now boolean; n integer;
begin
  if not app_private.is_owner() then raise exception 'Only an Owner can restore records.' using errcode = '42501'; end if;
  select * into a from public.audit_log where id = p_audit_id and action = 'delete';
  if not found then raise exception 'This deletion was not found.' using errcode = 'P0002'; end if;
  keycol := case a.table_name when 'vehicles' then 'vin' when 'containers' then 'container' when 'pickups' then 'pid' else 'id' end;
  execute format('select exists (select 1 from public.%I where %I = $1)', a.table_name, keycol) into exists_now using a.record_id;
  if exists_now then
    raise exception '% is already in the tracker (restored or added again).', a.record_id using errcode = '23505';
  end if;
  execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', a.table_name, a.table_name)
    using (a.changes - 'updated_by') || jsonb_build_object('updated_at', now());
  if a.table_name = 'carriers' then
    insert into public.carrier_drivers (carrier_id, pos, name, phone, extra)
    select a.record_id, coalesce((d.changes->>'pos')::int, 0), coalesce(d.changes->>'name', ''), d.changes->>'phone',
           coalesce(d.changes->'extra', '{}'::jsonb)
    from public.audit_log d
    where d.table_name = 'carrier_drivers' and d.record_id = a.record_id and d.action = 'delete' and d.at = a.at;
    get diagnostics n = row_count;
  end if;
  return a.record_id;
end $$;

revoke all on function public.record_history(text, text), public.deleted_records(integer), public.restore_deleted(bigint) from public, anon;
grant execute on function public.record_history(text, text), public.deleted_records(integer), public.restore_deleted(bigint) to authenticated;
