-- Idres, 5 Nov 2026: anyone (active Owner or Staff) may delete records; every deletion is logged and an
-- Owner can restore it from Settings > Deleted records. Rates stay Owner-only for everything.
-- APPLY AT GO-LIVE of the history / deleted-records release (together with the app that shows Delete to Staff).
do $$
declare t text;
begin
  foreach t in array array['customers','voyages','declarations','containers','vehicles','pickups','carriers'] loop
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select app_private.is_active_user()))', t || '_delete', t);
  end loop;
end $$;
