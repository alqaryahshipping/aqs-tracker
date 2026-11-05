# AQS Shipping App — Audit and Rebuild Plan

| | |
|---|---|
| **Scope** | Existing Laravel shipping application (code received 5 Nov 2026) vs. the Vehicle & Shipment Tracker prototype (v90) |
| **Status** | **PROPOSED — NOT YET APPROVED BY IDRES.** Analysis only; no development started. |
| **Decisions needed** | Section 9 |

---

## 1. Verdict

1. **Don't refactor the existing app in place.** It mixes three things in one codebase: the operations admin, three public website versions plus a blog and CRM, and a customer portal with a mobile API. It also carries 4 parallel rate-sheet systems and 2 parallel towing systems. Cleaning that up in place costs more than rebuilding the core.
2. **Build a new, clean Laravel 11 app ("AQS Ops")** around our flow: the prototype screens plus the SOPs.
3. **Port the parts of the old app that are well built.** These are the towing cost guardrails, carriers and drivers, the customer master, gate passes, media uploads, Spatie roles with 2FA, and the finance tables (in phase 2).
4. **Move the public website out** into its own project. It has nothing to do with operations.
5. **Phase 1 (operations core) fits in one week** with one full-time developer using Claude Code. Finance, the customer portal and reports do not; they are phases 2–3.

---

## 2. What the old app contains

| Item | Size |
|---|---|
| Stack | Laravel 11, PHP 8.2, MySQL, Spatie permissions, Sanctum, Pusher, dompdf/FPDI, maatwebsite Excel, DataTables |
| Screens | Blade templates + jQuery + DataTables. Mostly server-rendered, not API-driven |
| PHP code | ~81,000 lines (132 models, ~100 controllers, 103 report classes, 25 services) |
| Blade views | ~164,000 lines (245 admin pages, 3 website versions: `final_web`, `new_web`, `new_website`) |
| Database | 168 migrations, 136 tables |
| Routes | 758 web routes, 187 API routes (API serves dropdown masters and a mobile/portal app) |
| Dead code | ~35 controllers not referenced by any route (e.g. `RateSheetController`, `RateSheetsController`, `TitleStatusController`, `TitleTypeController`, `CanadaController`, `TowingRateController`) |
| Activity | Latest migration 28 Oct 2026, so it is still being changed |

---

## 3. Urgent findings (raise with IT now, independent of the rebuild)

| # | Finding | Risk | Action |
|---|---|---|---|
| S1 | `GET /app/invoice/download/{invoiceNumber}` (`API\Invoice::downloadInvoiceApp`) returns the invoice PDF **without login**. Anyone who guesses an invoice number gets a customer's invoice. Same pattern on `app/shipment/bol/{containerNo}` and `app/shipment/dock/{containerNo}` [TBC: verify those two]. | Customer data leak | Add `auth:sanctum` or a signed URL today |
| S2 | About 107 of 758 web routes sit outside any `auth`/admin middleware group (static check; some are the intended public website). Includes `/create-symlink` (runs an artisan command publicly). | Unknown exposure | Developer to run `php artisan route:list` and confirm every non-website route requires login |
| S3 | DB backup download (`POST /backup/download`) is protected only by one shared password from `.env` and a per-IP limit of 5 tries. | Full database download if the password leaks | Restrict to admin login + signed link; move backups off the web route |

These are live-system issues. They follow your change process with Washi, not this rebuild.

---

## 4. Module verdicts

**Keep** = port as-is or with small fixes. **Rework** = the idea is needed but rebuilt to our flow. **Drop** = not carried into AQS Ops.

### 4.1 Operations core (phase 1)

