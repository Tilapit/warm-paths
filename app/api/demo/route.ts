import { NextResponse } from "next/server";
import { loadDemoWithReactions } from "@/lib/demo.ts";
import { ensureMatching, loadNetwork } from "@/lib/network.ts";

/** One click: the three invented demo networks and two posts' reactions. */
export async function POST() {
  const owners = await loadDemoWithReactions();
  ensureMatching(await loadNetwork());
  return NextResponse.json({ owners });
}
