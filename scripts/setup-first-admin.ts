/**
 * Epic 6.1 — First-admin bootstrap (run ONCE by the owner, locally).
 *
 * Creates (or reuses) a Supabase Auth user and grants it an admin_users role.
 * Idempotent: safe to re-run for the same email.
 *
 * Usage (from backend/):
 *   bun scripts/setup-first-admin.ts --email owner@vyotish.com [--role admin|editor] [--password ...]
 *
 * Credentials come from the environment (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY),
 * loaded from backend/.env / .dev.vars by Bun automatically — never passed on the
 * command line and never printed. A generated password is printed exactly once
 * (stdout only) so the owner can sign in and change it.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const email = arg("email")?.trim().toLowerCase();
const role = (arg("role") ?? "admin").trim();
const password = arg("password");

if (!email || !email.includes("@")) {
  console.error("Usage: bun scripts/setup-first-admin.ts --email you@example.com [--role admin|editor] [--password ...]");
  process.exit(1);
}
if (!["admin", "editor"].includes(role)) {
  console.error(`--role must be admin or editor (got "${role}")`);
  process.exit(1);
}

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (set them in backend/.env or .dev.vars).");
  process.exit(1);
}

const authHeaders = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" };

type AdminUser = { id: string; email?: string | null };

/** Create the auth user; if it already exists, find it by listing (admin set is tiny). */
async function ensureAuthUser(): Promise<{ id: string; generatedPassword?: string }> {
  const effectivePassword = password ?? crypto.randomUUID() + "!Aa1";
  const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ email, password: effectivePassword, email_confirm: true }),
  });
  if (res.ok) {
    const body = (await res.json()) as AdminUser;
    return { id: body.id, generatedPassword: password ? undefined : effectivePassword };
  }
  const errText = await res.text();
  if (!/already.*(registered|exists)|user.*exists/i.test(errText)) {
    console.error(`Supabase user creation failed (${res.status}): ${errText.slice(0, 300)}`);
    process.exit(1);
  }
  // find the existing user
  const list = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=200`, {
    headers: authHeaders,
  });
  if (!list.ok) {
    console.error(`Could not list existing users (${list.status}).`);
    process.exit(1);
  }
  const found = ((await list.json()) as { users?: AdminUser[] }).users?.find(
    (u) => (u.email ?? "").toLowerCase() === email,
  );
  if (!found) {
    console.error("User reportedly exists but was not found in the list.");
    process.exit(1);
  }
  return { id: found.id };
}

async function grantRole(userId: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/admin_users`, {
    method: "POST",
    headers: { ...authHeaders, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, email, role }),
  });
  if (!res.ok) {
    console.error(`admin_users upsert failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    process.exit(1);
  }
}

const { id, generatedPassword } = await ensureAuthUser();
await grantRole(id);
console.log(`✓ ${email} is now ${role === "admin" ? "an admin" : "an editor"} (user_id ${id}).`);
if (generatedPassword) {
  console.log("Generated sign-in password (shown once — change it after first sign-in):");
  console.log(generatedPassword);
}
console.log("Verify with: curl -H 'Authorization: Bearer <access-token>' {SUPABASE_URL}/auth/v1/user");
