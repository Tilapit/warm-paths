import { NextResponse } from "next/server";
import { loadNetwork } from "@/lib/network.ts";
import { addReactions } from "@/lib/queries.ts";
import { deletePost, listPosts } from "@/lib/state.ts";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ posts: listPosts() });
}

/**
 * Pasted reactions to one post. `save: false` matches only (the review step);
 * `save: true` stores the matches and the picks. Unmatched names are returned
 * and never stored.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { post?: string; postDate?: string; author?: string; copiedBy?: string; text?: string; picks?: { name: string; person_id: string }[]; save?: boolean };
  if (!b.text?.trim() && !b.picks?.length) return NextResponse.json({ error: "Paste the reactions list first." }, { status: 400 });
  if ((b.text?.length ?? 0) > 500_000) return NextResponse.json({ error: "That is more text than a reactions list." }, { status: 400 });
  const r = addReactions(await loadNetwork(), { post: b.post ?? "", postDate: b.postDate, author: b.author, copiedBy: b.copiedBy, text: b.text, picks: b.picks, save: !!b.save });
  console.log(`[reactions] ${new Date().toISOString()} ${b.save ? "saved" : "matched"} ${r.matched.length} matched, ${r.review.length} to review, ${r.unmatched.length} unmatched`);
  return NextResponse.json(r);
}

export async function DELETE(req: Request) {
  const u = new URL(req.url);
  const post = u.searchParams.get("post");
  if (!post) return NextResponse.json({ error: "Missing post" }, { status: 400 });
  deletePost(post, u.searchParams.get("date") ?? undefined);
  return NextResponse.json({ ok: true });
}
