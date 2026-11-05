-- AQS Tracker relational schema, step 2: copy public.docs into the typed tables (spec §5).
-- Re-runnable: app_private.copy_from_docs() empties the new tables and copies everything again.
-- Values that don't fit a column (bad date, non-number, unknown customer...) are NOT dropped:
-- the column is left null, the original value stays in `extra`, and a row goes to migration_exceptions.

create or replace function app_private.copy_one(p_coll text, p_tbl text, p_key text)
returns integer language plpgsql set search_path = '' as $$
declare
  r record; c record; d jsonb; rowj jsonb; extra jsonb; v jsonb; s text; ok boolean; n integer := 0;
  fk_tbl text; fk_col text;
begin
  for r in select id, data from public.docs where collection = p_coll order by id loop
    d := r.data; extra := d - 'id' - 'createdAt' - 'updatedAt';
    rowj := jsonb_build_object(p_key, r.id);
    extra := extra - p_key;
    if p_coll = 'carriers' then extra := extra - 'drivers'; end if;

    for c in
      select column_name::text as col, data_type::text as typ
      from information_schema.columns
      where table_schema = 'public' and table_name = p_tbl
        and column_name not in ('extra','created_at','updated_at','created_by','updated_by')
        and column_name <> p_key
    loop
      v := d -> c.col;
      if v is null then continue; end if;
      if jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '') then
        extra := extra - c.col; continue;
      end if;
      if jsonb_typeof(v) in ('object','array') then
        insert into public.migration_exceptions (collection, record_id, field, value, problem)
          values (p_coll, r.id, c.col, v::text, 'object/array where a ' || c.typ || ' is expected');
        continue;
      end if;
      s := btrim(v #>> '{}'); ok := true;
      begin
        if c.typ = 'date' then
          if s !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'format'; end if;
          perform s::date;
        elsif c.typ in ('numeric','integer') then
          perform s::numeric;
          if c.typ = 'integer' and s::numeric <> trunc(s::numeric) then raise exception 'fraction'; end if;
        end if;
      exception when others then
        ok := false;
        insert into public.migration_exceptions (collection, record_id, field, value, problem)
          values (p_coll, r.id, c.col, s, 'not a valid ' || c.typ);
      end;
      if not ok then continue; end if;

      -- references: unknown parent -> null + exception (row is never dropped)
      fk_tbl := case c.col when 'customer_id' then 'customers' when 'voyage_id' then 'voyages'
                           when 'decl' then 'declarations' when 'container' then case when p_tbl = 'vehicles' then 'containers' end end;
      if fk_tbl is not null then
        fk_col := case fk_tbl when 'containers' then 'container' else 'id' end;
        execute format('select exists (select 1 from public.%I where %I = $1)', fk_tbl, fk_col) into ok using s;
        if not ok then
          insert into public.migration_exceptions (collection, record_id, field, value, problem)
            values (p_coll, r.id, c.col, s, 'unknown ' || fk_tbl);
          continue;
        end if;
      end if;

      rowj := rowj || jsonb_build_object(c.col, s);
      extra := extra - c.col;
    end loop;

    -- keep the app's own timestamps
    begin rowj := rowj || jsonb_build_object('created_at', (d->>'createdAt')::timestamptz); exception when others then null; end;
    begin rowj := rowj || jsonb_build_object('updated_at', (d->>'updatedAt')::timestamptz); exception when others then null; end;
    if p_tbl = 'carriers' and not rowj ? 'noshows' then rowj := rowj || '{"noshows":0}'; end if;
    rowj := rowj || jsonb_build_object('extra', extra);

    execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', p_tbl, p_tbl) using rowj;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function app_private.copy_from_docs()
returns jsonb language plpgsql set search_path = '' as $$
declare res jsonb := '{}'::jsonb; n integer;
begin
  perform set_config('app.migrating', 'on', true);   -- no audit rows for the copy itself
  truncate public.vehicles, public.containers, public.declarations, public.voyages, public.customers,
           public.carrier_drivers, public.carriers, public.pickups, public.rates, public.app_settings,
           public.user_data, public.migration_exceptions;

  res := res || jsonb_build_object('customers',    app_private.copy_one('customers',    'customers',    'id'));
  res := res || jsonb_build_object('voyages',      app_private.copy_one('voyages',      'voyages',      'id'));
  res := res || jsonb_build_object('declarations', app_private.copy_one('declarations', 'declarations', 'id'));
  res := res || jsonb_build_object('pickups',      app_private.copy_one('pickups',      'pickups',      'pid'));
  res := res || jsonb_build_object('carriers',     app_private.copy_one('carriers',     'carriers',     'id'));
  res := res || jsonb_build_object('containers',   app_private.copy_one('containers',   'containers',   'container'));
  res := res || jsonb_build_object('vehicles',     app_private.copy_one('vehicles',     'vehicles',     'vin'));
  res := res || jsonb_build_object('rates',        app_private.copy_one('rates',        'rates',        'id'));

  -- drivers: carriers.drivers array -> carrier_drivers rows (array order kept in pos)
  insert into public.carrier_drivers (carrier_id, pos, name, phone, extra)
  select d.id, x.ord - 1,
         coalesce(nullif(btrim(x.e->>'name'), ''), '(no name)'),
         nullif(btrim(x.e->>'phone'), ''),
         x.e - 'name' - 'phone'
  from public.docs d, jsonb_array_elements(case when jsonb_typeof(d.data->'drivers') = 'array' then d.data->'drivers' else '[]'::jsonb end) with ordinality x(e, ord)
  where d.collection = 'carriers';
  get diagnostics n = row_count; res := res || jsonb_build_object('carrier_drivers', n);
  insert into public.migration_exceptions (collection, record_id, field, value, problem)
  select 'carriers', carrier_id, 'drivers.name', null, 'driver without a name' from public.carrier_drivers where name = '(no name)';

  -- settings/<key> -> app_settings; user:<uid>/<key> -> user_data
  insert into public.app_settings (key, value) select id, data from public.docs where collection = 'settings';
  get diagnostics n = row_count; res := res || jsonb_build_object('app_settings', n);
  insert into public.user_data (user_id, key, value)
  select substr(collection, 6)::uuid, id, data from public.docs
  where collection like 'user:%' and substr(collection, 6) ~ '^[0-9a-f-]{36}$'
    and exists (select 1 from auth.users u where u.id = substr(collection, 6)::uuid);
  get diagnostics n = row_count; res := res || jsonb_build_object('user_data', n);

  select count(*) into n from public.migration_exceptions; res := res || jsonb_build_object('exceptions', n);
  return res;
end $$;

revoke all on function app_private.copy_one(text, text, text), app_private.copy_from_docs() from public, anon, authenticated;
