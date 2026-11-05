-- Switch to the relational tables (5 Nov 2026, approved by Idres): public.docs becomes a read-only
-- rollback copy, kept 30 days. Rollback: grant insert, update, delete on public.docs to authenticated;
-- grant execute on function public.doc_update(text, text, jsonb) to authenticated; redeploy the old sb-adapter.js.
revoke insert, update, delete on public.docs from authenticated, anon;
revoke execute on function public.doc_update(text, text, jsonb) from authenticated, anon;
