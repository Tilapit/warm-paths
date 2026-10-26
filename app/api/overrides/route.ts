import { NextResponse } from "next/server";
import { getCompany, looseKey } from "@/lib/prh.ts";
import { setOverride } from "@/lib/state.ts";

/** The founder picks the right PRH company for a name, or marks it as not Finnish. Only the business ID goes to PRH. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { name?: string; businessId?: string; notFinnish?: boolean; clear?: boolean };
  if (!b.name) return NextResponse.json({ error: "Missing name" }, { status: 400 });
  const key = looseKey(b.name);
  if (b.clear) {
    setOverride(key, null);
    return NextResponse.json({ ok: true });
  }
  if (b.notFinnish) {
    setOverride(key, { name: b.name, notFinnish: true });
    return NextResponse.json({ ok: true });
  }
  const id = (b.businessId ?? "").trim();
  if (!/^\d{7}-\d$/.test(id)) return NextResponse.json({ error: "A business ID looks like 1234567-8" }, { status: 400 });
  try {
    const c = await getCompany(id);
    if (!c) return NextResponse.json({ error: `No company with business ID ${id} in PRH` }, { status: 404 });
    setOverride(key, { name: b.name, businessId: id });
    return NextResponse.json({ ok: true, company: c });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
