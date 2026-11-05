# AQS Ops App — Stack Decision

| | |
|---|---|
| **Decided by** | Idres Ahmad, 5 Nov 2026: "Option A with frontend as Angular" |
| **Applies to** | The proper application that replaces the single-file tracker page |
| **Unchanged** | `claude/AQS_Tracker_Relational_DB_Spec.md`. The database comes first and works with the current page in the meantime |

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Language | **TypeScript** end to end | Same family as the Group ERP (Node.js + PostgreSQL) |
| Frontend | **Angular** (current LTS), standalone components, Angular Material or PrimeNG [TBC: pick one], RxJS | Rebuilt module by module from the prototype; same screens and logic |
| Backend | **NestJS** (Node.js, TypeScript) | Angular-style modules/services/decorators; holds the business rules (stages, inbox checks, full/mix, locking) |
| API | **REST (JSON)** with **OpenAPI/Swagger** docs (`@nestjs/swagger`) | One API for the Angular app, SAP B1 / Group ERP, a future customer portal and mobile |
| Database | **Supabase PostgreSQL** (relational spec) | Constraints + audit log as the safety net; ORM: Drizzle or Prisma [TBC] |
| Auth | **Supabase Auth** (JWT) | Angular signs in with Supabase; NestJS verifies the JWT and applies Owner/Staff roles; RLS stays on as a second layer |
| Live updates | Supabase Realtime in Angular | Refetch through the API on change |
| Hosting | Angular → **Vercel** (static); NestJS → Vercel Node functions to start, or AWS (same as the Group ERP) [TBC] | Supabase stays in Mumbai |
| Files / exports | Excel export server-side (ExcelJS in NestJS) or client-side as today | |

## Order of work
1. Relational database (spec already written), with the current page kept running on it through the new adapter.
2. NestJS API: auth guard, roles, one module per area (vehicles, towing, titles, containers, voyages, clearance, customers, masters, rates, inbox, settings, users), OpenAPI docs, tests.
3. Angular app, module by module in this order: Vehicles → Towing → Titles → Containers → Voyages → Clearance → Boards → Customers → Settings → Inbox. Each module goes live when it matches the prototype.
4. The old page retires once every module has moved.

## Implications [TBC]
- **Effort:** realistic with AI plus a reviewing developer is about 2–3 weeks for API + Angular, not days. Angular is more structured, and more verbose, than React.
- **Hosting:** NestJS on Vercel works for this load. Long-running jobs and scheduled inbox emails would fit AWS better (where the Group ERP runs).
- **IT agreement:** Washi's team maintains TypeScript/Angular/NestJS. Confirm before the build starts.
- **Earlier plan:** this supersedes the Laravel rebuild plan in `claude/AQS_Ops_Audit_and_Rebuild_Plan.md`, which was never approved. That audit's keep/rework/drop findings on the old app still apply.
