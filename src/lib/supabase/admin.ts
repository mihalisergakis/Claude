import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/** Service-role client for background jobs and bootstrap. Bypasses RLS: server-only. */
export function createAdminClient() {
  return createClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
