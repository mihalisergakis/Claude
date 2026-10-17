import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { realEstateProduct } from "@/lib/products/real-estate";
import type { Product } from "@/lib/types";

/**
 * First sign-in: create the default workspace and product if they don't exist,
 * and add the user as a member. Single-user setup, so one workspace is enough.
 */
export async function bootstrapWorkspace(userId: string) {
  const admin = createAdminClient();

  const { data: membership } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (membership) return membership.workspace_id as string;

  let { data: workspace } = await admin.from("workspaces").select("id").order("created_at").limit(1).maybeSingle();
  if (!workspace) {
    const { data, error } = await admin.from("workspaces").insert({ name: "Default" }).select("id").single();
    if (error) throw error;
    workspace = data;
  }

  const { error: memberError } = await admin
    .from("workspace_members")
    .insert({ workspace_id: workspace.id, user_id: userId });
  if (memberError) throw memberError;

  const { count } = await admin
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspace.id);
  if (!count) {
    const { error } = await admin.from("products").insert({ workspace_id: workspace.id, ...realEstateProduct });
    if (error) throw error;
  }
  return workspace.id as string;
}

export interface SessionContext {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  workspaceId: string;
}

/** Signed-in user + their workspace, for pages and server actions. */
export async function requireSession(): Promise<SessionContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const workspaceId = membership?.workspace_id ?? (await bootstrapWorkspace(user.id));
  return { supabase, userId: user.id, workspaceId };
}

export async function getProducts(ctx: SessionContext): Promise<Product[]> {
  const { data, error } = await ctx.supabase
    .from("products")
    .select("*")
    .eq("workspace_id", ctx.workspaceId)
    .order("created_at");
  if (error) throw error;
  return data as Product[];
}
