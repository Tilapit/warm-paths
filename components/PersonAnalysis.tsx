"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Analysis } from "@/lib/analysis.ts";
import { FitTag, Source } from "./ui";
import { WriteInClaude } from "./WriteInClaude";

const STATUSES = [
  { id: "to_contact", label: "To contact" },
  { id: "sent", label: "Sent" },
  { id: "replied", label: "Replied" },
  { id: "meeting", label: "Meeting" },
  { id: "not_fit", label: "Not a fit" },
  { id: "snoozed", label: "Snooze 90 days" },
];

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const month = (iso: string) => (iso ? `${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : "date unknown");
const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;
const LABEL: Record<string, string> = { to_contact: "To contact", sent: "Sent", replied: "Replied", meeting: "Meeting", not_fit: "Not a fit", snoozed: "Snoozed" };

export type PersonPayload = Analysis & { writer: "claude" | "local" | "template"; localModel?: string; savedAngle?: string; savedAngleBy?: "claude" | "local"; owners: { id: string; name: string }[]; prompt: string; meaning: string; statusNote?: string; cooldown?: string };

export function PersonAnalysis({ data, onBack, backLabel = "All", standalone }: { data: PersonPayload; onBack?: () => void; backLabel?: string; standalone?: boolean }) {
  const router = useRouter();
  const [status, setStatus] = useState(data.status);
  const [statusBy, setStatusBy] = useState(data.statusBy);
  const [statusAt, setStatusAt] = useState(data.statusAt);
  const [meaning, setMeaning] = useState(data.meaning);
  const savedAngle = () => (data.savedAngle ? { text: data.savedAngle, by: data.savedAngleBy ?? "claude" } : { text: data.angle.text, by: "template" });
  const [angle, setAngle] = useState<{ text: string; by: string; error?: string }>(savedAngle);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ text?: string; model?: string; error?: string; note?: string; busy?: boolean }>({});
  const local = data.localModel ? `the local model (${data.localModel})` : "the local model";
  const shown = useRef(data.id);
  shown.current = data.id;
  const by = data.owners.find((o) => o.id === data.knownBy[0]?.owner)?.name ?? data.owners[0]?.name ?? "You";

  useEffect(() => {
    setStatus(data.status);
    setStatusBy(data.statusBy);
    setStatusAt(data.statusAt);
    setMeaning(data.meaning);
    setAngle(savedAngle());
    setDraft({});
    if (data.writer !== "template" && !data.savedAngle && data.fit) {
      let live = true;
      fetch(`/api/people/${data.id}/angle`, { method: "POST" })
        .then((r) => r.json())
        .then((a) => live && setAngle(a))
        .catch(() => {});
      return () => {
        live = false;
      };
    }
  }, [data]);

  async function save(next: string) {
    setBusy(true);
    const s = next === status ? "none" : next;
    const r = await fetch(`/api/people/${data.id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: s, by }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      setStatus(s as Analysis["status"]);
      setStatusBy(j.by ?? by);
      setStatusAt(j.at);
      setMeaning(j.means);
      // This week and the lists follow the team's statuses.
      router.refresh();
    }
    setBusy(false);
  }

  async function draftHere() {
    const id = data.id;
    setDraft({ busy: true });
    const r = await fetch(`/api/people/${id}/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    const j = await r.json().catch(() => ({ error: "Failed" }));
    // Another person may be open by now: their panel must not get this draft.
    if (shown.current !== id) return;
    setDraft(r.ok ? { text: j.text, model: j.model, note: j.note } : { error: j.error ?? "Failed" });
  }

  const senderOwner = data.sender.ownerName;
  return (
    <div>
      {onBack ? (
        <button type="button" className="link" onClick={onBack} style={{ height: 32 }}>
          ← {backLabel}
        </button>
      ) : null}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", marginTop: 4 }}>
        {standalone ? <h1>{data.name}</h1> : <h2 style={{ fontSize: 24, margin: 0 }}>{data.name}</h2>}
        <FitTag fit={data.fit} status={status} />
      </div>
      <div className="muted">
        {data.title || "No title"} · {data.company.id && !data.company.id.startsWith("x-") ? <Link href={`/companies/${data.company.id}`}>{data.company.name}</Link> : data.company.name}
      </div>
      <div className="xs faint" style={{ marginTop: 2 }}>
        {[data.company.industry, data.company.town ? data.company.town.charAt(0) + data.company.town.slice(1).toLowerCase() : "", data.company.businessId].filter(Boolean).join(" · ")}
        {data.company.businessId ? " · PRH" : ""}
        {data.url ? (
          <>
            {" · "}
            <a href={data.url} target="_blank" rel="noreferrer" className="faint">
              LinkedIn profile
            </a>
          </>
        ) : null}
      </div>

      {/* The next step first, so there is something to act on without scrolling. */}
      <div className="next-step">
        <div className="row" style={{ gap: 8 }}>
          <WriteInClaude prompt={data.prompt} className="btn small primary" />
          <button type="button" className="btn small" onClick={draftHere} disabled={draft.busy}>
            {draft.busy ? "Drafting…" : "Draft here"}
          </button>
          <span className="small muted">Suggested sender: {senderOwner}</span>
        </div>
        <p className="xs faint" style={{ marginTop: 6 }}>
          Write in Claude copies a prompt to paste into your own Claude, connected to this app (Settings → Connect to Claude); Claude writes the message from the facts below.
          {data.writer === "claude"
            ? " Draft here asks Claude from this app, with the name left out."
            : data.writer === "local"
              ? ` Draft here asks ${local} on this machine; a draft that uses anything not in the facts is replaced by the template.`
              : " Draft here writes a template with your ask and signature (no API key or local model set)."} Nothing is sent from here: {senderOwner === "You" ? "you send it from your own LinkedIn." : `${senderOwner} sends it from their own LinkedIn.`}
        </p>
        {draft.text ? (
          <div className="angle">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Draft</span>
              <span className="pill inferred">Inferred</span>
            </div>
            <textarea value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} rows={6} style={{ marginTop: 6 }} aria-label="Draft message" />
            <div className="row" style={{ marginTop: 6, gap: 8 }}>
              <WriteInClaude prompt={draft.text} label="Copy draft" copied="Copied" />
              <span className="xs muted">
                {draft.model === "template" ? "The app's template, with your ask and signature." : `Written by ${draft.model?.startsWith("ollama:") ? local : "Claude"} from the facts in this panel only.`} Check it before {senderOwner === "You" ? "you send" : `${senderOwner} sends`} it.
              </span>
            </div>
            {draft.note ? <p className="xs muted" style={{ marginTop: 4 }}>{draft.note}</p> : null}
          </div>
        ) : draft.error ? (
          <p className="small" style={{ color: "var(--red)", marginTop: 6 }}>
            {draft.error}
          </p>
        ) : null}
      </div>

      {status !== "none" ? (
        <p className="small status-line">
          <b style={{ fontWeight: 600 }}>{LABEL[status] ?? status}</b>
          {statusAt ? ` ${day(statusAt)}` : ""}
          {statusBy ? ` by ${statusBy}` : ""}
          {data.statusNote && status === data.status ? `: "${data.statusNote}"` : ""}. {meaning}
        </p>
      ) : null}
      {data.cooldown ? <p className="small cooldown">{data.cooldown}. For 30 days after a contact, others at the company rank lower.</p> : null}

      <h3>Who knows them</h3>
      {data.knownBy.map((k) => (
        <div key={k.owner} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", padding: "8px 0", borderTop: "1px solid var(--border)" }}>
          <span>
            <b style={{ fontWeight: 600 }}>{k.ownerName}</b> <span className="muted small">· connected {month(k.connectedOn)}</span>
          </span>
          {k.ownerName === senderOwner ? <span className="pill accent">Suggested sender</span> : null}
        </div>
      ))}
      <div className="small muted" style={{ paddingTop: 2 }}>
        {data.knownBy.length > 1 ? `${data.knownBy.length} of you know them. ${senderOwner} connected first.` : `Only ${senderOwner === "You" ? "you know" : `${senderOwner} knows`} them.`} {data.approachLabel}: {data.approachWhy}
      </div>

      <h3>Why they could matter for your goal</h3>
      <ol className="reasons">
        {data.reasons.map((r, i) => (
          <li key={i}>
            <span>
              {r.text}
              {r.link ? (
                <>
                  {" "}
                  <a href={r.link} target="_blank" rel="noreferrer">
                    source
                  </a>
                </>
              ) : null}
            </span>
            <Source source={r.source} provenance={r.provenance} />
          </li>
        ))}
      </ol>

      <h3>What we don't know</h3>
      <ul className="reasons">
        {data.missing.map((m, i) => (
          <li key={i} style={{ color: "var(--text-2)" }}>
            <span>
              <b style={{ fontWeight: 500 }}>{m.label}.</b> {m.text}
            </span>
            <span className="pill missing">Missing</span>
          </li>
        ))}
      </ul>

      <div className="small muted" style={{ marginTop: 10 }}>
        <b style={{ color: "var(--text-2)", fontWeight: 500 }}>{data.fitLabel}.</b> {data.fitWhy}
      </div>

      <div className="angle">
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Possible angle</span>
          <span className="pill inferred">Inferred</span>
        </div>
        <p style={{ margin: "4px 0 0", fontSize: 14 }}>{angle.text}</p>
        <p className="xs muted" style={{ marginTop: 6 }}>
          Written from the facts above only{angle.by === "claude" ? " by Claude" : angle.by === "local" ? ` by ${local}` : " (template)"}. Check before you use it.{angle.error ? ` ${angle.error.replace(/\.$/, "")}.` : ""}
        </p>
      </div>

      <div role="group" aria-label="Status" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 16 }}>
        {STATUSES.map((s) => (
          <button key={s.id} type="button" className="btn small" aria-pressed={status === s.id} disabled={busy} onClick={() => save(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <p className="xs faint" style={{ marginTop: 6 }}>
        A status only records what the team did, for the whole team: Sent, Replied, Meeting and Not a fit take them off the recommendations; Snooze hides them for 90 days. Nothing is sent from here.
      </p>
      {!standalone ? (
        <p className="small" style={{ marginTop: 12 }}>
          <Link href={`/people/${data.id}`} className="link">
            Open as a page →
          </Link>
        </p>
      ) : null}
    </div>
  );
}
