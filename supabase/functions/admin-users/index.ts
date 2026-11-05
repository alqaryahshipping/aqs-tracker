// AQS Tracker — user management (Owner only), plus one-time first-owner setup guarded by SETUP_CODE.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const normEmail = (e: string) => {
  e = String(e || "").trim().toLowerCase();
  if (!e) return "";
  return e.includes("@") ? e : `${e.replace(/[^a-z0-9._-]/g, "")}@aqs-tracker.local`; // username-only logins
};
const okPassword = (p: string) => typeof p === "string" && p.length >= 8;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); }
  const action = String(body.action || "");

  // ---- one-time setup: create the first Owner when no profiles exist ----
  if (action === "bootstrap") {
    const code = Deno.env.get("SETUP_CODE");
    if (!code || body.code !== code) return json({ error: "Setup code is wrong." }, 403);
    const { count } = await admin.from("profiles").select("user_id", { count: "exact", head: true });
    if ((count || 0) > 0) return json({ error: "Setup already done. Ask an Owner to create your login." }, 409);
    const email = normEmail(body.email);
    if (!email || !okPassword(body.password)) return json({ error: "Enter a login and a password of at least 8 characters." }, 400);
    const { data, error } = await admin.auth.admin.createUser({ email, password: body.password, email_confirm: true, user_metadata: { name: body.name || "" } });
    if (error) return json({ error: error.message }, 400);
    const { error: pe } = await admin.from("profiles").insert({ user_id: data.user.id, email, name: body.name || email, role: "owner", active: true });
    if (pe) return json({ error: pe.message }, 400);
    return json({ ok: true, email });
  }

  // ---- everything else: caller must be an active Owner ----
  const authz = req.headers.get("Authorization") || "";
  const userClient = createClient(URL_, ANON, { global: { headers: { Authorization: authz } }, auth: { persistSession: false } });
  const { data: who, error: we } = await userClient.auth.getUser();
  if (we || !who?.user) return json({ error: "Not signed in." }, 401);
  const { data: me } = await admin.from("profiles").select("role, active").eq("user_id", who.user.id).maybeSingle();
  if (!me || !me.active || me.role !== "owner") return json({ error: "Only an Owner can manage users." }, 403);

  if (action === "list") {
    const { data, error } = await admin.from("profiles").select("user_id, email, name, role, active, created_at").order("created_at");
    if (error) return json({ error: error.message }, 400);
    const ids = new Map<string, string | null>();
    let page = 1;
    while (true) {
      const { data: u } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      for (const x of u?.users || []) ids.set(x.id, x.last_sign_in_at || null);
      if (!u || u.users.length < 200) break; page++;
    }
    return json({ users: (data || []).map((p) => ({ ...p, last_sign_in_at: ids.get(p.user_id) || null })) });
  }
  if (action === "create") {
    const email = normEmail(body.email);
    const role = body.role === "owner" ? "owner" : "staff";
    if (!email || !okPassword(body.password)) return json({ error: "Enter a login and a temporary password of at least 8 characters." }, 400);
    const { data, error } = await admin.auth.admin.createUser({ email, password: body.password, email_confirm: true, user_metadata: { name: body.name || "" } });
    if (error) return json({ error: error.message.includes("already") ? "This login already exists." : error.message }, 400);
    const { error: pe } = await admin.from("profiles").insert({ user_id: data.user.id, email, name: body.name || email, role, active: true });
    if (pe) { await admin.auth.admin.deleteUser(data.user.id); return json({ error: pe.message }, 400); }
    return json({ ok: true, user_id: data.user.id, email });
  }
  if (action === "update") {
    const id = String(body.user_id || "");
    if (!id) return json({ error: "user_id missing" }, 400);
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.role !== undefined) patch.role = body.role === "owner" ? "owner" : "staff";
    if (body.active !== undefined) patch.active = !!body.active;
    if (body.name !== undefined) patch.name = String(body.name);
    if (id === who.user.id && (patch.role === "staff" || patch.active === false)) {
      const { count } = await admin.from("profiles").select("user_id", { count: "exact", head: true }).eq("role", "owner").eq("active", true);
      if ((count || 0) <= 1) return json({ error: "You are the last Owner: make someone else Owner first." }, 400);
    }
    const { error } = await admin.from("profiles").update(patch).eq("user_id", id);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }
  if (action === "reset_password") {
    const id = String(body.user_id || "");
    if (!id || !okPassword(body.password)) return json({ error: "Enter a new password of at least 8 characters." }, 400);
    const { error } = await admin.auth.admin.updateUserById(id, { password: body.password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }
  return json({ error: "unknown_action" }, 400);
});
