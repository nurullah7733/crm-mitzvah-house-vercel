// Server-only staff onboarding logic. Uses the admin client, so it must never
// be reachable from the browser — the .server.ts filename enforces that.
import type { SupabaseClient } from "@supabase/supabase-js";
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
  let user = users.find((u) => u.email?.toLowerCase() === email);
  let invited = false;

  if (!user) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: input.redirectTo,
      data: { name: input.name },
    });
    if (error) throw new Error(`Could not send the invite: ${error.message}`);
    user = data.user as AuthUser;
    invited = true;
  } else if (isBanned(user)) {
    await admin.auth.admin.updateUserById(user.id, { ban_duration: "none" });
  }

  const { data: existing } = await admin
    .from("staff_members")
    .select("id")
    .ilike("email", email)
    .maybeSingle();

  if (existing) {
    const { error } = await admin
      .from("staff_members")
      .update({ name: input.name, role: input.role, active: true, user_id: user.id })
      .eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await admin
      .from("staff_members")
      .insert({ name: input.name, email, role: input.role, active: true, user_id: user.id });
    if (error) throw error;
  }

  await applyRole(admin, user.id, input.role);
  return { invited, alreadyHadAccount: !invited };
}

export async function resendInvite(admin: Admin, staffId: string, redirectTo: string) {
  const { data: row, error } = await admin
    .from("staff_members")
    .select("*")
    .eq("id", staffId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("That staff member no longer exists.");

  const email = row.email.toLowerCase();
  const users = await allAuthUsers(admin);
  const user = users.find((u) => u.email?.toLowerCase() === email);

  // Someone who never signed in gets a fresh invite; deleting the unused
  // account first is what lets Supabase send the invite again.
  if (user && !user.last_sign_in_at) {
    await admin.auth.admin.deleteUser(user.id);
  } else if (user) {
    throw new Error("That person has already signed in — send them a password reset instead.");
  }

  return inviteStaffMember(admin, {
    name: row.name,
    email,
    role: row.role as Role,
    redirectTo,
  });
}

export async function changeRole(admin: Admin, staffId: string, role: Role) {
  const { data: row, error } = await admin
    .from("staff_members")
    .update({ role })
    .eq("id", staffId)
    .select("user_id")
    .maybeSingle();
  if (error) throw error;
  if (row?.user_id) await applyRole(admin, row.user_id, role);
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

  if (row.user_id) {
    await admin.auth.admin.updateUserById(row.user_id, { ban_duration: FOREVER });
    await admin.from("user_roles").delete().eq("user_id", row.user_id);
  }
  const { error: updateError } = await admin
    .from("staff_members")
    .update({ active: false })
    .eq("id", staffId);
  if (updateError) throw updateError;
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