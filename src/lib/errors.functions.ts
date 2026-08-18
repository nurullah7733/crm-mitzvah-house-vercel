// Records a failure on the server so it survives the browser tab it happened in.
// Thin wrapper file: no runtime helpers at module scope.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const reportSchema = z.object({
  message: z.string().min(1).max(2000),
  detail: z.string().max(8000).optional(),
  area: z.string().max(120).optional(),
  action: z.string().max(200).optional(),
  path: z.string().max(500).optional(),
  level: z.enum(["error", "warning"]).optional(),
  userAgent: z.string().max(500).optional(),
  userEmail: z.string().max(320).optional(),
  userId: z.string().uuid().optional(),
});

export const reportAppError = createServerFn({ method: "POST" })
  .inputValidator((data) => reportSchema.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Also goes to the server log, so it shows up in runtime logs alongside crashes.
    console.error(`[app] ${data.area ?? "app"} · ${data.action ?? "failed"}: ${data.message}`);
    const { error } = await supabaseAdmin.from("app_error_log").insert({
      level: data.level ?? "error",
      area: data.area ?? null,
      action: data.action ?? null,
      message: data.message,
      detail: data.detail ?? null,
      path: data.path ?? null,
      user_agent: data.userAgent ?? null,
      user_id: data.userId ?? null,
      user_email: data.userEmail ?? null,
    });
    if (error) console.error(`[app] could not record the error: ${error.message}`);
    return { ok: !error };
  });
