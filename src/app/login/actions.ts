"use server";

import { redirect } from "next/navigation";
import { env, isAllowedEmail } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  // Same response for unknown emails so the allowlist isn't revealed.
  if (!isAllowedEmail(email)) redirect("/login?sent=1");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${env.siteUrl()}/auth/callback` },
  });
  if (error) redirect(`/login?error=${encodeURIComponent(error.message)}`);
  redirect("/login?sent=1");
}
