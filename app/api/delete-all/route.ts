import { NextResponse } from "next/server";
import { deleteAllData } from "@/lib/store.ts";
import { clearMatchMemo } from "@/lib/matching.ts";

/** Deletes every network, every decision and the PRH lookups made for them. */
export async function POST() {
  deleteAllData();
  clearMatchMemo();
  return NextResponse.json({ ok: true });
}
