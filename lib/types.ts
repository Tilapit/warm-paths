// Shared types. Every fact carries a provenance so the UI can say where it
// came from and how sure we are about it.

export type Provenance =
  | "verified" // checked against an authoritative record (exact PRH name match, registered notice, same profile URL)
  | "imported" // came from a file the team imported (LinkedIn Connections.csv)
  | "inferred" // our own conclusion from other facts (close-name PRH match, name-only reaction match, templates)
  | "missing"; // we looked and the data is not there (headcount)

export type SourceRef = { file: string; row?: number; url?: string };

export type Fact<T> = { value: T; provenance: Provenance; source: SourceRef; note?: string };

export type ImportReport = {
  kind: string;
  file: string;
  rows: number;
  accepted: number;
  warnings: string[];
};
