# AQS Vehicle & Shipment Tracker — web app

Static site. Data and login: Supabase project `aqs-tracker` (Mumbai, ref tkqfqoldatouwxktglqt).

| File | What it is |
|---|---|
| index.html | The tracker |
| config.js | Supabase URL + publishable key (safe to publish) |
| sb-adapter.js | Connects the tracker to Supabase (data, login, roles, live updates, downloads) |
| supabase.js, 591.supabase.js | Supabase client library v2.45.4 |
| export.js, exceljs.min.js, xlsx.full.min.js | Excel export / import |
| vercel.json | Security headers |

Deploy: put these files at the root of a Vercel project (no build step, framework "Other").
