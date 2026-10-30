"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { requiresEmployer, type Profile } from "@/lib/industry.ts";

export function DeleteOwner({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [sure, setSure] = useState(false);
  return sure ? (
    <span className="row" style={{ gap: 6 }}>
      <button
        type="button"
        className="btn small danger"
        onClick={async () => {
          await fetch(`/api/networks?id=${encodeURIComponent(id)}`, { method: "DELETE" });
          router.refresh();
        }}
      >
        Delete {name}&apos;s network
      </button>
      <button type="button" className="link small" onClick={() => setSure(false)}>
        Cancel
      </button>
    </span>
  ) : (
    <button type="button" className="btn small" onClick={() => setSure(true)}>
      Delete
    </button>
  );
}

export function DeleteAll() {
  const router = useRouter();
  const [sure, setSure] = useState(false);
  return sure ? (
    <span className="row" style={{ gap: 8 }}>
      <button
        type="button"
        className="btn danger"
        onClick={async () => {
          await fetch("/api/delete-all", { method: "POST" });
          router.push("/");
          router.refresh();
        }}
      >
        Yes, delete everything
      </button>
      <button type="button" className="link" onClick={() => setSure(false)}>
        Cancel
      </button>
    </span>
  ) : (
    <button type="button" className="btn danger" onClick={() => setSure(true)}>
      Delete my data
    </button>
  );
}

type Mapping = { input: string; label?: string; rules?: { code: string }[]; note?: string; unmapped?: boolean; hint?: string };
const csv = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

/** How each plain-language industry was read, so the user can check it. */
function MappingList({ items }: { items: Mapping[] }) {
  if (!items.length) return null;
  return (
    <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
      {items.map((m, i) => (
        <li key={i}>
          &quot;{m.input}&quot; → {m.unmapped ? <span className="muted">{m.hint}</span> : <>{m.label} (TOL {m.rules!.map((r) => r.code.replace("-", "–")).join(", ")}){m.note ? <span className="muted">. {m.note}</span> : null}</>}
        </li>
      ))}
    </ul>
  );
}

type Suggestion = { roles: string[]; keywords: string[]; industries: Mapping[]; industryKeywords: string[]; noEmployeesOk: boolean; left: number };

/**
 * The profile in the user's own words. `setup`: the short first-run form, one
 * text box and optional fields. Otherwise every field, for Settings.
 * `localModel`: the local model's name when one is set; it can then suggest
 * roles, industries and keywords from the goal, which go into the form only
 * when the user ticks them, and into the profile only when they save.
 */
export function ProfileEditor({ profile, setup, demo, localModel }: { profile: Profile; setup?: boolean; demo?: boolean; localModel?: string }) {
  const router = useRouter();
  const [goal, setGoal] = useState(profile.goal);
  const [roles, setRoles] = useState(profile.roles.join(", "));
  const [rules, setRules] = useState(profile.industries);
  const [words, setWords] = useState("");
  const [keywords, setKeywords] = useState(profile.keywords.join(", "));
  const [excluded, setExcluded] = useState(profile.excluded ?? []);
  const [addExcluded, setAddExcluded] = useState("");
  const [ask, setAsk] = useState(profile.ask);
  const [tone, setTone] = useState(profile.tone);
  const [signature, setSignature] = useState(profile.signature);
  const [employer, setEmployer] = useState(requiresEmployer(profile));
  const [mapping, setMapping] = useState<Mapping[]>([]);
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [suggesting, setSuggesting] = useState(false);
  async function suggest() {
    setSuggesting(true);
    setMsg("");
    const r = await fetch("/api/profile/suggest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ goal }) });
    const j = await r.json().catch(() => ({ error: "Could not get suggestions." }));
    setSuggesting(false);
    if (!r.ok) {
      setSuggestion(null);
      return setMsg(j.error ?? "Could not get suggestions.");
    }
    const s = j.suggestion as Suggestion;
    setSuggestion(s);
    // Nothing ticked: the user picks.
    setPicked(new Set());
  }
  /** Puts the ticked suggestions into the form. Nothing is saved until Save. */
  function addPicked() {
    const s = suggestion!;
    const has = (k: string) => picked.has(k);
    const join = (cur: string, add: string[]) => {
      const now = csv(cur);
      return [...now, ...add.filter((a) => !now.some((c) => c.toLowerCase() === a.toLowerCase()))].join(", ");
    };
    setRoles(join(roles, s.roles.filter((x) => has(`role:${x}`))));
    setKeywords(join(keywords, [...s.keywords, ...s.industryKeywords].filter((x) => has(`kw:${x}`))));
    setWords(join(words, s.industries.filter((x) => has(`ind:${x.input}`)).map((x) => x.input)));
    if (has("employer")) setEmployer(false);
    setSuggestion(null);
    setOpen(true);
    setMsg("Added to the form. Check the fields, then save: nothing is saved until you do.");
  }
  const tick = (k: string, label: React.ReactNode) => (
    <label key={k} className="small" style={{ display: "inline-flex", gap: 6, alignItems: "center", marginRight: 14 }}>
      <input type="checkbox" checked={picked.has(k)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(k); else n.delete(k); return n; })} />
      {label}
    </label>
  );
  const s = suggestion;
  const empty = s && !s.roles.length && !s.keywords.length && !s.industries.length && !s.industryKeywords.length && !(s.noEmployeesOk && employer);
  const suggestPanel = s ? (
    <div className="card stack" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b style={{ fontWeight: 600 }}>Suggestions</b>
        <span className="pill inferred">Inferred · local model</span>
      </div>
      <p className="xs muted">From your goal only, by {localModel} on this machine, in English, Finnish and Swedish; the translations are the model&apos;s, so check them. Tick what fits: it goes into the form, and nothing is saved until you save the profile.</p>
      {empty ? <p className="small">No new suggestions: what it proposed is already in your profile.</p> : null}
      {s.roles.length ? <div><span className="small muted">Roles: </span>{s.roles.map((x) => tick(`role:${x}`, x))}</div> : null}
      {s.industries.length ? (
        <div>
          <span className="small muted">Industries: </span>
          {s.industries.map((m) => tick(`ind:${m.input}`, <>{m.input} <span className="muted">→ {m.label} (TOL {m.rules!.map((r) => r.code.replace("-", "–")).join(", ")})</span></>))}
        </div>
      ) : null}
      {s.keywords.length ? <div><span className="small muted">Organisation keywords: </span>{s.keywords.map((x) => tick(`kw:${x}`, x))}</div> : null}
      {s.industryKeywords.length ? <div><span className="small muted">No TOL group, as keywords instead: </span>{s.industryKeywords.map((x) => tick(`kw:${x}`, x))}</div> : null}
      {s.noEmployeesOk && employer ? <div>{tick("employer", "Turn off \u201cHide companies with no employees\u201d: organisations like these often have none.")}</div> : null}
      {s.left ? <p className="xs faint">{s.left} left out: not plain terms, a name from your networks, or already in your profile.</p> : null}
      <div className="row">
        <button type="button" className="btn small primary" onClick={addPicked} disabled={!picked.size}>
          Add ticked to the form
        </button>
        <button type="button" className="btn small" onClick={() => setSuggestion(null)}>
          Dismiss
        </button>
      </div>
    </div>
  ) : null;
  async function save() {
    const body = {
      goal,
      roles: csv(roles),
      keywords: csv(keywords),
      ask,
      tone,
      signature,
      requireEmployer: employer,
      ...(setup ? { industries: csv(words) } : { industryRules: rules, excluded, add: { industries: csv(words), excluded: csv(addExcluded) } }),
    };
    const r = await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) return setMsg("Could not save.");
    const j = (await r.json()) as { profile: Profile; industries: Mapping[] };
    setRules(j.profile.industries);
    setExcluded(j.profile.excluded ?? []);
    setWords("");
    setAddExcluded("");
    setMapping(j.industries);
    setMsg("Saved. The list, the drawing and Claude use it now.");
    router.refresh();
  }
  const optional = (
    <>
      <label className="field">
        <span>Target roles or titles (comma-separated). A senior title that matches is a Strong fit; C-level always counts.</span>
        <input value={roles} onChange={(e) => setRoles(e.target.value)} placeholder="partner, principal, head of talent" />
      </label>
      {setup ? null : (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small">Target industries (TOL codes). Empty: any industry.</span>
          {rules.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>TOL codes</th>
                    <th>Label</th>
                    <th>Lower priority</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <input value={r.code} aria-label="TOL range or prefix" onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))} style={{ width: 110 }} />
                      </td>
                      <td>
                        <input value={r.label} aria-label="Label" onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} style={{ width: "100%", minWidth: 160 }} />
                      </td>
                      <td>
                        <input type="checkbox" aria-label="Lower priority" checked={!!r.lowerPriority} onChange={(e) => setRules(rules.map((x, j) => (j === i ? { ...x, lowerPriority: e.target.checked } : x)))} />
                      </td>
                      <td>
                        <button type="button" className="link small" onClick={() => setRules(rules.filter((_, j) => j !== i))}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}
      <label className="field">
        <span>{setup ? "Industries, in your words or as TOL codes (comma-separated). Leave empty for any industry." : "Add industries, in your words or as TOL codes (comma-separated)"}</span>
        <input value={words} onChange={(e) => setWords(e.target.value)} placeholder="venture capital, software, 10-33" />
      </label>
      <MappingList items={mapping} />
      <label className="field">
        <span>Organisation keywords: a word in the name makes it a target, whatever its industry (comma-separated)</span>
        <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="ventures, capital, partners" />
      </label>
      <div className="grid2">
        <label className="field">
          <span>The ask</span>
          <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="a 20-minute call" />
        </label>
        <label className="field">
          <span>Signature</span>
          <input value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="– Alex" />
        </label>
      </div>
      <label className="field">
        <span>Tone, and the language messages are written in</span>
        <input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="friendly and direct, in English" />
      </label>
      {setup ? null : (
        <div className="stack" style={{ gap: 6 }}>
          <span className="small">Not a target ({excluded.length})</span>
          {excluded.length ? (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {excluded.map((x, i) => (
                <li key={`${x.businessId ?? x.name}-${i}`}>
                  {x.businessId ? <Link href={`/companies/${x.businessId}`}>{x.name}</Link> : x.name}
                  {x.businessId && x.businessId !== x.name ? <span className="muted"> · {x.businessId}</span> : null}{" "}
                  <button type="button" className="link small" onClick={() => setExcluded(excluded.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <input value={addExcluded} onChange={(e) => setAddExcluded(e.target.value)} placeholder="Add: names or business IDs, comma-separated" aria-label="Add organisations that are not a target" />
        </div>
      )}
      <label className="small" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <input type="checkbox" checked={employer} onChange={(e) => setEmployer(e.target.checked)} />
        <span style={{ flex: 1 }}>Hide Finnish companies with no employees registered: not in the Employer Register (PRH/YTJ), so most likely one-person companies. Their people are never a fit.</span>
      </label>
    </>
  );
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      {demo ? <p className="small"><span className="pill amber">Demo profile</span> Invented, in use while only the demo networks are loaded. Saving makes it yours.</p> : null}
      <label className="field">
        <span>{setup ? "In your own words" : "Goal, in your own words"}</span>
        <textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="Find people at VC funds in Finland. I'm looking for an analyst role." rows={3} />
      </label>
      {localModel ? (
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn small" onClick={suggest} disabled={suggesting || !goal.trim()}>
            {suggesting ? "Asking the local model…" : "Suggest roles, industries and keywords"}
          </button>
          <span className="xs muted">Local model ({localModel}), from your goal only. You choose what to keep.</span>
        </div>
      ) : null}
      {suggestPanel}
      {setup ? (
        <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
          <summary className="small">More (optional): roles, industries, keywords, the ask, tone</summary>
          <div className="stack" style={{ marginTop: 10 }}>
            {optional}
          </div>
        </details>
      ) : (
        optional
      )}
      <div className="row">
        <button type="button" className="btn primary" onClick={() => save()} disabled={setup && !goal.trim()}>
          {setup ? "Save and rank my network" : "Save profile"}
        </button>
        <span className="small muted" role="status">
          {msg}
        </span>
      </div>
      {setup ? null : <p className="small muted">
        <span className="pill missing">Missing</span> Headcount is not in PRH open data. The Employer Register says only whether a company has regular employees.
      </p>}
    </div>
  );
}

export type Review = { name: string; names: string[]; status: string; note: string; people: number; dms: number; candidates: { businessId: string; name: string; industry?: string; tol?: string; town?: string }[]; pick?: string };

export function MatchReview({ items }: { items: Review[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  async function send(name: string, body: object) {
    setBusy(name);
    const r = await fetch("/api/overrides", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, ...body }) });
    const j = await r.json().catch(() => ({}));
    setErr({ ...err, [name]: r.ok ? "" : j.error ?? "Failed" });
    setBusy(null);
    router.refresh();
  }
  return (
    <div className="stack">
      {items.map((it) => (
        <div key={it.name} className="card" style={{ opacity: busy === it.name ? 0.6 : 1 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <b style={{ fontWeight: 600 }}>{it.names.join(" · ")}</b>
              <div className="small muted">
                {it.people} {it.people === 1 ? "person" : "people"}
                {it.dms ? `, ${it.dms} decision-maker${it.dms > 1 ? "s" : ""}` : ""} · {it.note}
              </div>
            </div>
            <span className={`pill ${it.status === "inferred" ? "inferred" : it.status === "picked" ? "green" : "amber"}`}>{it.status === "inferred" ? "Check" : it.status === "picked" ? "Picked by you" : it.status === "ambiguous" ? "Several" : "No match"}</span>
          </div>
          {it.candidates.length ? (
            <div className="stack" style={{ gap: 6, marginTop: 10 }}>
              {it.candidates.map((c) => (
                <div key={c.businessId} className="row small" style={{ justifyContent: "space-between", gap: 8 }}>
                  <span>
                    {c.name} <span className="muted">· {c.businessId} · {c.industry} {c.tol ? `(${c.tol})` : ""} {c.town ? `· ${c.town.charAt(0)}${c.town.slice(1).toLowerCase()}` : ""}</span>
                  </span>
                  <button type="button" className="btn small" aria-pressed={it.pick === c.businessId} onClick={() => send(it.name, { businessId: c.businessId })}>
                    {it.pick === c.businessId ? "Picked" : "This one"}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <form
            className="row small"
            style={{ marginTop: 10, gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              const v = new FormData(e.currentTarget).get("bid");
              send(it.name, { businessId: String(v) });
            }}
          >
            <input name="bid" placeholder="Business ID, e.g. 1234567-8" style={{ width: 210, minHeight: 32, padding: "4px 8px" }} aria-label="Business ID" />
            <button className="btn small">Use ID</button>
            <button type="button" className="btn small" onClick={() => send(it.name, { notFinnish: true })}>
              Not a Finnish company
            </button>
            {it.status === "picked" ? (
              <button type="button" className="link small" onClick={() => send(it.name, { clear: true })}>
                Undo
              </button>
            ) : null}
            {err[it.name] ? <span className="small" style={{ color: "var(--red)" }}>{err[it.name]}</span> : null}
          </form>
        </div>
      ))}
    </div>
  );
}

/** "Delete" for one engaged person, or "Delete all engaged". */
export function DeleteEngaged({ id, label }: { id?: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={id ? "link small" : "btn small"}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch(`/api/engaged?${id ? `id=${encodeURIComponent(id)}` : "all=1"}`, { method: "DELETE" });
        setBusy(false);
        router.refresh();
      }}
    >
      {busy ? "Deleting…" : label}
    </button>
  );
}