| Area | Old app | Prototype | Verdict | Why |
|---|---|---|---|---|
| Vehicles | `vehicles` (39 cols). Title held as free text; `customer_name` copied onto the car; no towing or title stages | Car record + stepwise flow; title, towing and shipping stages are derived | **Rework** | Prototype model is correct. Keep old columns worth having: `key`, `condition`, `damage`, `weight`, `bidder_account_id`, `relationship_manager_id` |
| Towing (old) | `towings` (14 cols, simple) | — | **Drop** | Superseded by `towing_operations` |
| Towing (new) | `towing_operations` (59 cols) + `towing_lanes`, `towing_stage_logs`, `towing_approvals`. Target/ceiling cost guardrails, margin snapshot, approval when over ceiling | 7-step flow, 3-WD clock, no-show, blocked carriers, pickup master | **Keep logic + rework** | Merge: prototype's steps and clock + old cost guardrails, approvals and stage log. The old towing system is the best-built part of the app |
| Carriers / drivers | `towing_suppliers` (MC/DOT, insurance expiry, terms) + `towing_drivers` (licence, plate) | Carriers + drivers + no-show count + blocked | **Keep** | Old tables are richer. Add `noshows` and `blocked` |
| Pickup locations | `towing_pickup_locations` (hub, hub_code) + `pickup_details` (country/state only) + `locations` | 545-location master with hub → yard mapping | **Rework** | One table. Import the 545 from the prototype; merge hub codes |
| Titles | `title_statuses` (2 cols) + `title_types` (urgent/normal charges); title type and status stored as text on vehicles | Title stages, title status master (custom statuses that "work like" a core one), export eligibility, day clock, remarks | **Rework** | Prototype logic; keep old title-type charges (urgent/normal) for billing |
| Customers | `customers` (40 cols: tier, agreement signing, RM, inactivity reminders) + `customer_bidder_accounts` + `customer_companies` + `consignees` + `customer_tiers` | Customer master (internal / top flags) | **Keep + clean** | Old master is good. Remove the duplicate `buying_id`/`auction` fields (they live in `customer_bidder_accounts`) |
| Containers | `containers` (29 cols) with **both** a `vehicle_id` column **and** a `container_vehicle` pivot table; vessel and line held as free text; no voyage entity | Container → Voyage (line, vessel, ETD/ETA, status); full/mix; consignee rule; locking | **Rework** | Prototype model. Keep old fields worth having: `seal_no`, `hs_code`, `itn_no`, `booking_no`, `size`, `quantity` |
| Voyages | Not present (`vessels` = name only) | Voyages with status driving container status | **New** | From prototype |
| Clearance | `clearence_supplier_name` + `clearance_status` (added 28 Oct) on containers | Declarations → containers, status flows to containers, inbox checks | **New** | From prototype + SOP F07 |
| Gate pass | `gate_passes` (receiver, EID, expiry) + `receivers` | — | **Keep** | Needed for UAE yard release (SOP F17) |
| Media | `vehicle_media`, `container_media`, `vehicle_documents`, `MediaZipController` | — | **Keep** | Photos and documents per car and container |
| Inbox / exceptions | Not present | ~40 rule-based checks with owners | **New** | From prototype |
| Users / roles | Spatie roles + permissions, 2FA, OTP email verification, known devices | Owner / staff | **Keep** | Use Spatie; map prototype permissions to roles |
| Masters | makes, models, colors, ports, yards, states, cities, countries (table misspelt `countires`), areas, damages | Lists in Settings | **Keep (clean)** | Rename `countires`; merge `locations` / `areas` / `cities` [TBC] |

### 4.2 Finance and pricing (phase 2)

