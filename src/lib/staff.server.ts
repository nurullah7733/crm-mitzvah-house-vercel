// Server-only staff onboarding logic. Uses the admin client, so it must never
// be reachable from the browser — the .server.ts filename enforces that.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { StaffEntry, StaffAccountStatus } from "./staff.functions";

type Admin = SupabaseClient<Database>;
type Role = "admin" | "marketing" | "va";

/** Never expires; used to lock someone out without deleting their history. */
const FOREVER = "876000h";

type AuthUser = {
  id: string;
  email?: string | null;
  last_sign_in_at?: string | null;
  banned_until?: string | null;
};

async function allAuthUsers(admin: Admin): Promise<AuthUser[]> {
  const users: AuthUser[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    users.push(...((data.users ?? []) as AuthUser[]));
    if ((data.users ?? []).length < 200) break;
  }
  return users;
}

function isBanned(user: AuthUser | undefined) {
  if (!user?.banned_until) return false;
  return new Date(user.banned_until).getTime() > Date.now();
}

/**
 * Emails a fresh link that lets someone set a password and get in, whatever
 * state their account is in. Any earlier unused link stops working, because
 * Supabase only honours the newest token for an email address.
 *
 * A brand-new or never-used account gets an invite email. An account that has
 * been signed into (or that Supabase already treats as confirmed) gets a
 * password-set email instead, since invites can only be issued once.
 */
async function sendAccessEmail(
  admin: Admin,
  input: { email: string; name?: string; redirectTo: string; user?: AuthUser },
): Promise<{ mode: "invite" | "password_link"; userId: string }> {
  const email = input.email.trim().toLowerCase();
  let user = input.user;

  // Never used? Clear the stale account out so a real invite can be sent again.
  if (user && !user.last_sign_in_at) {
    await admin.auth.admin.deleteUser(user.id);
    user = undefined;
  }

  if (!user) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: input.redirectTo,
      ...(input.name ? { data: { name: input.name } } : {}),
    });
    if (!error && data?.user) return { mode: "invite", userId: data.user.id };

    // The address may still exist behind the scenes; fall through to a
    // password-set email rather than failing.
    const again = (await allAuthUsers(admin)).find((u) => u.email?.toLowerCase() === email);
    if (!again)
      throw new Error(`Could not send the invite: ${error?.message ?? "unknown problem"}`);
    user = again;
  }

  // Unlock first, otherwise the link lands on a blocked account.
  if (isBanned(user)) {
    await admin.auth.admin.updateUserById(user.id, { ban_duration: "none" });
  }
  await admin.auth.admin.updateUserById(user.id, { email_confirm: true });

  const publicClient = createClient<Database>(
    process.env["SUPABASE_URL"]!,
    process.env["SUPABASE_PUBLISHABLE_KEY"]!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
  const { error: mailError } = await publicClient.auth.resetPasswordForEmail(email, {
    redirectTo: input.redirectTo,
  });
  if (mailError) throw new Error(`Could not email the sign-in link: ${mailError.message}`);
  return { mode: "password_link", userId: user.id };
}

function statusFor(row: { active: boolean }, user: AuthUser | undefined): StaffAccountStatus {
  if (!user) return "no_account";
  if (!row.active || isBanned(user)) return "disabled";
  return user.last_sign_in_at ? "active" : "invited";
}

export async function listStaffWithStatus(admin: Admin): Promise<StaffEntry[]> {
  const { data: rows, error } = await admin.from("staff_members").select("*").order("name");
  if (error) throw error;
  const users = await allAuthUsers(admin);
  const byId = new Map(users.map((u) => [u.id, u]));
  const byEmail = new Map(users.filter((u) => u.email).map((u) => [u.email!.toLowerCase(), u]));

  const entries: StaffEntry[] = [];
  for (const row of rows ?? []) {
    let user = row.user_id ? byId.get(row.user_id) : undefined;
    if (!user) user = byEmail.get(row.email.toLowerCase());
    // Heal older rows that were created before accounts were linked.
    if (user && row.user_id !== user.id) {
      await admin.from("staff_members").update({ user_id: user.id }).eq("id", row.id);
    }
    entries.push({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role as Role,
      active: row.active,
      user_id: user?.id ?? null,
      status: statusFor(row, user),
      lastSignInAt: user?.last_sign_in_at ?? null,
    });
  }
  return entries;
}

async function applyRole(admin: Admin, userId: string, role: Role) {
  await admin.from("user_roles").delete().eq("user_id", userId);
  const { error } = await admin.from("user_roles").insert({ user_id: userId, role });
  if (error) throw error;
  // Keep the role on the token's app metadata too, so it is visible to auth.
  await admin.auth.admin.updateUserById(userId, { app_metadata: { role } });
}

