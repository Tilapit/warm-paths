import { NextResponse } from "next/server";
import { loadNetwork } from "@/lib/network.ts";
import { personPayload } from "@/lib/payload.ts";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = personPayload(await loadNetwork(), id);
  return p ? NextResponse.json(p) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
