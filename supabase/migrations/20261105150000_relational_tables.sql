-- AQS Tracker relational schema, step 1a: tables (spec: docs/AQS_Tracker_Relational_DB_Spec.md §3).
-- Built side by side with public.docs; the app keeps using docs until the adapter switch.
-- Deferred until Idres decides [TBC]: unique voyage (line + voyage no.), unique Lot #, unique carrier name.

-- ---------- shared ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('insert','update','delete')),
  changes jsonb               -- update: {field: [old, new]}; insert: new row; delete: old row
);
create index audit_log_record_idx on public.audit_log (table_name, record_id, at desc);
create index audit_log_at_idx on public.audit_log (at desc);

create table public.migration_exceptions (
  id bigint generated always as identity primary key,
  collection text, record_id text, field text, value text, problem text,
  at timestamptz not null default now()
);

create table public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table public.user_data (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- ---------- customers ----------
create table public.customers (
  id text primary key,                       -- CU001; CU000 = Unassigned (system)
  name text not null,
  contact text, phone text, email text, city text, notes text,
  internal text check (internal in ('Yes','No') or internal is null),
  top text check (top in ('Yes','No') or top is null),
  system text,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid
);
create unique index customers_name_ci on public.customers (lower(btrim(name)));

-- ---------- voyages, declarations, containers ----------
create table public.voyages (
  id text primary key,
  line text, vessel text, voyage_no text, origin text, pod text,
  etd date, eta date,
  status text not null check (status in ('Planned','Sailed','Arrived')),  -- = VOY_STATUS in index.html
  notes text,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid
);

create table public.declarations (
  id text primary key,
  no text not null, date date, status text, port text, notes text,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid
);
create unique index declarations_no_uq on public.declarations (upper(btrim(no)));

create table public.containers (
  container text primary key,
  voyage_id text references public.voyages(id) on update cascade,
  customer_id text references public.customers(id) on update cascade,
  shipper text, booking text, size text, clearance text, release text,
  load text check (load in ('Full','Mix') or load is null),
  decl text references public.declarations(id) on update cascade on delete set null,
  notes text,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid
);
create index containers_voyage_idx on public.containers (voyage_id);
create index containers_customer_idx on public.containers (customer_id);
create index containers_shipper_idx on public.containers (shipper);
create index containers_decl_idx on public.containers (decl);

-- ---------- vehicles (towing + title fields stay on the car, as in the app) ----------
create table public.vehicles (
  vin text primary key,
  no integer, vehicle text, buyer text,
  customer_id text references public.customers(id) on update cascade,
  price numeric(12,2) check (price is null or price >= 0),
  purchased date, shipper text, yard text, arrived date, status text,
  electric text check (electric in ('Yes','No') or electric is null),
  container text references public.containers(container) on update cascade on delete set null,
  exit_date date, exit_reason text, remarks text,
  -- title (SOP F02)
  t_type text,
  t_elig text check (t_elig in ('Eligible','Ineligible') or t_elig is null),
  t_loc text, t_state text, t_track text, t_courier date, t_recv date,
  t_vin_ok text check (t_vin_ok in ('Yes','No') or t_vin_ok is null),
  t_appr text, t_appr_date date, t_supplier text, t_applied date, t_checked date, t_remarks text,
  -- towing (SOP F03)
  tw_case text check (tw_case in ('AQS account','Customer account','Customer delivers') or tw_case is null),
  tw_paid date, tw_posted date, tw_pickup text, tw_lot text, tw_gate text,
  tw_key text, tw_btype text, tw_pid text, tw_track text,
  tw_carrier text, tw_driver text, tw_price numeric(12,2), tw_pick_plan date, tw_eta date,
  tw_title_collect text, tw_picked date, tw_title_pick text, tw_loc text, tw_title_dlv text,
  tw_inv_no text, tw_inv_amt numeric(12,2), tw_cpaid date, tw_booked date,
  tw_noshows integer, tw_noshow_last text,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid
);
create index vehicles_customer_idx on public.vehicles (customer_id);
create index vehicles_container_idx on public.vehicles (container);
create index vehicles_shipper_idx on public.vehicles (shipper);
create index vehicles_lot_idx on public.vehicles (tw_lot);

-- ---------- masters ----------
create table public.pickups (
  pid text primary key,                      -- e.g. GA-GA-155
  name text not null, auction text, loc text, street text, city text, state text, zip text, country text,
  ltype text, hub text, category text, address text, phone text, notes text, src text,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid
);
create index pickups_auction_idx on public.pickups (auction);

create table public.carriers (
  id text primary key, name text not null, mc text, email text, phone text,
  blocked text check (blocked in ('Yes','No') or blocked is null),
  noshows integer not null default 0, notes text,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid
);
create index carriers_name_idx on public.carriers (lower(btrim(name)));

create table public.carrier_drivers (
  id bigint generated always as identity primary key,
  carrier_id text not null references public.carriers(id) on update cascade on delete cascade,
  pos integer not null default 0,            -- keeps the app's array order
  name text not null, phone text,
  extra jsonb not null default '{}'::jsonb
);
create index carrier_drivers_carrier_idx on public.carrier_drivers (carrier_id, pos);

create table public.rates (
  id text primary key,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  origin text, pod text, size text, agent text, line text,
  rate numeric(12,2) check (rate is null or rate >= 0),
  all_in text, source text, notes text,
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid, updated_by uuid
);
create index rates_month_idx on public.rates (month);
