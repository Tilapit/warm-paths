import { NextResponse } from "next/server";
import { loadNetwork } from "@/lib/network.ts";
import { analyse } from "@/lib/analysis.ts";
import { ANGLE_MODEL, localModelId, writeAngle } from "@/lib/claude.ts";
import { readState, saveAngle } from "@/lib/state.ts";

/** One person's role and company facts, and the user's goal, go to Claude when a key is set, else to the local model when OLLAMA_MODEL is set. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const net = await loadNetwork();
  const c = net.byId.get(id);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const saved = readState().angles[id];
  if (saved) return NextResponse.json({ text: saved.text, by: saved.model.startsWith("ollama:") ? "local" : "claude" });
  const a = analyse(net, c);
  const r = await writeAngle(a, net.profile.goal);
  if (r.by !== "template") saveAngle(id, { text: r.text, at: new Date().toISOString(), model: r.by === "local" ? localModelId() : ANGLE_MODEL });
  return NextResponse.json(r);
}
