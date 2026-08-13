// Staff onboarding: one action creates the login account and the staff row,
// links them, and assigns the role. Thin wrapper file — logic stays in handlers.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type StaffAccountStatus = "active" | "invited" | "no_account" | "disabled";

export type StaffEntry = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "marketing" | "va";
  active: boolean;
  user_id: string | null;
  status: StaffAccountStatus;
  lastSignInAt: string | null;
};

const roleSchema = z.enum(["admin", "marketing", "va"]);

/** Only an admin may see or change who can sign in. */
async function assertAdmin(context: { supabase: { rpc: (fn: "is_admin") => PromiseLike<{ data: unknown }> } }) {
  const { data } = await context.supabase.rpc("is_admin");
  if (data !== true) throw new Error("Only an admin can manage staff.");
}

export const listStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StaffEntry[]> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { listStaffWithStatus } = await import("./staff.server");
    return listStaffWithStatus(supabaseAdmin);
  });

export const inviteStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        name: z.string().trim().min(1),
        email: z.string().trim().email(),
        role: roleSchema,
        redirectTo: z.string().url(),
      })
      .parse(data),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { inviteStaffMember } = await import("./staff.server");
    return inviteStaffMember(supabaseAdmin, data);
  });

export const resendStaffInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ staffId: z.string().uuid(), redirectTo: z.string().url() }).parse(data),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resendInvite } = await import("./staff.server");
    return resendInvite(supabaseAdmin, data.staffId, data.redirectTo);
  });

export const setStaffRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ staffId: z.string().uuid(), role: roleSchema }).parse(data))
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { changeRole } = await import("./staff.server");
    return changeRole(supabaseAdmin, data.staffId, data.role);
  });

export const removeStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ staffId: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    if (context.userId) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { disableStaff } = await import("./staff.server");
      return disableStaff(supabaseAdmin, data.staffId, context.userId);
    }
    throw new Error("Could not identify the signed-in admin.");
  });

export const restoreStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ staffId: z.string().uuid() }).parse(data))
  .handler(async ({ context, data }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { enableStaff } = await import("./staff.server");
    return enableStaff(supabaseAdmin, data.staffId);
  });
