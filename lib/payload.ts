// What the person view gets: the analysis plus who writes the angle and drafts (Claude, the local model or templates).
import { analyse } from "./analysis.ts";
import { writer } from "./claude.ts";
import { ollamaModel } from "./ollama.ts";
import { readState } from "./state.ts";
import type { Network } from "./network.ts";
import { claudePrompt, cooldownText, statusMeaning } from "./queries.ts";

export function personPayload(net: Network, id: string) {
  const c = net.byId.get(id);
  if (!c) return null;
  const saved = readState().angles[id];
  return {
    ...analyse(net, c),
    writer: writer(),
    localModel: ollamaModel() || undefined,
    savedAngle: saved?.text,
    savedAngleBy: saved ? (saved.model.startsWith("ollama:") ? ("local" as const) : ("claude" as const)) : undefined,
    owners: net.owners.map((o) => ({ id: o.id, name: o.name })),
    prompt: claudePrompt(c),
    // What the team's status means for recommendations, and a colleague just contacted.
    meaning: statusMeaning(c),
    statusNote: c.status?.note,
    cooldown: cooldownText(c) || undefined,
  };
}
