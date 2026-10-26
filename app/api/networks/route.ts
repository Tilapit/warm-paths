import { NextResponse } from "next/server";
import { deleteOwner, importNetwork } from "@/lib/store.ts";
import { ensureMatching, loadNetwork } from "@/lib/network.ts";
import { lookupEstimate } from "@/lib/matching.ts";
import { parseConnections } from "@/lib/ingest.ts";
import { pruneState } from "@/lib/state.ts";

export const dynamic = "force-dynamic";

/** One owner's LinkedIn Connections.csv. Stored on this machine only. */
export async function POST(req: Request) {
  const fd = await req.formData();
  const file = fd.get("file");
  const owner = String(fd.get("owner") ?? "You");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a Connections.csv file." }, { status: 400 });
  if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "File is over 20 MB. Is this the Connections.csv from LinkedIn's export?" }, { status: 400 });
  try {
    const text = await file.text();
    const o = importNetwork(owner, text, { original: file.name });
    // Counted before the lookups start, so it says what is left to do.
    const estimate = await lookupEstimate(parseConnections(text).records.map((r) => r.company), { demo: o.demo });
    ensureMatching(await loadNetwork());
    return NextResponse.json({ owner: o, estimate });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

/** Removes one owner's connections and anything derived only from them. */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  deleteOwner(id);
  const net = await loadNetwork();
  pruneState(new Set(net.contacts.map((c) => c.id)));
  return NextResponse.json({ ok: true });
}
