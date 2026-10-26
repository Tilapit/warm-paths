"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseConnections } from "@/lib/ingest.ts";
import { COLD_SECONDS_PER_NAME, fmtWait } from "@/lib/estimate.ts";

const fmt = (n: number) => n.toLocaleString("en-US");

export function UploadForm({ defaultOwner = "You", compact }: { defaultOwner?: string; compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  // Read in the browser before anything is uploaded: how many company names, and the worst-case wait.
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setMsg(null);
    if (!f) return setPreview(null);
    const { records, report } = parseConnections(await f.text(), f.name);
    if (!records.length) return setPreview(report.warnings[0] ?? "No connections found in this file.");
    const names = new Set(records.map((r) => r.company).filter(Boolean)).size;
    setPreview(
      `${fmt(records.length)} connections at ${fmt(names)} company names. Looking them all up in the trade register (PRH) from scratch takes ${fmtWait(names * COLD_SECONDS_PER_NAME)}; names already looked up are instant. You can use the app meanwhile: the drawing fills in as matches arrive.`,
    );
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    const r = await fetch("/api/networks", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setMsg(j.error ?? "Import failed");
    const est = j.estimate as { names: number; toLookUp: number; seconds: number } | undefined;
    const prh = !est ? "" : est.toLookUp ? ` PRH: ${fmt(est.toLookUp)} of ${fmt(est.names)} company names to look up, ${fmtWait(est.seconds)}.` : ` PRH: all ${fmt(est.names)} company names are already looked up.`;
    setMsg(`${j.owner.name}: ${fmt(j.owner.rows)} rows, ${fmt(j.owner.accepted)} imported, ${j.owner.skipped} skipped, ${j.owner.noCompany} with no company, ${j.owner.noUrl} with no profile URL.${prh}`);
    setPreview(null);
    (e.target as HTMLFormElement).reset();
    router.refresh();
  }
  return (
    <form onSubmit={submit} className="stack" style={{ maxWidth: compact ? 520 : 560 }}>
      <div className="row" style={{ alignItems: "end" }}>
        <label className="field">
          <span>Whose network</span>
          <input name="owner" defaultValue={defaultOwner} required style={{ width: 170 }} />
        </label>
        <label className="field">
          <span>Their Connections.csv</span>
          <input name="file" type="file" accept=".csv,text/csv" required onChange={onFile} />
        </label>
        <button className="btn primary" disabled={busy}>
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
      {preview && !msg ? (
        <p className="small muted" role="status">
          {preview}
        </p>
      ) : null}
      {msg ? (
        <p className="small" role="status">
          {msg}
        </p>
      ) : null}
    </form>
  );
}

export function DemoButton({ label = "Load demo data" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/demo", { method: "POST" });
        router.push("/");
        router.refresh();
      }}
    >
      {busy ? "Loading…" : label}
    </button>
  );
}

export function FirstRun() {
  return (
    <main className="page" style={{ maxWidth: 820 }}>
      <h1>Bring in your network</h1>
      <p className="lede">Add your LinkedIn connections, and your teammates&apos; if you work as a team. Warm Paths merges them by profile URL, so you see who you know, who decides, and who should reach out, for whatever you are looking for.</p>
      <div className="card stack" style={{ padding: 20 }}>
        <UploadForm />
        <details>
          <summary className="small" style={{ cursor: "pointer" }}>
            How each person gets their file (2 minutes)
          </summary>
          <ol className="small muted" style={{ margin: "8px 0 0", paddingLeft: 20 }}>
            <li>On LinkedIn: Settings, then Data privacy.</li>
            <li>Get a copy of your data, tick only Connections.</li>
            <li>LinkedIn emails a zip, usually within minutes.</li>
            <li>Import Connections.csv from the zip here. Add teammates one by one in Settings.</li>
          </ol>
        </details>
      </div>
      <div className="card" style={{ marginTop: 16, padding: 20 }}>
        <h2>Or try it with invented people</h2>
        <p className="small muted" style={{ margin: "4px 0 12px" }}>
          Three mock LinkedIn exports (You 1,500, Co-founder 860, Board member 300). Every person is invented; the companies are real Finnish and international companies so the trade-register matching can be tested.
        </p>
        <DemoButton />
      </div>
      <p className="small muted" style={{ marginTop: 16 }}>
        Files stay on this machine. Only company names go to the trade register (PRH). Each person can delete their file any time in Settings.
      </p>
    </main>
  );
}
