-- Containers: third load type "Group" (Idres, 5 Nov 2026): cars of group (internal) companies,
-- consignee can be any group company. APPLY AT GO-LIVE together with the app change.
alter table public.containers drop constraint if exists containers_load_check;
alter table public.containers add constraint containers_load_check check (load in ('Full','Mix','Group') or load is null);
