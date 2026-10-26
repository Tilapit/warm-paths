import Link from "next/link";
import { notFound } from "next/navigation";
import { loadNetwork } from "@/lib/network.ts";
import { personPayload } from "@/lib/payload.ts";
import { PersonAnalysis } from "@/components/PersonAnalysis";

export const dynamic = "force-dynamic";

export default async function Person({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = personPayload(await loadNetwork(), id);
  if (!p) notFound();
  return (
    <main className="page" style={{ maxWidth: 760 }}>
      <p className="small" style={{ marginBottom: 10 }}>
        <Link href={`/?p=${p.id}`} className="link">
          ← See them in the network
        </Link>
      </p>
      <PersonAnalysis data={p} standalone />
      <details style={{ marginTop: 24 }}>
        <summary className="small muted" style={{ cursor: "pointer" }}>
          Score: {p.score} (how the list is ordered)
        </summary>
        <table style={{ marginTop: 8 }}>
          <tbody>
            {p.parts.map((x) => (
              <tr key={x.label}>
                <td>{x.label}</td>
                <td className="small muted">{x.why}</td>
                <td className="num">{x.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </main>
  );
}
