# Handover — AQS Vehicle & Shipment Tracker and Ops Rebuild

| | |
|---|---|
| **Owner** | Idres Ahmad (MD, Al Qaryah Group) |
| **Date** | 5 Nov 2026 |
| **Purpose** | Continue this work in a new chat |
| **Status of the rebuild plan** | **PROPOSED, NOT APPROVED BY IDRES.** Nothing in section 6 may be started until he approves it and answers the decisions in 6.9 |

---

## 1. How to work with Idres

- Brutally honest, terse, no preamble. Mark gaps with **[TBC]**.
- Give an overview of your understanding before acting. **Analyse first, propose a plan, wait for approval, then build.** He stopped work mid-way once for skipping this.
- Ask one question at a time, single-select (AskUserQuestion popups).
- MD for handover and reference documents.
- Claude never acts on production systems. Live-app changes go through an AQ-ICR change request with the IT Manager (Washi) present.
- **Tracker permission:** "operate on this artifact completely" (no need to ask before publishing tracker changes). This does not cover the rebuild plan.
- **Artifact comments:** make the change, reply in that thread, don't resolve it, and add one short line in the chat.

---

## 2. The live prototype (Vehicle & Shipment Tracker)

| | |
|---|---|
| **URL** | https://claude.ai/code/artifact/62bb036b-2a5b-4c2a-b620-2baf705ec942 |
| **Current version** | v90 (Clearance screen added) |
| **Get the code in a new chat** | `Artifact` tool, `action: "read"` on the URL (returns `index.html`); `path: "export.js"` for the Excel builder. Copies are attached with this handover |
| **Tech** | Single HTML file (~5,200 lines), plain JS, no libraries; claude.ai runtime: `db` (Firestore-like), `user`, `downloads` |
| **Users** | Tracker login (username + password, PBKDF2 hashes in `access/users`): idres.ahmad (Owner), bashir (Owner), salman, faisal (Dispatcher). claude.ai sharing is "Anyone with the link" |
| **Permissions** | Staff create and edit all records. Owner-only: report tabs (On-hand, Shipments, Rates), Export, deletes, customer merge, Users |
| **DB access rules** | `settings` read view / write interact; `access` read view / write admin; `rates` read admin / write admin; other collections default |

### 2.1 Tabs and what each does

