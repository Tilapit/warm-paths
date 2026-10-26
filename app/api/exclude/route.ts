import { NextResponse } from "next/server";
import { loadNetwork } from "@/lib/network.ts";
import { writeProfile, readProfile } from "@/lib/profile.ts";

/** Marks a company as not a target (or undoes it). Its people leave the list; nothing else changes. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { businessId?: string; name?: string; exclude?: boolean };
  if (!b.businessId || !/^\d{7}-\d$/.test(b.businessId)) return NextResponse.json({ error: "Missing business ID" }, { status: 400 });
  // Starts from the list in use, so a change to the demo's list keeps the rest of it.
  const list = (await loadNetwork()).profile.excluded ?? [];
  const rest = list.filter((x) => x.businessId !== b.businessId);
  writeProfile({ ...readProfile().profile, excluded: b.exclude ? [...rest, { businessId: b.businessId, name: String(b.name ?? b.businessId).slice(0, 120) }] : rest });
  return NextResponse.json({ ok: true });
}
