// The demo in one call: the three invented networks, two posts' worth of
// pasted reactions (data/demo/reactions), so the reactions show out of the
// box, and two of the demo team's own status records (a follow-up due, a
// colleague contacted). The demo's invented profile, with the large groups it
// marks as not a target, is data/demo/profile.json (lib/profile.ts).
import fs from "node:fs";
import path from "node:path";
import { loadDemo, type Owner } from "./store.ts";
import { loadNetwork } from "./network.ts";
import { addReactions } from "./queries.ts";
import { readState, setStatus, type StatusChange } from "./state.ts";

const demoDir = () => process.env.DEMO_DIR || path.join(process.cwd(), "data", "demo");

export async function seedDemoReactions(): Promise<number> {
  let saved = 0;
  try {
    const dir = path.join(demoDir(), "reactions");
    const posts = JSON.parse(fs.readFileSync(path.join(dir, "posts.json"), "utf8")) as { file: string; label: string; date: string; author: string }[];
    for (const p of posts) {
      const net = await loadNetwork();
      saved += addReactions(net, { post: p.label, postDate: p.date, author: p.author, text: fs.readFileSync(path.join(dir, p.file), "utf8") }).saved;
    }
  } catch {
    // No reaction fixtures: the demo works without them.
  }
  return saved;
}

/**
 * The demo team's status records (data/demo/statuses.json), with their
 * original dates. Someone who already has a status keeps it. Returns how
 * many were added.
 */
export function seedDemoStatuses(): number {
  let list: { id: string; history: StatusChange[] }[] = [];
  try {
    list = JSON.parse(fs.readFileSync(path.join(demoDir(), "statuses.json"), "utf8")).statuses;
  } catch {
    return 0;
  }
  const have = readState().status;
  let added = 0;
  for (const p of list) {
    if (have[p.id] || !p.history?.length) continue;
    for (const h of p.history) setStatus(p.id, h.status, h.by, { at: h.at, note: h.note, until: h.until });
    added++;
  }
  return added;
}

export async function loadDemoWithReactions(): Promise<Owner[]> {
  const owners = loadDemo();
  seedDemoStatuses();
  await seedDemoReactions();
  return owners;
}
