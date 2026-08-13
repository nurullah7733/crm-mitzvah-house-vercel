import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * True when the signed-in person is an admin. Admin-only actions (staff
 * management, role changes, deleting or archiving records, clearing the change
 * history, integrations, undoing an import) are enforced in the database too —
 * this only keeps the buttons honest.
 */
export function useIsAdmin() {
  const { data } = useQuery({
    queryKey: ["is-admin"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_admin");
      if (error) return false;
      return data === true;
    },
  });
  return data ?? false;
}
