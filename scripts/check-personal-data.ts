// Refuses personal data in git: run by the pre-commit and pre-push hooks and
// in CI. Rules in scripts/personal-data.ts.
//   node --experimental-strip-types scripts/check-personal-data.ts [--tracked]
//     every tracked file, as it is on disk (the default; pre-push, CI)
//   node --experimental-strip-types scripts/check-personal-data.ts --staged
//     what is staged for the next commit (pre-commit)
// Exit 0 clean, 1 personal data found, 2 usage or git error.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findPersonalData, isExcluded, type FileInput } from "./personal-data.ts";

const git = (args: string[], cwd: string) => execFileSync("git", args, { cwd, maxBuffer: 1 << 30 });
const list = (out: Buffer) => out.toString("utf8").split("\0").filter(Boolean);

function tracked(root: string): FileInput[] {
  return list(git(["ls-files", "-z"], root))
    .filter((p) => !isExcluded(p))
    .map((p) => {
      const file = path.join(root, p);
      // Deleted on disk, a symlink or a submodule: still checked by name.
      const isFile = fs.existsSync(file) && fs.lstatSync(file).isFile();
      return { path: p, content: isFile ? fs.readFileSync(file) : "" };
    });
}

function staged(root: string): FileInput[] {
  return list(git(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"], root))
    .filter((p) => !isExcluded(p))
    .map((p) => ({ path: p, content: git(["show", `:${p}`], root) }));
}

const args = process.argv.slice(2);
const mode = args[0] ?? "--tracked";
if (args.length > 1 || (mode !== "--tracked" && mode !== "--staged")) {
  console.error("Usage: check-personal-data.ts [--tracked | --staged]");
  process.exit(2);
}

let files: FileInput[];
try {
  const root = git(["rev-parse", "--show-toplevel"], process.cwd()).toString().trim();
  files = mode === "--staged" ? staged(root) : tracked(root);
} catch (e) {
  console.error(`Could not read the files from git: ${(e as Error).message}`);
  process.exit(2);
}

const hits = findPersonalData(files);
if (hits.length) {
  console.error(`Personal data found in ${mode === "--staged" ? "staged" : "tracked"} files:\n`);
  for (const h of hits) console.error(`  ${h.line ? `${h.path}:${h.line}` : h.path} ${h.rule} (${h.excerpt})`);
  const remove = mode === "--staged" ? "Nothing was committed. Unstage a file: git restore --staged <path>" : "Stop tracking a file: git rm --cached <path>";
  console.error(`
${remove}
Keep real exports, statuses and your profile outside the repo:
  DATA_DIR="$HOME/warm-paths-data" npm run dev
If a hit is invented data, write it so it no longer looks real (see scripts/personal-data.ts).`);
  process.exit(1);
}
console.log(`No personal data in ${files.length} ${mode === "--staged" ? "staged" : "tracked"} files.`);
