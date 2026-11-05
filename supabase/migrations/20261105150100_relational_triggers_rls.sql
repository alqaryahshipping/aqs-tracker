-- AQS Tracker relational schema, step 1b: stamp + audit triggers, RLS, realtime (spec §3.6).

-- ---------- stamp trigger: who/when ----------
-- Insert keeps a supplied created_at/updated_at (so the data move preserves history), otherwise now().
-- Update always stamps now() and the current user.
create or replace function app_private.stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, new.created_at);
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := coalesce(new.updated_by, auth.uid());
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

-- ---------- audit trigger ----------
-- tg_argv[0] = key column. Skipped while app.migrating = 'on' (data move only).
create or replace function app_private.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o jsonb; n jsonb; diff jsonb := '{}'::jsonb; k text;
begin
  if coalesce(current_setting('app.migrating', true), '') = 'on' then return null; end if;
  if tg_op = 'INSERT' then
    n := to_jsonb(new);
    insert into public.audit_log (table_name, record_id, action, changes) values (tg_table_name, n->>tg_argv[0], 'insert', n);
  elsif tg_op = 'DELETE' then
    o := to_jsonb(old);
    insert into public.audit_log (table_name, record_id, action, changes) values (tg_table_name, o->>tg_argv[0], 'delete', o);
  else
    o := to_jsonb(old); n := to_jsonb(new);
    for k in select jsonb_object_keys(n) loop
      if k not in ('updated_at','updated_by') and (o->k) is distinct from (n->k) then
        diff := diff || jsonb_build_object(k, jsonb_build_array(o->k, n->k));
      end if;
    end loop;
    if diff <> '{}'::jsonb then
      insert into public.audit_log (table_name, record_id, action, changes) values (tg_table_name, n->>tg_argv[0], 'update', diff);
    end if;
  end if;
  return null;
end $$;
revoke all on function app_private.audit() from public, anon, authenticated;

-- ---------- attach triggers + RLS to the business tables ----------
do $$
declare
  t record;
begin
  for t in select * from (values
    ('customers','id'), ('voyages','id'), ('declarations','id'), ('containers','container'),
    ('vehicles','vin'), ('pickups','pid'), ('carriers','id'), ('rates','id')
  ) as x(tbl, keycol) loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function app_private.stamp()', t.tbl || '_stamp', t.tbl);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function app_private.audit(%L)', t.tbl || '_audit', t.tbl, t.keycol);
    execute format('alter table public.%I enable row level security', t.tbl);
    if t.tbl = 'rates' then
      execute 'create policy rates_all on public.rates for all to authenticated using ((select app_private.is_owner())) with check ((select app_private.is_owner()))';
    else
      execute format('create policy %I on public.%I for select to authenticated using ((select app_private.is_active_user()))', t.tbl || '_select', t.tbl);
      execute format('create policy %I on public.%I for insert to authenticated with check ((select app_private.is_active_user()))', t.tbl || '_insert', t.tbl);
      execute format('create policy %I on public.%I for update to authenticated using ((select app_private.is_active_user())) with check ((select app_private.is_active_user()))', t.tbl || '_update', t.tbl);
      execute format('create policy %I on public.%I for delete to authenticated using ((select app_private.is_owner()))', t.tbl || '_delete', t.tbl);
    end if;
  end loop;
end $$;

-- carrier_drivers: rows are replaced with the carrier, so staff may delete them (the carrier itself is Owner-delete).
create trigger carrier_drivers_audit after insert or update or delete on public.carrier_drivers
  for each row execute function app_private.audit('carrier_id');
alter table public.carrier_drivers enable row level security;
create policy carrier_drivers_select on public.carrier_drivers for select to authenticated using ((select app_private.is_active_user()));
create policy carrier_drivers_insert on public.carrier_drivers for insert to authenticated with check ((select app_private.is_active_user()));
create policy carrier_drivers_update on public.carrier_drivers for update to authenticated using ((select app_private.is_active_user())) with check ((select app_private.is_active_user()));
create policy carrier_drivers_delete on public.carrier_drivers for delete to authenticated using ((select app_private.is_active_user()));

-- ---------- app_settings: active staff read + write, Owner delete ----------
create or replace function app_private.stamp_settings() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
create trigger app_settings_stamp before update on public.app_settings for each row execute function app_private.stamp_settings();
create trigger app_settings_audit after insert or update or delete on public.app_settings for each row execute function app_private.audit('key');
alter table public.app_settings enable row level security;
create policy app_settings_select on public.app_settings for select to authenticated using ((select app_private.is_active_user()));
create policy app_settings_insert on public.app_settings for insert to authenticated with check ((select app_private.is_active_user()));
create policy app_settings_update on public.app_settings for update to authenticated using ((select app_private.is_active_user())) with check ((select app_private.is_active_user()));
create policy app_settings_delete on public.app_settings for delete to authenticated using ((select app_private.is_owner()));

-- ---------- user_data: private to its user ----------
alter table public.user_data enable row level security;
create policy user_data_own on public.user_data for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------- audit_log: read-only for clients; rates history Owner-only ----------
alter table public.audit_log enable row level security;
create policy audit_log_select on public.audit_log for select to authenticated using (
  case when table_name = 'rates' then (select app_private.is_owner()) else (select app_private.is_active_user()) end);
revoke insert, update, delete on public.audit_log from anon, authenticated;

-- ---------- migration_exceptions: Owner read only ----------
alter table public.migration_exceptions enable row level security;
create policy migration_exceptions_select on public.migration_exceptions for select to authenticated using ((select app_private.is_owner()));
revoke insert, update, delete on public.migration_exceptions from anon, authenticated;

-- ---------- no anonymous access to any new table ----------
revoke all on public.audit_log, public.migration_exceptions, public.app_settings, public.user_data,
  public.customers, public.voyages, public.declarations, public.containers, public.vehicles,
  public.pickups, public.carriers, public.carrier_drivers, public.rates from anon;

-- ---------- realtime ----------
alter publication supabase_realtime add table
  public.customers, public.voyages, public.declarations, public.containers, public.vehicles,
  public.pickups, public.carriers, public.carrier_drivers, public.rates, public.app_settings, public.user_data;
