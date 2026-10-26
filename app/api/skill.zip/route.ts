import fs from "node:fs";
import path from "node:path";
import { zip } from "@/lib/zip.ts";

export const dynamic = "force-dynamic";

/** The Claude skill (claude/warm-paths) as a zip, for upload to Claude. Same as `npm run skill:zip`. */
export async function GET() {
  const dir = path.join(process.cwd(), "claude", "warm-paths");
  const files = fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith("."))
    .map((f) => ({ name: `warm-paths/${f}`, data: new Uint8Array(fs.readFileSync(path.join(dir, f))) }));
  return new Response(Buffer.from(zip(files)), { headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="warm-paths-skill.zip"' } });
}
