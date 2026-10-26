import { loadNetwork } from "@/lib/network.ts";
import { GROUP } from "@/lib/industry.ts";
import { SIGNAL_TYPES } from "@/lib/signals.ts";
import { STATUS_LABEL } from "@/lib/state.ts";
import { appUrl } from "@/lib/queries.ts";
import { postsWithin, REACTION_DAYS } from "@/lib/reactions.ts";

export const dynamic = "force-dynamic";

const q = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The list for a CRM: people at target companies, with fit and approach. No emails. */
export async function GET() {
  const net = await loadNetwork();
  const head = ["name", "linkedin_url", "title", "company", "business_id", "tol", "industry_group", "fit", "approach", "score", "known_by", "suggested_sender", "registered_changes_90d", "reacted_posts_90d", "status", "app_url"];
  const lines = net.contacts
    .filter((c) => c.rule)
    .map((c) =>
      [
        c.name,
        c.url,
        c.position,
        c.match?.company?.name ?? c.company,
        c.match?.company?.businessId ?? "",
        c.match?.company?.tol ?? "",
        GROUP[c.group].label,
        c.fit ?? "",
        c.approach,
        c.score,
        c.knownBy.map((k) => k.ownerName).join("; "),
        c.sender.ownerName,
        [...new Set(c.signals.map((s) => SIGNAL_TYPES[s.type].label))].join("; "),
        postsWithin(c, net.today, REACTION_DAYS) || "",
        STATUS_LABEL[c.status?.status ?? "none"],
        appUrl(`/people/${c.id}`),
      ]
        .map(q)
        .join(","),
    );
  return new Response([head.join(","), ...lines].join("\n") + "\n", {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="warm-paths-${net.today}.csv"` },
  });
}
