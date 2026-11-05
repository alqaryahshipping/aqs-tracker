# AQS Tracker — Relational Database Build Spec (for the code chat)

| | |
|---|---|
| **Approved by** | Idres Ahmad, 5 Nov 2026: "Approve, start". Everything is to be done in the code chat |
| **Supabase project** | `aqs-tracker`, ref `tkqfqoldatouwxktglqt`, Mumbai |
| **Repo / host** | `alqaryahshipping/aqs-tracker` → Vercel (`aqs-tracker-alqaryahshipping.vercel.app`) |
| **Read first** | `claude/AQS_Tracker_Deploy_Status.md`, `claude/AQS_Tracker_Handover.md` |
| **Working rules** | Overview before action. Ask Idres one single-select question at a time. Mark gaps with [TBC]. Terse and honest |

---

## 1. Goal

Replace the single JSON store (`public.docs`: collection, id, data jsonb) with proper typed tables, database-enforced integrity and a full change history. **The tracker screens must not change.** Only `sb-adapter.js`, the page's database connector, is rewritten.

### Current state (checked 5 Nov 2026)

| collection | rows | fields |
|---|---|---|
| containers | 805 | booking, clearance, container, createdAt, customer_id, notes, release, shipper, size, updatedAt, voyage_id |
| pickups | 553 | address, auction, category, city, country, createdAt, hub, loc, ltype, name, notes, phone, pid, src, state, street, updatedAt, zip |
| vehicles | 472 | 54 fields (see §3.4) |
| rates | 164 | agent, all_in, createdAt, line, month, notes, origin, pod, rate, size, source, updatedAt |
| voyages | 87 | createdAt, eta, etd, line, notes, origin, pod, status, updatedAt, vessel, voyage_no |
| carriers | 40 | blocked, createdAt, drivers (array), email, mc, name, noshows, notes, phone, updatedAt |
| customers | 9 | city, contact, createdAt, email, internal, name, notes, phone, system, top, updatedAt |
| settings | 1 | `lists` (dropdown lists, partners, tTypes, tLocs, placeCountry) |

- **Not present yet:** `declarations`, `settings/inbox`, `load` / `decl` on containers.
- **Per-user data:** `user:<uid>` collections (prefs, drafts, inboxRead).
- **Unchanged:** `profiles`, the role helpers in `app_private`, and edge function `admin-users`.

---

## 2. Design principles

1. **Column names = the app's field names.** Only `createdAt`/`updatedAt` become `created_at`/`updated_at`. This keeps the adapter mapping trivial.
2. **Values are stored as the app uses them.** 'Yes'/'No' text stays text, guarded by CHECK constraints. Dates become `date` (the app uses `YYYY-MM-DD`). Money and amounts become `numeric`. Counts become `integer`.
3. **Every business table gets `extra jsonb not null default '{}'`.** Any field the adapter doesn't recognise goes there, so nothing is ever lost and future prototype fields keep working before a column exists.
4. **Every business table also gets** `created_at`, `updated_at`, `created_by`, `updated_by` (auth uid), set by triggers.
5. **Natural keys** where the app uses them: vehicles = VIN, containers = container no., customers = CU###, pickups = Pickup ID. Voyages, carriers, declarations and rates keep their existing text IDs.
6. **Foreign keys** use `on update cascade`. Delete behaviour is `restrict` unless noted.
7. **RLS on every table.** Same rules as today: active staff can select, insert and update; Owners can delete; `rates` is Owner-only for everything; `user_data` is private to its user.
8. **Realtime** is enabled on every business table.
9. **Audit trigger** on every business table, writing to `audit_log`.

---

## 3. Schema (draft DDL — review, then apply as migrations)

> Dates that fail to cast (e.g. "12/10/2026", "N/A") must NOT abort the move. They go to `migration_exceptions` (§5) and the column is left null. The original value stays in `extra`.

