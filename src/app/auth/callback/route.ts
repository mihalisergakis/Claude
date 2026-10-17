import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { bootstrapWorkspace } from "@/lib/workspace";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const supabase = await createClient();
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.user && isAllowedEmail(data.user.email)) {
      await bootstrapWorkspace(data.user.id);
      return NextResponse.redirect(new URL("/", request.url));
    }
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/login?error=Sign-in%20failed", request.url));
}
