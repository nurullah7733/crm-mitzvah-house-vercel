import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { disableStaff } from "../staff.server";

const migration = readFileSync(
  "supabase/migrations/20260825000300_protect_last_admin.sql",
  "utf8",
);
const staffServer = readFileSync("src/lib/staff.server.ts", "utf8");

describe("database last-admin safeguard", () => {
  it("protects role/demotion, deactivation, unlinking and deletion on both role stores", () => {
    expect(migration).toContain("AFTER UPDATE OF role, active, user_id, email OR DELETE");
    expect(migration).toContain("AFTER UPDATE OF user_id, role OR DELETE");
    expect(migration).toContain("sm.active");
    expect(migration).toContain("sm.role = 'admin'");
    expect(migration).toContain("ur.role = 'admin'");
    expect(migration).toContain("v_admin_count = 0");
  });

  it("serializes concurrent admin-removing transactions", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("CREATE TRIGGER staff_members_last_admin_lock");
    expect(migration).toContain("CREATE TRIGGER user_roles_last_admin_lock");
    expect(migration).toContain("BEFORE UPDATE OF role, active, user_id, email OR DELETE");
    expect(migration).toContain("BEFORE UPDATE OF user_id, role OR DELETE");
    const validator = migration.slice(
      migration.indexOf("CREATE FUNCTION public.enforce_effective_admin_remains()"),
      migration.indexOf("REVOKE ALL ON FUNCTION public.enforce_effective_admin_remains()"),
    );
    expect(validator).not.toContain("pg_advisory_xact_lock");
  });

  it("cannot be bypassed by service_role or called directly by clients", () => {
    expect(migration).toContain("CREATE TRIGGER staff_members_last_admin_guard");
    expect(migration).toContain("CREATE TRIGGER user_roles_last_admin_guard");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.enforce_effective_admin_remains\(\)[\s\S]*FROM PUBLIC, anon, authenticated/,
    );
  });

  it("keeps the existing JWT-email fallback independent of user_roles population", () => {
    expect(migration).toContain("lower(sm.email) = lower(u.email)");
    expect(migration).toMatch(/WHERE EXISTS \([\s\S]*public\.user_roles[\s\S]*\)\s*OR EXISTS \(/);
  });

  it("rejects only the zero-admin result, leaving valid multi-admin changes available", () => {
    expect(migration).toContain("IF v_admin_count = 0 THEN");
    expect(migration).not.toContain("v_admin_count <= 1");
  });
});

describe("existing-admin access regression", () => {
  it("assigns a role only to the intended Auth user", () => {
    const applyRole = staffServer.slice(
      staffServer.indexOf("async function applyRole"),
      staffServer.indexOf("export async function inviteStaffMember"),
    );
    expect(applyRole).toContain('.eq("user_id", userId)');
    expect(applyRole).toContain("insert({ user_id: userId, role })");
    expect(applyRole).not.toContain("delete().neq");
  });

  it("does not make the staff fallback conditional on user_roles being empty", () => {
    const authorizationMigration = readFileSync(
      "supabase/migrations/20260813012156_d03e29f1-ada6-4ca6-9c93-86406e73ba01.sql",
      "utf8",
    );
    const isAdmin = authorizationMigration.slice(
      authorizationMigration.indexOf("CREATE OR REPLACE FUNCTION public.is_admin()"),
      authorizationMigration.indexOf("REVOKE EXECUTE ON FUNCTION public.is_admin()"),
    );
    expect(isAdmin).toMatch(/public\.user_roles[\s\S]*\bOR EXISTS\s*\([\s\S]*public\.staff_members/);
    expect(isAdmin).not.toMatch(/NOT EXISTS\s*\([\s\S]*public\.user_roles/);
  });
});

describe("disableStaff ordering", () => {
  it("uses one database RPC and does not ban Auth when it is rejected", async () => {
    const ban = vi.fn();
    const protectedError = new Error("The last active administrator cannot be removed or demoted");
    const rpc = vi.fn(async () => ({ data: null, error: protectedError }));
    const admin = {
      from: vi.fn((table: string) => {
        if (table !== "staff_members") throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: "staff-b", user_id: "user-b", active: true, role: "admin" },
                error: null,
              }),
            }),
          }),
        };
      }),
      rpc,
      auth: { admin: { updateUserById: ban } },
    };

    await expect(disableStaff(admin as never, "staff-b", "user-a")).rejects.toBe(
      protectedError,
    );
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("deactivate_staff_member", { _staff_id: "staff-b" });
    expect(ban).not.toHaveBeenCalled();
  });

  it("keeps staff deactivation and role removal in one PostgreSQL transaction", () => {
    const rpc = migration.slice(
      migration.indexOf("CREATE FUNCTION public.deactivate_staff_member"),
      migration.indexOf("REVOKE ALL ON FUNCTION public.deactivate_staff_member"),
    );
    expect(rpc).toContain("FOR UPDATE");
    expect(rpc).toContain("UPDATE public.staff_members");
    expect(rpc).toContain("SET active = false");
    expect(rpc).toContain("DELETE FROM public.user_roles");
    expect(rpc).not.toMatch(/EXCEPTION\s+WHEN/);
  });

  it("bans the locked target returned by a successful non-final-admin RPC", async () => {
    const ban = vi.fn(async () => ({ data: {}, error: null }));
    const rpc = vi.fn(async () => ({ data: "user-b", error: null }));
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "staff-b", user_id: "stale-user", active: true, role: "admin" },
              error: null,
            }),
          }),
        }),
      }),
      rpc,
      auth: { admin: { updateUserById: ban } },
    };

    await expect(disableStaff(admin as never, "staff-b", "user-a")).resolves.toEqual({ ok: true });
    expect(ban).toHaveBeenCalledWith("user-b", { ban_duration: "876000h" });
  });

  it("preserves self-disable protection before any mutation", async () => {
    const update = vi.fn();
    const ban = vi.fn();
    const admin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: "staff-a", user_id: "user-a", active: true, role: "admin" },
              error: null,
            }),
          }),
        }),
        update,
      }),
      rpc: vi.fn(),
      auth: { admin: { updateUserById: ban } },
    };

    await expect(disableStaff(admin as never, "staff-a", "user-a")).rejects.toThrow(
      "You cannot remove your own access.",
    );
    expect(update).not.toHaveBeenCalled();
    expect(ban).not.toHaveBeenCalled();
  });

  it("preserves the independent self-delete protection", () => {
    const deletion = staffServer.slice(staffServer.indexOf("export async function deleteStaffMember"));
    expect(deletion).toContain("row.user_id === actingUserId");
    expect(deletion).toContain("user.id === actingUserId");
    expect(deletion).toContain("You cannot remove your own access.");
  });
});
