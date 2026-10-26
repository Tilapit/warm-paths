import { NextResponse } from "next/server";
import { loadNetwork } from "@/lib/network.ts";
import { analyse } from "@/lib/analysis.ts";
import { ANGLE_MODEL, writeAngle } from "@/lib/claude.ts";
import { readState, saveAngle } from "@/lib/state.ts";

/** One person's role and company facts, and the user's goal, go to Claude, only when a key is set. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const net = await loadNetwork();
  const c = net.byId.get(id);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const saved = readState().angles[id];
  if (saved) return NextResponse.json({ text: saved.text, by: "claude" });
  const a = analyse(net, c);
  const r = await writeAngle(a, net.profile.goal);
  if (r.by === "claude") saveAngle(id, { text: r.text, at: new Date().toISOString(), model: ANGLE_MODEL });
  return NextResponse.json(r);
}
