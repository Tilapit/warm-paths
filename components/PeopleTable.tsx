"use client";
import Link from "next/link";
import { useMemo, useState } from "react";

export type Row = { id: string; name: string; title: string; company: string; group: string; fit: string; approach: string; score: number; knownBy: string; sender: string; signal: string; status: string; match: string; reacted: number };

const COLS: [keyof Row, string][] = [
  ["name", "Name"],
  ["title", "Title"],
  ["company", "Company"],
  ["group", "Industry"],
  ["fit", "Fit"],
  ["score", "Score"],
  ["knownBy", "Known by"],
  ["signal", "Registered change"],
  ["reacted", "Reacted"],
  ["status", "Status"],
];

export function PeopleTable({ rows }: { rows: Row[] }) {
  const [sort, setSort] = useState<{ k: keyof Row; dir: 1 | -1 }>({ k: "score", dir: -1 });
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = t ? rows.filter((r) => `${r.name} ${r.title} ${r.company} ${r.group}`.toLowerCase().includes(t)) : rows;
    return [...list].sort((a, b) => {
      const x = a[sort.k];
      const y = b[sort.k];
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "fi")) * sort.dir;
    });
  }, [rows, sort, q]);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <input type="search" placeholder="Filter by name, title, company or industry" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 360, maxWidth: "100%" }} aria-label="Filter" />
        <span className="small muted">{shown.length} people</span>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {COLS.map(([k, label]) => (
                <th key={k} className={k === "score" ? "num" : undefined} aria-sort={sort.k === k ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                  <button type="button" onClick={() => setSort({ k, dir: sort.k === k ? ((-sort.dir) as 1 | -1) : k === "score" ? -1 : 1 })}>
                    {label}
                    {sort.k === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/people/${r.id}`}>{r.name}</Link>
                </td>
                <td className="small">{r.title}</td>
                <td className="small">
                  {r.company}
                  {r.match === "inferred" ? <span className="pill inferred" style={{ marginLeft: 6 }}>check</span> : null}
                </td>
                <td className="small muted">{r.group}</td>
                <td>{r.fit === "strong" ? <span className="pill strong">Strong</span> : r.fit === "possible" ? <span className="pill">Possible</span> : <span className="faint xs">{r.approach === "ask_intro" ? "Ask intro" : ""}</span>}</td>
                <td className="num">{r.score}</td>
                <td className="small">{r.knownBy}</td>
                <td className="small">{r.signal}</td>
                <td className="small">{r.reacted ? `${r.reacted} post${r.reacted > 1 ? "s" : ""}` : ""}</td>
                <td className="small">{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
