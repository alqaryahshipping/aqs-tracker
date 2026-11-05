# AQS Ops — start here (for the code chat)

1. Read in this order:
   - `docs/AQS_Tracker_Deploy_Status.md`: what is live today (Supabase + Vercel + GitHub).
   - `docs/AQS_Ops_Stack_Decision.md`: the approved stack (Angular + NestJS + REST/OpenAPI + Supabase PostgreSQL).
   - `docs/AQS_Tracker_Relational_DB_Spec.md`: the approved database build. **Do this first.**
   - `docs/AQS_Tracker_Handover.md`: how Idres works, the prototype's features, and open items.
   - `docs/AQS_Ops_Audit_and_Rebuild_Plan.md`: the audit of the old Laravel app. Its findings still apply; its Laravel plan is superseded and was never approved.
2. `app-current/` = exactly what is deployed on Vercel now (repo `alqaryahshipping/aqs-tracker`). `index.html` is the prototype and the spec for every screen and rule.
3. `supabase/` = the current schema notes and the `admin-users` edge function source.
4. Working rules: give an overview and plan first; ask Idres one single-select question at a time; mark gaps [TBC]; never change production without his go-ahead.
