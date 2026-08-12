import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { setSessionActor } from "@/lib/session-log";

/** Who is using the CRM right now — matched to a staff member by email. */
export function useCurrentStaff() {
  const { data } = useQuery({
    queryKey: ["current-staff"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const email = auth.user?.email ?? "";
      if (!email) return null;
      const { data: staff } = await supabase
        .from("staff_members")
        .select("name, role, email")
        .ilike("email", email)
        .maybeSingle();
      const fallback = (email.split("@")[0] ?? "").replace(/[._-]+/g, " ");
      const name = staff?.name?.trim() || fallback.replace(/\b\w/g, (c) => c.toUpperCase());
      return { name, role: staff?.role ?? null, email };
    },
  });

  useEffect(() => {
    if (data?.name) setSessionActor(data.name);
  }, [data?.name]);

  return data ?? null;
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
