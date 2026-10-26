import { NextResponse } from "next/server";
import { loadNetwork } from "@/lib/network.ts";
import { recordStatus, STATUS_IDS } from "@/lib/queries.ts";
import type { Status } from "@/lib/state.ts";

/** Records what the team did, the same as MCP set_status. Nothing is sent to anyone. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { status?: Status; by?: string; note?: string; snooze_days?: number };
  if (!body.status || !(STATUS_IDS as readonly string[]).includes(body.status)) return NextResponse.json({ error: "Unknown status" }, { status: 400 });
  const r = await recordStatus(await loadNetwork(), { person_id: id, status: body.status, owner: body.by, note: body.note, snooze_days: body.snooze_days });
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.error?.startsWith("No person") ? 404 : 400 });
  return NextResponse.json({ ok: true, ...r });
}
