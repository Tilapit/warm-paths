import { NextResponse } from "next/server";
import { matchJob } from "@/lib/matching.ts";
import { loadNetwork } from "@/lib/network.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  const net = await loadNetwork();
  return NextResponse.json({ job: matchJob(), stats: net.stats });
}
