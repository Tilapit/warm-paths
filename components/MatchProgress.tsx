"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { COLD_SECONDS_PER_NAME, fmtWait } from "@/lib/estimate.ts";

type Job = { running: boolean; total: number; done: number; requests: number; seconds?: number; failed: number; lastError?: string; startedAt?: string };

/** While PRH lookups run in the background, show progress and refresh the page as matches land. */
export function MatchProgress({ initial }: { initial: Job }) {
  const router = useRouter();
  const [job, setJob] = useState(initial);
  useEffect(() => {
    if (!job.running) return;
    const t = setInterval(async () => {
      const j = (await fetch("/api/status").then((r) => r.json())) as { job: Job };
      setJob(j.job);
      router.refresh();
    }, 4000);
    return () => clearInterval(t);
  }, [job.running, router]);
  if (!job.running) return null;
  const elapsed = job.startedAt ? (Date.now() - Date.parse(job.startedAt)) / 1000 : 0;
  const pace = job.done >= 10 && elapsed ? elapsed / job.done : COLD_SECONDS_PER_NAME;
  const left = fmtWait((job.total - job.done) * pace);
  return (
    <div style={{ padding: "8px 32px", borderBottom: "1px solid var(--border)", background: "var(--panel)" }} aria-live="polite">
      <div className="small" style={{ marginBottom: 6 }}>
        Looking company names up in the trade register (PRH): {job.done} of {job.total}, {left} left. Names with decision-makers go first; the drawing fills in as matches arrive.
      </div>
      <div className="progress">
        <div style={{ width: `${(100 * job.done) / Math.max(1, job.total)}%` }} />
      </div>
    </div>
  );
}
