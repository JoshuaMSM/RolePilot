import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Cross-origin agent settings changes are not allowed." }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  const userId = typeof auth?.claims?.sub === "string" ? auth.claims.sub : null;
  if (authError || !userId) return NextResponse.json({ error: "Sign in to change agent settings." }, { status: 401 });

  let body: { desiredEnabled?: unknown; confirmStop?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (typeof body.desiredEnabled !== "boolean") return NextResponse.json({ error: "Choose whether the agent should be enabled." }, { status: 400 });

  const { data: current, error: readError } = await supabase.from("agent_settings")
    .select("runtime_status").eq("user_id", userId).maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: "Agent settings are missing. Apply the Supabase migrations first." }, { status: 409 });
  if (!body.desiredEnabled && current.runtime_status === "RUNNING" && body.confirmStop !== true) {
    return NextResponse.json({ error: "The agent is running. Confirm that it should stop after its current safe checkpoint.", confirmationRequired: true }, { status: 409 });
  }

  const { error: updateError } = await supabase.from("agent_settings").update({
    desired_enabled: body.desiredEnabled,
    ...(!body.desiredEnabled && current.runtime_status !== "RUNNING" ? { runtime_status: "DISABLED" } : {}),
  }).eq("user_id", userId);
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
  return NextResponse.json({ desiredEnabled: body.desiredEnabled });
}
