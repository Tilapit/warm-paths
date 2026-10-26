import { NextResponse } from "next/server";
import { deleteEngaged } from "@/lib/state.ts";

export const dynamic = "force-dynamic";

/** Deletes one engaged person (?id=e-…) or everyone (?all=1). */
export async function DELETE(req: Request) {
  const u = new URL(req.url);
  const id = u.searchParams.get("id");
  if (!id && u.searchParams.get("all") !== "1") return NextResponse.json({ error: "Missing id" }, { status: 400 });
  if (id && !/^e-[0-9a-f]{8}$/.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  deleteEngaged(id ?? undefined);
  console.log(`[engaged] ${new Date().toISOString()} deleted ${id ?? "all"}`);
  return NextResponse.json({ ok: true });
}
