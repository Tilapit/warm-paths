import { NextResponse } from "next/server";
import { loadNetwork } from "@/lib/network.ts";
import { ollamaEnabled } from "@/lib/ollama.ts";
import { readProfile } from "@/lib/profile.ts";
import { suggestProfile } from "@/lib/suggest-profile.ts";

export const dynamic = "force-dynamic";

/**
 * Profile suggestions from the local model, from the goal as typed (only the
 * goal is sent). Saves nothing: the user picks what goes into the form.
 */
export async function POST(req: Request) {
  if (!ollamaEnabled()) return NextResponse.json({ error: "No local model: set OLLAMA_MODEL in .env.local." }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as { goal?: unknown };
  const { profile } = readProfile();
  const goal = typeof b.goal === "string" ? b.goal.slice(0, 1000) : profile.goal;
  const net = await loadNetwork();
  // Never suggested: a name of someone in the networks, a teammate or a company.
  const names = [...net.contacts.flatMap((c) => [c.name, c.company]), ...net.owners.map((o) => o.name)];
  const r = await suggestProfile(goal, { profile, names });
  console.log(`[suggest] ${new Date().toISOString()} ${"error" in r ? "failed" : "ok"}`);
  return "error" in r ? NextResponse.json(r, { status: 502 }) : NextResponse.json(r);
}
