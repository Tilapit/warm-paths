import { NextResponse } from "next/server";
import { loadNetwork } from "@/lib/network.ts";
import { messageContext } from "@/lib/queries.ts";
import { writeDraft, writer } from "@/lib/claude.ts";
import type { MessageType } from "@/lib/voice.ts";

export const dynamic = "force-dynamic";

/**
 * "Draft here": a message drafted by Claude from message_context when
 * ANTHROPIC_API_KEY is set, else by the local model when OLLAMA_MODEL is set,
 * otherwise the app's template. The person's name is replaced before sending
 * and put back locally; the signature is added here, never sent. A local
 * draft that uses anything not in the facts is replaced by the template.
 * Nothing is sent to the person: the team copies the draft.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { type } = (await req.json().catch(() => ({}))) as { type?: MessageType };
  const net = await loadNetwork();
  const c = net.byId.get(id);
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ctx = messageContext(net, { person_id: id, type })!;
  // No API key: the app's own draft, with the profile's ask and signature.
  const w = writer();
  if (w === "template") return NextResponse.json({ text: ctx.template, model: "template", type: ctx.type, sender: ctx.sender });
  const r = await writeDraft(ctx, { name: c.name, sender: c.sender.ownerName, owners: net.owners.map((o) => o.name) });
  console.log(`[draft] ${new Date().toISOString()} ${id} ${w} ${"error" in r ? "failed" : "ok"}`);
  if ("error" in r) return w === "local" ? NextResponse.json({ text: ctx.template, model: "template", type: ctx.type, sender: ctx.sender, note: `${r.error} Showing the template instead.` }) : NextResponse.json(r, { status: 400 });
  const sign = net.profile.signature.trim();
  return NextResponse.json({ ...r, text: sign && !r.text.endsWith(sign) ? `${r.text}\n\n${sign}` : r.text, type: ctx.type, sender: ctx.sender });
}
