import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { processJobs } from "@/lib/jobs/runner";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;

// Vercel Cron calls this with "Authorization: Bearer <CRON_SECRET>".
export async function GET(request: NextRequest) {
  if (request.headers.get("authorization") !== `Bearer ${env.cronSecret()}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await processJobs(createAdminClient());
  return NextResponse.json(summary);
}