| Area | Old app | Verdict | Why |
|---|---|---|---|
| Invoices | `invoices` (27 cols, also holds `items` as JSON) + `invoice_items` + `items` + `payment_logs` | **Rework** | Items are stored twice (JSON column and `invoice_items` table). Keep one. Link invoices to vehicle and container IDs, not free-text VIN or container numbers |
| Ledgers / payments | `ledgers`, `general_payments`, `credits`, `credit_logs`, `transections` | **Keep + clean** | Needed for AR (SOP F15). Fix the `transections` typo; merge `credits` into the ledger [TBC] |
| Costing | `cost_components`, `cost_groups`, `cost_ledger` (USD/AED, FX, split by container), `sale_groups` | **Keep** | Matches SOP F18 pricing and margin |
| Expenses | `expenses` | **Keep** | — |
| Rate sheets | **4 parallel systems**: `rate_sheet_*` + `shipping/towing_rate_entries` + `customer_rate_overrides`; `rs_*` (10 tables); `pe_shipping_*` / `pe_towing_*` price estimator (9 tables); Canada / showroom / special sheets | **Rework into one** | Pick `rs_*` (newest, most complete) as the base after checking with the pricing users. Drop the rest |
| Freight rates (prototype) | — | **Merge** | Prototype "Rates" tab folds into the single rate system |

### 4.3 Customer-facing and other (phase 3, or separate project)

| Area | Old app | Verdict | Why |
|---|---|---|---|
| Customer portal + mobile API | `portal_access` middleware, `/api/app/*`, PWA package | **Rework (phase 3)** | Customers must keep seeing their cars. See section 7 for the transition |
| Public website | 3 versions + blog + listings + offers + auctions + newsletter + sitemap | **Move out** | Separate project. Keep one website version only [TBC: which one is live] |
| CRM / leads | `leads`, `lead_activities`, `lead_reminders`, `PublicLeadController` | **Keep, phase 3** | BD use (SOP F12). Not operations core |
| Reports engine | 103 classes, 13 report tables (schedules, snapshots, favourites, templates) | **Drop for now** | Over-built. Phase 1 uses prototype boards + Excel export. Rebuild only the reports people actually open [TBC: ask users] |
| Announcements, marquee, messages, notifications | Several tables | **Keep notifications only** | — |
| Dead controllers / views | ~35 unrouted controllers, `test.blade.php`, a zip inside views | **Drop** | — |

---

## 5. Duplication map

| Duplicate | Tables | Resolution |
|---|---|---|
| Towing | `towings` vs `towing_operations` vs `pe_towing_*` | `towing_operations` (reworked) |
| Car ↔ container link | `containers.vehicle_id` vs `container_vehicle` pivot vs prototype `vehicles.container` | One link: `vehicles.container_id` (a car is in one container) |
| Customer on car | `vehicles.customer_id` + `vehicles.customer_name` | ID only |
| Bidder accounts | `customers.buying_id/auction` vs `customer_bidder_accounts` | Bidder accounts table only |
| Locations | `pickup_details`, `locations`, `areas`, `cities`, `towing_pickup_locations` | One pickup-location table + standard geo masters |
| Rate sheets | 4 systems (section 4.2) | One |
| Invoice lines | `invoices.items` JSON vs `invoice_items` | `invoice_items` |
| Websites | 3 versions | One, moved out |

---

## 6. Target architecture (AQS Ops)

| Layer | Choice | Reason |
|---|---|---|
| Backend | Laravel 11, PHP 8.2, MySQL 8 | Same as today: IT already runs it |
| API | Laravel REST + Sanctum | Screens and the future mobile app share one API |
| Screens | Prototype JavaScript, split into one file per module, served by Laravel. No Blade page logic | Logic already proven by the team; fastest port |
| Roles | Spatie permission + existing 2FA | Already working in the old app |
| Live updates | Refresh every 30 seconds in phase 1; Pusher (already licensed) in phase 2 | Keeps week 1 simple |
| Files | Laravel storage (same as old media) | Port the existing photos as they are |
| PDF / Excel | dompdf + maatwebsite (already in use) | No new packages |