### 3.1 Shared
```sql
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid default auth.uid(),
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('insert','update','delete')),
  changes jsonb            -- update: {field: [old, new]}; insert: new row; delete: old row
);
create index audit_log_record_idx on public.audit_log (table_name, record_id, at desc);
-- RLS: select for active staff (Owner-only for rows where table_name='rates'); no insert/update/delete for clients (trigger is security definer).

create table public.migration_exceptions (
  id bigint generated always as identity primary key,
  collection text, record_id text, field text, value text, problem text, at timestamptz default now()
);
-- RLS: Owner select only.

create table public.app_settings (key text primary key, value jsonb not null default '{}', updated_at timestamptz default now(), updated_by uuid);
-- keys: 'lists', 'inbox'. RLS: active staff read + write (as today for settings).

create table public.user_data (user_id uuid not null references auth.users(id) on delete cascade, key text not null, value jsonb not null default '{}', updated_at timestamptz default now(), primary key (user_id, key));
-- RLS: user_id = auth.uid() for all operations.
```

### 3.2 Customers
```sql
create table public.customers (
  id text primary key,                      -- CU001; CU000 = Unassigned (system)
  name text not null,
  contact text, phone text, email text, city text, notes text,
  internal text check (internal in ('Yes','No') or internal is null),
  top text check (top in ('Yes','No') or top is null),
  system text,
  extra jsonb not null default '{}',
  created_at timestamptz default now(), updated_at timestamptz default now(), created_by uuid, updated_by uuid
);
create unique index customers_name_ci on public.customers (lower(btrim(name)));
```

### 3.3 Voyages, containers, declarations
```sql
create table public.voyages (
  id text primary key,
  line text, vessel text, voyage_no text, origin text, pod text,
  etd date, eta date,
  status text not null check (status in ('Planned','Sailed','Arrived')),   -- [TBC] confirm full VOY_STATUS list from the app
  notes text, extra jsonb not null default '{}', created_at timestamptz default now(), updated_at timestamptz default now(), created_by uuid, updated_by uuid
);
-- Duplicate rule = carrier + voyage no. (normalised the same way as the app's voyKey):
-- create unique index voyages_line_no_uq on public.voyages (lower(btrim(line)), upper(regexp_replace(voyage_no, '[\s\-_./]', '', 'g'))) where voyage_no is not null and btrim(voyage_no) <> '';
-- ⚠ Create it only AFTER Idres confirms how the 5 existing duplicates (634N, 644N, 635E, MO20D0E19, 648N) are merged.

create table public.declarations (
  id text primary key,
  no text not null, date date, status text, port text, notes text,
  extra jsonb not null default '{}', created_at timestamptz default now(), updated_at timestamptz default now(), created_by uuid, updated_by uuid
);
create unique index declarations_no_uq on public.declarations (upper(btrim(no)));

create table public.containers (
  container text primary key,               -- container no.
  voyage_id text references public.voyages(id) on update cascade,
  customer_id text references public.customers(id) on update cascade,
  shipper text, booking text, size text, clearance text, release text,
  load text check (load in ('Full','Mix') or load is null),
  decl text references public.declarations(id) on update cascade on delete set null,
  notes text, extra jsonb not null default '{}', created_at timestamptz default now(), updated_at timestamptz default now(), created_by uuid, updated_by uuid
);
create index containers_voyage_idx on public.containers (voyage_id);
create index containers_customer_idx on public.containers (customer_id);
create index containers_shipper_idx on public.containers (shipper);
```

### 3.4 Vehicles (one table; towing + title fields stay on the car, as in the app)
```sql
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
  t_type text, t_elig text check (t_elig in ('Eligible','Ineligible') or t_elig is null),
  t_loc text, t_state text, t_track text, t_courier date, t_recv date,
  t_vin_ok text check (t_vin_ok in ('Yes','No') or t_vin_ok is null),
  t_appr text, t_appr_date date, t_supplier text, t_applied date, t_checked date, t_remarks text,
  -- towing (SOP F03)
  tw_case text check (tw_case in ('AQS account','Customer account','Customer delivers') or tw_case is null),
  tw_paid date, tw_posted date, tw_pickup text, tw_lot text, tw_gate text,
  tw_carrier text, tw_driver text, tw_price numeric(12,2), tw_pick_plan date, tw_eta date,
  tw_title_collect text, tw_picked date, tw_title_pick text, tw_loc text, tw_title_dlv text,
  tw_inv_no text, tw_inv_amt numeric(12,2), tw_cpaid date, tw_booked date,
  tw_noshows integer, tw_noshow_last text,
  extra jsonb not null default '{}', created_at timestamptz default now(), updated_at timestamptz default now(), created_by uuid, updated_by uuid
);
create index vehicles_customer_idx on public.vehicles (customer_id);
create index vehicles_container_idx on public.vehicles (container);
create index vehicles_shipper_idx on public.vehicles (shipper);
create unique index vehicles_lot_uq on public.vehicles (tw_lot) where tw_lot is not null and btrim(tw_lot) <> '';   -- [TBC] confirm lot # must be unique
```
- **Fields not in current data but used by the app:** `tw_key`, `tw_btype`, `tw_pid`, `tw_src`, `tw_track`. Add them as text/date columns, or let them land in `extra`. Check `TW_F`, `TITLE_FIELDS` and `VEH_FIELDS` in `index.html` for the full list.
- **No foreign key on `tw_pickup` / `tw_carrier`:** the app stores names, not IDs. The inbox checks (W8) flag unknown names. Converting to real foreign keys is phase 2 [TBC].

