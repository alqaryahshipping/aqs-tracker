# AQS Tracker — Supabase + Vercel deployment status (5 Nov 2026)

| Item | Status |
|---|---|
| Supabase project | `aqs-tracker`, Mumbai (ap-south-1), ref `tkqfqoldatouwxktglqt`, org "Al Qaryah Shipping" (Free plan) |
| Database | `public.docs` (collection, id, data jsonb, updated_at, updated_by) + `public.profiles` (user_id, email, name, role owner/staff, active). RLS: active staff read/create/edit; owners delete; `rates` owner-only; `user:<uid>` collections private. Helpers in schema `app_private`. Realtime on `docs`. RPC `doc_update` (merge). Security advisor: clean |
| Edge function | `admin-users` (verify_jwt off; checks Owner itself): bootstrap (needs secret `SETUP_CODE`), list, create, update, reset_password |
| Web app | `AQS_Tracker_Web.zip`: tracker v91 + `sb-adapter.js` (Firestore-like API on Supabase, login, roles, downloads) + `config.js` (URL + publishable key) + libraries + `vercel.json`. Tested against an in-memory mock only |
| GitHub | Repo `alqaryahshipping/aqs-tracker` (private, empty). Claude GitHub app installed on all repos |
| Vercel | Connected (personal Hobby account). Not deployed yet |
| Old Seoul project | `alqaryahshipping's Project` — unused, delete when convenient |

## Open steps
1. Supabase dashboard: add Edge Function secret `SETUP_CODE`; turn off "Allow new users to sign up".
2. Get the files into the repo: manual upload, or a new session started with the repo selected (`https://claude.ai/code?repositories=alqaryahshipping/aqs-tracker`) and the zip attached.
3. Link the repo to Vercel (`create_git_project`), deploy, and check against real Supabase.
4. First-time setup → Owner login; add users; download the backup from the claude.ai tracker (v91, Settings → Full backup); restore it in the new app.
5. [TBC] Pro plans (Vercel non-commercial limit; Supabase pausing/backups) after go-live.