**Phase 1 core tables:** `users`, `roles`/`permissions` (Spatie), `customers`, `customer_bidder_accounts`, `vehicles`, `towing_operations`, `towing_stage_logs`, `towing_approvals`, `carriers` (from `towing_suppliers`), `drivers`, `pickup_locations`, `title_types`, `title_statuses`, `voyages`, `containers`, `declarations`, `gate_passes`, `vehicle_media`, `container_media`, `settings` (lists, thresholds, inbox owners), `activity_log`, plus masters (makes, models, colors, ports, yards, countries, states).

---

## 7. Data migration and transition

1. **Sources:** the old app's MySQL (customers, bidder accounts, vehicles, containers, towing operations, carriers, drivers, gate passes, media, masters) and the prototype's JSON backup (towing steps, titles, pickup master, voyages, full/mix, declarations, inbox settings).
2. **Conflict rule [TBC]:** the prototype has been the team's working record since Oct–Nov 2026. Proposal: prototype data wins for vehicles, towing, titles and containers; the old app wins for customers, finance and media.
3. **Import scripts** (Laravel artisan commands) clean, merge duplicates, and print an exceptions report of anything that could not be mapped.
4. **Customer portal gap:** after cut-over, the old portal would show stale car status. Options [TBC]:
   - A. Sync job copies car and container status from AQS Ops to the old DB nightly, until the portal moves (phase 3).
   - B. Bring a minimal portal (my cars, status, documents) into phase 1. That adds about 2 days.
5. **Finance in the old app** keeps working during phase 1. Invoices reference VIN and container numbers as text, so they still match.

---

## 8. Plan

### Phase 0 — before the build week (you + me)
| Step | Owner |
|---|---|
| Freeze the prototype (clearance is done; add anything else missing now) | You |
| Fix S1–S3 in the live app | Developer + Washi |
| Add a "Full backup (JSON)" button to the prototype; take the backup at freeze | Me |
| Write the build kit: `CLAUDE.md`, data model (old → new column map), business rules, acceptance tests, import mapping | Me |
| Provide a recent MySQL dump of the old app (structure + data) on a staging server, not production | Developer |
| Confirm the decisions in section 9 | You |

### Phase 1 — build week (developer + Claude Code, me on call for business questions)
| Day | Work | Done when |
|---|---|---|
| 1 | New Laravel repo, auth + Spatie roles + 2FA, migrations for core tables, masters seeded | `php artisan migrate --seed` runs clean on staging |
| 2 | API for vehicles, towing, titles, carriers, pickups; prototype screens wired to API | Vehicles, Towing, Titles work end to end on staging |
| 3 | API for containers, voyages, clearance, gate pass, media, inbox, settings | All prototype tabs work on staging |
| 4 | Import scripts: old MySQL + prototype backup; exceptions report | Staging holds the real data; exceptions under an agreed number |
| 5 | User testing: towing, titles, containers, clearance teams (half a day each) | Acceptance list signed off or fixes logged |
| 6 | Fixes; change request for Washi; portal sync (option A) if chosen | Change request approved |
| 7 | Cut-over: final import, go live, old ops screens set read-only | Team working in AQS Ops |

### Phase 2 — finance and pricing (2–3 weeks)
Invoices, ledger, payments, credits, costing ledger, the single rate system, customs charges and the refund register (SOP F07 parts 2–4), Pusher live updates.

### Phase 3 — customer side (2–3 weeks)
Customer portal and mobile API on AQS Ops, CRM/leads, the reports people actually use, and the website moved to its own project.

---

## 9. Decisions needed [TBC]

1. **New repo vs. refactor in place:** recommend new repo (section 1).
2. **Data conflict rule:** prototype wins for operations data, old app wins for customers, finance and media?
3. **Customer portal during transition:** option A (nightly sync) or B (minimal portal in phase 1)?
4. **Rate sheets:** which of the 4 systems the pricing team actually uses today.
5. **Website:** which of the 3 versions is live.
6. **Reports:** which reports people open weekly. Everything else is dropped.
7. **Owner of the live-app security fixes (S1–S3):** Washi's team, now.
