import type { Provenance } from "@/lib/types.ts";

const PROV_LABEL: Record<Provenance, string> = { verified: "Verified", imported: "Imported", inferred: "Inferred", missing: "Missing" };

/** Where a fact came from, shown next to it. */
export function Source({ source, provenance }: { source: string; provenance?: Provenance }) {
  const cls = provenance === "inferred" ? "pill inferred" : provenance === "missing" ? "pill missing" : "pill";
  return (
    <span className={cls} title={provenance ? `${PROV_LABEL[provenance]}: ${source}` : source}>
      {source}
      {provenance === "inferred" ? " · check" : ""}
    </span>
  );
}

export function FitTag({ fit, status }: { fit: "strong" | "possible" | null; status?: string }) {
  if (status === "not_fit") return <span className="pill red">Not a fit</span>;
  if (status && status !== "none") return <span className="pill green">{status.replace("_", " ").replace(/^./, (c) => c.toUpperCase())}</span>;
  if (fit === "strong") return <span className="pill strong" title="Strong fit: decides on operations, production or the whole company, at a company in a main industry of your profile">Strong fit</span>;
  if (fit === "possible") return <span className="pill" title="Possible fit: a decision-maker title at a company in your profile, but not operations or production, or in a lower-priority industry">Possible fit</span>;
  return null;
}

export function MatchPill({ status }: { status: string }) {
  if (status === "verified") return <span className="pill verified">PRH match</span>;
  if (status === "inferred") return <span className="pill inferred">Check match</span>;
  if (status === "pending") return <span className="pill">Looking up</span>;
  if (status === "ambiguous") return <span className="pill amber">Several in PRH</span>;
  if (status === "skipped") return <span className="pill">Not a company</span>;
  return <span className="pill amber">Not in PRH</span>;
}

export const fmt = (n: number) => n.toLocaleString("en-US");