### 3.5 Masters
```sql
create table public.pickups (
  pid text primary key,                      -- e.g. GA-GA-155
  name text not null, auction text, loc text, street text, city text, state text, zip text, country text,
  ltype text, hub text, category text, address text, phone text, notes text, src text,
  extra jsonb not null default '{}', created_at timestamptz default now(), updated_at timestamptz default now(), created_by uuid, updated_by uuid
);
create index pickups_auction_idx on public.pickups (auction);

create table public.carriers (
  id text primary key, name text not null, mc text, email text, phone text,
  blocked text check (blocked in ('Yes','No') or blocked is null), noshows integer default 0, notes text,
  extra jsonb not null default '{}', created_at timestamptz default now(), updated_at timestamptz default now(), created_by uuid, updated_by uuid
);
create unique index carriers_name_ci on public.carriers (lower(btrim(name)));
create table public.carrier_drivers (
  id bigint generated always as identity primary key,
  carrier_id text not null references public.carriers(id) on update cascade on delete cascade,
  name text not null, phone text, extra jsonb not null default '{}'
);
-- The app reads carriers with drivers as an array: the adapter rebuilds `drivers: [{name, phone, ...}]` on read
-- and replaces the carrier's driver rows on write.

create table public.rates (
  id text primary key, month text not null check (month ~ '^\d{4}-\d{2}$'),
  origin text, pod text, size text, agent text, line text,
  rate numeric(12,2) check (rate is null or rate >= 0), all_in text, source text, notes text,
  extra jsonb not null default '{}', created_at timestamptz default now(), updated_at timestamptz default now(), created_by uuid, updated_by uuid
);
create index rates_month_idx on public.rates (month);
```
- **Title types / title statuses:** keep them inside `app_settings.lists` (`tTypes`, `tLocs`) for phase 1. The app reads and writes them as part of `lists`. Normalising them into tables is phase 2 [TBC].

### 3.6 Triggers and RLS (all business tables: customers, voyages, declarations, containers, vehicles, pickups, carriers, carrier_drivers, rates)
- `before insert or update` → set `updated_at = now()`, `updated_by = auth.uid()`; on insert also `created_by`.
- `after insert or update or delete` → write to `audit_log` (security definer function in `app_private`; record only changed fields on update).
- **RLS:**
  - select / insert / update → `(select app_private.is_active_user())`;
  - delete → `(select app_private.is_owner())`;
  - `rates`: every operation → `(select app_private.is_owner())`.
- `alter publication supabase_realtime add table …` for every business table.
- Run `get_advisors` (security + performance) after each migration until it is clean.

---

## 4. Adapter rewrite (`sb-adapter.js`)

Keep the exact public API the page uses: `collection(name).where().limit().get()/onSnapshot()`, `doc(path).get/set/update/delete/onSnapshot`, the `window.claude.use('db'|'user'|'downloads')` shim, and the `SB` login helpers.

| App collection / path | Table | Key column |
|---|---|---|
| vehicles | vehicles | vin |
| containers | containers | container |
| voyages | voyages | id |
| customers | customers | id |
| carriers | carriers (+ carrier_drivers) | id |
| pickups | pickups | pid |
| declarations | declarations | id |
| rates | rates | id |
| `settings/<key>` | app_settings | key (`value` = whole doc) |
| `data/users/<uid>/<key>` | user_data | (user_id, key) |