| Tab | Key behaviour |
|---|---|
| Inbox | Rule-based checks (urgent / today / data) with owners and thresholds in Settings. Groups: shipment flow, customs clearance, full/mix, vehicles in yard, purchase, towing, titles, missing data, rates. Filters for Customer and Loader also change the counts |
| Vehicles | On hand / Shipped / Other. Short Add form (VIN, Lot#, Buyer, Customer required; vehicle, price, purchase date, gate pin and pickup location optional). Bulk grid with duplicate-VIN block, multi-cell select/copy, fill handle |
| Towing | Derived stages: purchased → pending (paid) → posted (loader + yard chosen first by the dispatcher) → assigned (carrier, driver, price) → picked → delivered → paid; 3-working-day clock; no-show (2 no-shows blocks the carrier); Lot # column with copy; carriers and pickup-location masters |
| Titles | Title type master (export eligibility) + title status master (custom statuses "work like" a core one); stages; day clock (day 10 notify, day 14 apply, day 15 storage); buyer account, loader, loader location; **title remarks** with a comment icon in the table |
| Containers | Voyage required; **Full (one customer) / Mix (several customers, common consignee chosen from the cars' customers)**; car picker shows why a VIN isn't addable (loader / customer / title / exited / already in a container); "Cleared" + arrived = locked |
| Voyages | Carrier + voyage no. duplicate check; stages Planned / Sailed / Clearing / Closed |
| **Clearance (new, v90)** | Arrived plus arriving within 7 days. Declarations (no., date, status, port, notes) hold many containers, with no grouping restriction. Declaration status is copied to every container on it. Inbox checks K1 / K2 |
| On-hand board, Shipments board, Rates | Owner reports |
| Customers | Master, type (top / internal), merge |
| Settings (gear icon) | Lists, title types and statuses, pickup locations (545, imported from the towing locations spreadsheet), carriers, users, inbox owners and thresholds |

Every list screen shows search + 3 filters, with the rest under "More filters (n)"; the Customer filter is on every car screen.

### 2.2 Data (claude.ai db collections)
`vehicles` (doc id = VIN), `containers` (id = container no.; fields incl. `voyage_id`, `customer_id`, `load` Full/Mix, `clearance`, `decl`), `voyages`, `customers` (CU### ; CU000 = Unassigned), `carriers`, `pickups` (id = Pickup ID, e.g. GA-GA-155), `declarations` (id = cleaned declaration no.), `rates`, `settings/lists`, `settings/inbox`, `access/users`, `data/users/{uid}/inboxRead` (private per user). About 2,050 documents.

### 2.3 Open items on the prototype [TBC]

- **Duplicate voyages:** 634N, 644N, 635E, MO20D0E19 and 648N need merging (inbox check C7 lists them).
- **Pickup addresses:** 536 of the 545 pickup locations have no street address.
- **Overdue voyages:** 144 containers sit on voyages still marked "Sailed" past their ETA. Mark them Arrived.
- **Clearance threshold:** set to 5 days; SOP F07 says 2 working days (Settings → Inbox thresholds → "clear").
- **Existing containers:** none has Full/Mix confirmed yet (inbox check X4).
- **Towing-sheet import:** prepared earlier (`twimp/plan.json`), never written. Waiting for "go"; there are ledger amount mismatches to resolve first.
- **Bulk towing update:** built, then **reverted** at Idres's request ("confusion"). The reason for the confusion was never given. A simpler version is possible.
- **Clearance gaps:** customs charges, card/telex route, charges to AR and the refund register (SOP F07 SF2–SF4) are not built. Declarations are not in the Excel export.
- **Inbox owners:** not assigned per check.
- **Live updates:** not stamped `updatedBy`.
- **Not built yet:** the "Full backup (JSON)" button, needed before any migration.

---

## 3. Project documents (Project "Shipping & collaborations")
- SOPs F01–F19, job descriptions, `AQS_Function_Register.md`, `AQS_Process_Flows.md`, `AQS_Cycle_Map_reference.md`
- `claude/AQS_Ops_Audit_and_Rebuild_Plan.md` — the full audit and the proposed plan (same content as section 6, with more detail)

---

## 4. Existing shipping application (received 5 Nov 2026)

- **Upload:** in chunks: `app/`, `bootstrap/`, `config/`, `database/`, `resources/`, `routes/`, `composer.json`/`.lock`, `package.json`/`-lock`, `vite`/`tailwind`/`postcss` config, `artisan`, plus vendor files that aren't needed. **A new chat must ask for the upload again;** uploads don't carry across chats.
- **Stack:** Laravel 11, PHP 8.2, MySQL; Spatie permission, Sanctum, Pusher, dompdf/FPDI, maatwebsite Excel, Yajra DataTables, PWA package. Screens are server-built Blade pages with jQuery (not an API with JS screens).
- **Size:** about 81k lines of PHP, about 164k lines of Blade, 136 tables (168 migrations), 758 web and 187 API routes. About 35 controllers are not referenced by any route. Three versions of the website.
- **IT runs this stack.** Idres: the app "has many useless modules and duplication and is not properly built"; use what's useful and build further per our flow.

### 4.1 Security findings — tell IT now (live system; not part of the rebuild)

| # | Finding | Status |
|---|---|---|
| S1 | `GET /app/invoice/download/{invoiceNumber}` returns the invoice PDF **without login** | Confirmed in the code |
| S1b | `app/shipment/bol/{containerNo}` and `app/shipment/dock/{containerNo}` | Same pattern; still to check [TBC] |
| S2 | About 107 of 758 web routes outside any auth/admin group (static check; some are the intended public website). Includes `/create-symlink` | Developer to verify with `php artisan route:list` |
| S3 | `POST /backup/download` (full database) protected by one `.env` password + 5 tries per IP | Confirmed in the code |

---

## 5. Agreed so far (by Idres)

- **Target stack:** Laravel API + JavaScript screens, Laravel login (not Keycloak).
- **Delivery route:** fastest possible using AI. The developer gets Claude Code access and builds on top of a "build kit".
- **Prototype first:** Idres finishes the full concept in the prototype; it is **frozen** before the build week.
- **Timeline target:** 1 week for the build.
- **Clearance screen:** done (v90). Status lives on the declaration; scope is arrived plus arriving soon; no grouping restriction.

---

## 6. PROPOSED PLAN — **NOT YET APPROVED BY IDRES**

> Do not start any of this until Idres explicitly approves it and answers 6.9.

### 6.1 Proposed verdict
1. **Don't refactor the old app in place.** Build a new, clean Laravel 11 app ("AQS Ops") around the prototype flow and the SOPs.
2. **Port the parts of the old app that are well built:**
   - towing cost guardrails (`towing_operations`: target / ceiling, approvals, margin snapshot, stage log);
   - carriers (`towing_suppliers`) and drivers;
   - the customer master (tiers, agreements, relationship manager, bidder accounts);
   - gate passes;
   - vehicle and container media;
   - Spatie roles and 2FA;
   - masters;
   - finance tables in phase 2.
3. **Move the public website** (3 versions, blog, listings, offers) to its own project.
4. **Drop for now:** the 103-class reports engine (rebuild only the reports people actually use), dead controllers and views, the legacy `towings` table, 3 of the 4 rate-sheet systems.

### 6.2 Module verdicts (short form)

| Module | Verdict |
|---|---|
| Vehicles | Rework to the prototype model; keep `key`, `condition`, `damage`, `weight`, `bidder_account_id`, `relationship_manager_id` |
| Towing | Prototype steps and clock + old cost guardrails, approvals and stage log |
| Carriers / drivers | Keep the old tables; add no-shows and blocked |
| Pickup locations | One table (prototype's 545 + old hub codes) |
| Titles | Prototype logic + old title-type charges |
| Customers | Keep, cleaned |
| Containers | Prototype model + old `seal_no`, `hs_code`, `itn_no`, `booking_no` |
| Voyages | New, from the prototype |
| Clearance | New, from the prototype + SOP F07 |
| Inbox | New, from the prototype |
| Gate pass | Keep |
| Media | Keep |
| Roles / 2FA | Keep (Spatie) |
| Invoices | Rework (items stored twice) |
| Ledger / payments / credits | Keep, cleaned |
| Costing | Keep |
| Rate sheets | One system (proposed `rs_*`) [TBC] |
| Portal / mobile API | Phase 3 |
| CRM | Phase 3 |

### 6.3 Duplications to remove

- **Towing:** `towings` vs `towing_operations` vs `pe_towing_*`.
- **Car-to-container link:** `containers.vehicle_id` vs the `container_vehicle` pivot.
- **Customer on car:** `vehicles.customer_name` copied alongside `customer_id`.
- **Bidder accounts:** `customers.buying_id` vs `customer_bidder_accounts`.
- **Locations:** 5 location tables.
- **Rate sheets:** 4 systems.
- **Invoice lines:** `invoices.items` JSON vs `invoice_items`.
- **Websites:** 3 copies.

### 6.4 Proposed architecture

| Layer | Choice |
|---|---|
| Backend | Laravel 11, PHP 8.2, MySQL 8 |
| API / login | Sanctum API; Spatie roles + 2FA |
| Screens | Prototype JS split into one file per module |
| Live updates | 30-second refresh in phase 1; Pusher in phase 2 |
| PDF / Excel | Existing dompdf and maatwebsite |

### 6.5 Proposed data migration
- **Sources:** old MySQL (customers, bidder accounts, vehicles, containers, towing operations, carriers, drivers, gate passes, media, masters) and the prototype JSON backup (towing steps, titles, pickups, voyages, full/mix, declarations, inbox settings).
- **Conflict rule [TBC]:** the prototype wins for operations data; the old app wins for customers, finance and media.
- **Import:** artisan commands with an exceptions report.
- **Finance:** stays in the old app during phase 1.
- **Customer portal [TBC]:**
  - A. Nightly sync to the old database.
  - B. Minimal portal added to phase 1 (+~2 days).

### 6.6 Proposed phase 0 (before the build week)

| Step | Owner |
|---|---|
| Freeze the prototype | Idres |
| Fix S1–S3 in the live app | Developer + Washi |
| Add the backup button and take the backup | Claude |
| Build kit: `CLAUDE.md`, data model (old → new column map), business rules, acceptance tests, import mapping, build plan | Claude |
| Staging server with a copy of the old MySQL | Developer |
| Answer 6.9 | Idres |

### 6.7 Proposed phase 1 — build week (developer + Claude Code)

| Day | Work |
|---|---|
| 1 | Repo, auth, roles, 2FA, migrations, seeded masters |
| 2 | API + screens: vehicles, towing, titles, carriers, pickups |
| 3 | API + screens: containers, voyages, clearance, gate pass, media, inbox, settings |
| 4 | Import scripts + exceptions report on staging |
| 5 | User testing (towing, titles, containers, clearance teams) |
| 6 | Fixes, change request for Washi, portal option |
| 7 | Cut-over; old ops screens read-only |

**Conditions for 1 week:**
- prototype frozen, with no changes during the week;
- one full-time developer and a staging server;
- scope is exactly what the prototype does;
- no SAP, Group ERP or Keycloak integration;
- the developer's Claude Code plan has enough usage (Max or Team).

### 6.8 Proposed phases 2–3
- **Phase 2 (2–3 weeks):** finance and pricing: invoices, ledger, payments, credits, costing, one rate system, customs charges, refund register, Pusher.
- **Phase 3 (2–3 weeks):** customer portal + mobile API on the new app, CRM / leads, used reports only, website as a separate project.

### 6.9 Decisions Idres still has to make
1. New repo vs. refactor in place (recommended: new repo).
2. Data conflict rule (as in 6.5).
3. Customer portal during the transition: option A or B.
4. Which rate-sheet system the pricing team actually uses.
5. Which of the 3 website versions is live.
6. Which reports people open weekly.
7. Owner of S1–S3 (proposed: Washi's team, now).
8. Approve or change the plan as a whole.

---

## 7. Suggested first steps in the new chat
1. Read this handover and `claude/AQS_Ops_Audit_and_Rebuild_Plan.md`.
2. Ask Idres for any changes to the plan and his answers to 6.9, one question at a time.
3. If the old code is needed again, ask for the re-upload (`app`, `database`, `resources`, `routes`, `config`, `bootstrap`; not `vendor`).
4. Prototype changes continue on the same artifact URL (read it first, then publish to the same URL).

## 8. Files with this handover
- `AQS_Tracker_Handover.md` (this file)
- `AQS_Ops_Audit_and_Rebuild_Plan.md` (full audit; plan marked proposed)
- `tracker_index_v90.html` and `tracker_export.js` (prototype source at v90)
