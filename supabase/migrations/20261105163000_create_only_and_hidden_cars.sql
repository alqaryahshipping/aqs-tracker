-- 5 Nov 2026 fix: "add new" can no longer overwrite an existing record.
-- rec_write gains p_create (default false). The adapter's set() on business tables passes p_create = true;
-- backup restore (rec_bulk_set) still replaces. Old 4-argument signature is replaced in the same transaction.
drop function if exists public.rec_write(text, text, jsonb, boolean);

create or replace function public.rec_write(p_table text, p_id text, p_data jsonb, p_replace boolean default false, p_create boolean default false)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  keycol text; typ text; k text; v jsonb; s text; n integer; setlist text; drivers jsonb;
  known jsonb := '{}'::jsonb; unk jsonb := '{}'::jsonb; unk_del text[] := '{}'; found_existing boolean;
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

  -- p_create: the app is adding a NEW record. Never overwrite an existing one (5 Nov 2026 incident:
  -- cars hidden from the list were re-added in bulk and silently replaced).
  if p_create then
    execute format('select exists (select 1 from public.%I where %I = $1)', p_table, keycol) into found_existing using p_id;
    if found_existing then
      raise exception '% % already exists in the tracker. Search for it and edit that record instead.',
        case p_table when 'vehicles' then 'VIN' when 'containers' then 'Container' else initcap(rtrim(p_table, 's')) end, p_id
        using errcode = '23505';
    end if;
  end if;

  if p_replace or p_create then
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


revoke all on function public.rec_write(text, text, jsonb, boolean, boolean) from public, anon;
grant execute on function public.rec_write(text, text, jsonb, boolean, boolean) to authenticated;