/** Creates the login account and the staff row together, then links them. */
export async function inviteStaffMember(
  admin: Admin,
  input: { name: string; email: string; role: Role; redirectTo: string },
) {
  const email = input.email.trim().toLowerCase();
  const users = await allAuthUsers(admin);
  const existingUser = users.find((u) => u.email?.toLowerCase() === email);
  const sent = await sendAccessEmail(admin, {
    email,
    name: input.name,
    redirectTo: input.redirectTo,
    ...(existingUser ? { user: existingUser } : {}),
  });
  const userId = sent.userId;

  const { data: existing } = await admin
    .from("staff_members")
    .select("id")
    .ilike("email", email)
    .maybeSingle();

  if (existing) {
    const { error } = await admin
      .from("staff_members")
      .update({ name: input.name, role: input.role, active: true, user_id: userId })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await admin
      .from("staff_members")
      .insert({ name: input.name, email, role: input.role, active: true, user_id: userId });
    if (error) throw error;
  }

  await applyRole(admin, userId, input.role);
  return {
    invited: sent.mode === "invite",
    alreadyHadAccount: sent.mode === "password_link",
    mode: sent.mode,
  };
}

export async function resendInvite(admin: Admin, staffId: string, redirectTo: string) {
  const { data: row, error } = await admin
    .from("staff_members")
    .select("*")
    .eq("id", staffId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("That staff member no longer exists.");

  // Works whatever their status says, and always cancels the previous link.
  return inviteStaffMember(admin, {
    name: row.name,
    email: row.email.toLowerCase(),
    role: row.role as Role,
    redirectTo,
  });
}

export async function changeRole(admin: Admin, staffId: string, role: Role) {
  const { data: userId, error } = await admin.rpc("change_staff_role", {
    _staff_id: staffId,
    _role: role,
  });
  if (error) throw error;
  if (userId) {
    const { error: authError } = await admin.auth.admin.updateUserById(userId, {
      app_metadata: { role },
    });
    if (authError) throw authError;
  }
  return { ok: true };
}

/** Removing someone locks their login instead of quietly leaving it open. */
export async function disableStaff(admin: Admin, staffId: string, actingUserId: string) {
  const { data: row, error } = await admin
    .from("staff_members")
    .select("*")
    .eq("id", staffId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return { ok: true };
  if (row.user_id && row.user_id === actingUserId) {
    throw new Error("You cannot remove your own access.");
  }

  // Both database representations change in one transaction. A last-admin
  // rejection rolls both back and prevents the subsequent Auth ban.
  const { data: deactivatedUserId, error: deactivateError } = await admin.rpc(
    "deactivate_staff_member",
    {
      _staff_id: staffId,
    },
  );
  if (deactivateError) throw deactivateError;

  if (deactivatedUserId)
    await admin.auth.admin.updateUserById(deactivatedUserId, { ban_duration: FOREVER });
  return { ok: true };
}

export async function enableStaff(admin: Admin, staffId: string) {
  const { data: row, error } = await admin
    .from("staff_members")
    .update({ active: true })
    .eq("id", staffId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (row?.user_id) {
    await admin.auth.admin.updateUserById(row.user_id, { ban_duration: "none" });
    await applyRole(admin, row.user_id, row.role as Role);
  }
  return { ok: true };
}

/**
 * Fully removes someone: the staff row, their role, and the login account —
 * so the same email address can be invited again later.
 */
export async function deleteStaffMember(admin: Admin, staffId: string, actingUserId: string) {
  const { data: row, error } = await admin
    .from("staff_members")
    .select("*")
    .eq("id", staffId)
    .maybeSingle();
  if (error) throw error;
  if (!row) return { ok: true, email: null };
  if (row.user_id && row.user_id === actingUserId) {
    throw new Error("You cannot remove your own access.");
  }

  const email = row.email.toLowerCase();
  const users = await allAuthUsers(admin);
  const user =
    (row.user_id ? users.find((u) => u.id === row.user_id) : undefined) ??
    users.find((u) => u.email?.toLowerCase() === email);

  if (user) {
    if (user.id === actingUserId) throw new Error("You cannot remove your own access.");
    await admin.from("user_roles").delete().eq("user_id", user.id);
    const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteUserError) {
      throw new Error(`Could not remove their login: ${deleteUserError.message}`);
    }
  }

  const { error: deleteRowError } = await admin.from("staff_members").delete().eq("id", staffId);
  if (deleteRowError) throw deleteRowError;
  return { ok: true, email };
}