**How each operation maps:**
- **Read:** row → doc. Columns become fields; `created_at`/`updated_at` become `createdAt`/`updatedAt` (ISO strings); `extra` is merged in. `null` columns are omitted, so the app sees "missing" the way it does today.
- **`set(obj)`:** upsert the full row. Known fields go to their columns, unknown fields to `extra`, and known fields not present in `obj` are set to null (`set` replaces the whole record).
- **`update(patch)`:** update only the given columns. Unknown keys are merged into `extra` with `extra = extra || patch` (use an RPC per table, or one generic security-invoker RPC with a whitelist of table names).
- **`delete()`:** delete by key. RLS limits deletes to Owners.
- **`where(field, op, value)`:** filter on the real column; unknown field → `extra->>field`. Operators `== != < <= > >= in not-in`; `== null` → `is null`.
- **Type coercion on write:**
  - `''` → null;
  - numeric columns → Number;
  - date columns → `YYYY-MM-DD` or null.

  If the value is invalid, reject the save with a clear message, e.g. "Purchase date is not a valid date". Never silently drop it.
- **Live updates:** subscribe to `postgres_changes` per table and refetch, as today.
- **Errors:**
  - Postgres `23505` (unique) → "Already exists: …";
  - `23503` (foreign key) → "Unknown customer / container / voyage …";
  - `23514` (check) → "Value not allowed: …";
  - `42501` → `permission_denied`.

**Key renames:** the app can rename a container no., VIN or customer ID through "merge". `on update cascade` handles the children. Check how the page performs merges and renames (it may delete and re-create records) and keep children consistent [TBC].

---

## 5. Data move (inside Supabase, with SQL; no data through chat)

1. **Freeze:** announce a 15-minute no-editing window, then take a fresh Full backup (JSON) from the new tracker as a safety copy.
2. **Load in dependency order:**
   1. customers
   2. voyages
   3. declarations
   4. pickups
   5. carriers + drivers (from the `drivers` array)
   6. containers
   7. vehicles
   8. rates
   9. app_settings (from `docs` `settings/*`)
   10. user_data (from `user:%` collections)

   Use `insert … select` from `public.docs`, with safe-cast helper functions (`app_private.try_date(text)`, `try_num(text)`, `try_int(text)`) that log failures to `migration_exceptions` and return null.
3. **Orphans:**
   - A car whose `customer_id` or `container` doesn't exist: set the column to null and log it.
   - A container whose `voyage_id` or `customer_id` doesn't exist: same.

   Never drop the row.
4. **Verify:**
   - row counts match `docs` per collection;
   - zero unexpected nulls in key columns;
   - list `migration_exceptions` for Idres.
5. **Switch:** deploy the new adapter (push to GitHub → Vercel), hard-refresh, and smoke test every tab.
6. **Keep `public.docs`:** revoke insert, update and delete from `authenticated` (read-only rollback source). Drop it after 30 days, only with Idres's approval.

**Rollback:** redeploy the previous adapter commit and restore insert/update rights on `docs`. Edits made after the switch would then be missing, so do the smoke test immediately.

---

## 6. Acceptance checks (with Idres or a team lead, 30 minutes)

- [ ] Sign in as Owner and as Staff; Staff cannot delete and cannot see Rates.
- [ ] Every tab loads with the same counts as before the move: Vehicles, Towing, Titles, Containers, Voyages, Clearance, boards, Customers.
- [ ] Add a vehicle: a duplicate VIN is rejected with a clear message; an unknown customer is rejected.
- [ ] Towing steps, title save (with remarks), container full/mix, car picker, declaration create/status — all save and show live in a second browser.
- [ ] Bulk entry / import and Excel export work.
- [ ] `audit_log` shows who changed what, for one test edit.
- [ ] Security and performance advisors are clean.

---

## 7. Open decisions [TBC] — ask Idres one at a time

1. **Duplicate voyages:** how to merge the 5 duplicates (which copy to keep). Only then switch on the voyage uniqueness rule.
2. **Lot #:** must it be unique?
3. **Supabase Pro (about $25/month):** needed for daily backups and to stop the project pausing. Recommended before the team relies on it.
4. **Freeze window:** the time for the 15-minute pause.
5. **Phase 2:**
   - foreign keys for pickup and carrier on vehicles;
   - title types and statuses as tables;
   - an audit-history view in the app ("History" on each record).
