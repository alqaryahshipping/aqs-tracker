-- AQS Tracker relational schema, step 3: write functions used by the new sb-adapter.js (spec §4).
-- SECURITY INVOKER: every write runs under the caller's RLS (staff vs Owner, rates Owner-only).

-- A carrier `set` that omits noshows must not fail.
alter table public.carriers alter column noshows drop not null;

-- rec_write: one record. p_replace = true  -> `set` (whole record replaced; missing known fields become null)
--                        p_replace = false -> `update` (only the given fields; unknown fields merge into extra)
-- Known fields go to their columns with type checks and clear messages; unknown fields go to `extra`.
-- carriers: a `drivers` array replaces that carrier's rows in carrier_drivers.
create or replace function public.rec_write(p_table text, p_id text, p_data jsonb, p_replace boolean default false)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  keycol text; typ text; k text; v jsonb; s text; n integer; setlist text; drivers jsonb;
  known jsonb := '{}'::jsonb; unk jsonb := '{}'::jsonb; unk_del text[] := '{}';
begin
  keycol := case p_table
    when 'vehicles' then 'vin' when 'containers' then 'container' when 'pickups' then 'pid'
    when 'customers' then 'id' when 'voyages' then 'id' when 'declarations' then 'id'
    when 'carriers' then 'id' when 'rates' then 'id' end;
  if keycol is null then raise exception 'Unsupported table: %', p_table using errcode = '22023'; end if;
  if coalesce(btrim(p_id), '') = '' then raise exception 'Missing record ID' using errcode = '22023'; end if;
  p_data := coalesce(p_data, '{}'::jsonb);
  if p_table = 'carriers' and p_data ? 'drivers' then drivers := p_data->'drivers'; end if;

  for k, v in select e.key, e.value from jsonb_each(p_data - 'id' - keycol - 'drivers' - 'updatedAt') e loop
    if k = 'createdAt' then
      begin known := known || jsonb_build_object('created_at', (v #>> '{}')::timestamptz); exception when others then null; end;
      continue;
    end if;
    select data_type::text into typ from information_schema.columns
      where table_schema = 'public' and table_name = p_table and column_name = k
        and column_name not in ('extra','created_at','updated_at','created_by','updated_by');
    if typ is null then                                   -- not a column: lives in extra
      if jsonb_typeof(v) = 'null' then unk_del := unk_del || k; else unk := unk || jsonb_build_object(k, v); end if;
      continue;
    end if;
    if jsonb_typeof(v) = 'null' or (jsonb_typeof(v) = 'string' and btrim(v #>> '{}') = '') then
      known := known || jsonb_build_object(k, null); continue;
    end if;
    if jsonb_typeof(v) in ('object','array') then
      raise exception '% has a value that is not allowed', k using errcode = '22023';
    end if;
    s := btrim(v #>> '{}');
    if typ = 'date' then
      if s ~ '^\d{4}-\d{2}-\d{2}T' then s := left(s, 10); end if;
      begin
        if s !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'bad'; end if;
        perform s::date;
      exception when others then
        raise exception '% is not a valid date: %', k, s using errcode = '22007';
      end;
    elsif typ in ('numeric','integer') then
      begin
        perform s::numeric;
        if typ = 'integer' and s::numeric <> trunc(s::numeric) then raise exception 'bad'; end if;
      exception when others then
        raise exception '% is not a valid number: %', k, s using errcode = '22P02';
      end;
    end if;
    known := known || jsonb_build_object(k, s);
    typ := null;
  end loop;

  if p_replace then
    select string_agg(format('%I = excluded.%I', column_name, column_name), ', ') into setlist
      from information_schema.columns
      where table_schema = 'public' and table_name = p_table
        and column_name not in (keycol, 'created_at', 'created_by', 'updated_at', 'updated_by');
    execute format('insert into public.%I as t select * from jsonb_populate_record(null::public.%I, $1) on conflict (%I) do update set %s',
                   p_table, p_table, keycol, setlist)
      using known || jsonb_build_object(keycol, p_id, 'extra', unk);
  else
    select string_agg(format('%I = r.%I', x.f, x.f), ', ') into setlist from jsonb_object_keys(known - 'created_at') as x(f);
    setlist := coalesce(setlist || ', ', '') || 'extra = (t.extra || $2) - $3';
    execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.%I = $4',
                   p_table, setlist, p_table, keycol)
      using known, unk, unk_del, p_id;
    get diagnostics n = row_count;
    if n = 0 then raise exception 'not_found: %', p_id using errcode = 'P0002'; end if;
  end if;

  if drivers is not null then
    delete from public.carrier_drivers where carrier_id = p_id;
    insert into public.carrier_drivers (carrier_id, pos, name, phone, extra)
    select p_id, x.ord - 1, coalesce(x.e->>'name', ''), nullif(btrim(x.e->>'phone'), ''), x.e - 'name' - 'phone'
    from jsonb_array_elements(case when jsonb_typeof(drivers) = 'array' then drivers else '[]'::jsonb end) with ordinality x(e, ord)
    where jsonb_typeof(x.e) = 'object';
  end if;
end $$;

-- rec_bulk_set: many `set`s in one call (backup restore). p_rows = [{id, data}, ...]. All or nothing per call.
create or replace function public.rec_bulk_set(p_table text, p_rows jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare e jsonb; n integer := 0;
begin
  for e in select value from jsonb_array_elements(p_rows) loop
    perform public.rec_write(p_table, e->>'id', e->'data', true);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.rec_write(text, text, jsonb, boolean), public.rec_bulk_set(text, jsonb) from public, anon;
grant execute on function public.rec_write(text, text, jsonb, boolean), public.rec_bulk_set(text, jsonb) to authenticated;
