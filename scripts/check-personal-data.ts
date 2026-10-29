// Refuses personal data in git: run by the pre-commit and pre-push hooks and
// in CI. Rules in scripts/personal-data.ts.
//   node --experimental-strip-types scripts/check-personal-data.ts [--tracked]
//     every tracked file, as it is on disk (the default; npm test)
//   ... --staged
//     what is staged for the next commit (pre-commit)
//   ... --pre-push
//     every commit being pushed, from the refs git passes on stdin (pre-push)
//   ... --commits <revisions>
//     every commit git rev-list gives for <revisions>, e.g. base..head (CI)
// A commit is checked by the files it adds or changes, so data that a later
// commit removed is still found. Exit 0 clean, 1 personal data found, 2 usage
// or git error.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findPersonalData, isExcluded, type FileInput, type Hit } from "./personal-data.ts";

const git = (args: string[], cwd: string, input?: string) => execFileSync("git", args, { cwd, input, maxBuffer: 1 << 30 });
const list = (out: Buffer) => out.toString("utf8").split("\0").filter(Boolean);
const ZERO = /^0+$/;

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

const hasCommit = (root: string, sha: string) => {
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

/** rev-list arguments for each line git gives pre-push: "<local ref> <local sha> <remote ref> <remote sha>". */
function pushedRevisions(root: string, stdin: string): string[][] {
  const out: string[][] = [];
  for (const line of stdin.split("\n").filter(Boolean)) {
    const [, local, , remote] = line.split(" ");
    if (ZERO.test(local)) continue; // a deleted ref carries nothing
    // A new branch, or a remote tip this clone has never seen: everything no remote branch has.
    out.push(!ZERO.test(remote) && hasCommit(root, remote) ? [`${remote}..${local}`] : [local, "--not", "--remotes"]);
  }
  return out;
}

/** Contents by blob id, read in one go. */
function blobs(root: string, ids: string[]): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  if (!ids.length) return out;
  const buf = git(["cat-file", "--batch"], root, ids.join("\n") + "\n");
  let i = 0;
  for (const id of ids) {
    const nl = buf.indexOf(10, i);
    const size = Number(buf.toString("utf8", i, nl).split(" ")[2]);
    out.set(id, buf.subarray(nl + 1, nl + 1 + size));
    i = nl + 1 + size + 1;
  }
  return out;
}

type CommitHit = Hit & { commit: string };

/** Each commit's added or changed files, a path and blob checked once, oldest commit first. */
function commitHits(root: string, revisions: string[][]): { commits: number; hits: CommitHit[] } {
  const commits = [...new Set(revisions.flatMap((r) => git(["rev-list", "--reverse", ...r], root).toString().split("\n").filter(Boolean)))];
  const seen = new Set<string>();
  const changes: { commit: string; path: string; blob: string }[] = [];
  for (const commit of commits) {
    // -m compares a merge with each parent, so nothing it brings in is skipped.
    const raw = list(git(["diff-tree", "-r", "-z", "-m", "--root", "--no-commit-id", "--no-renames", "--diff-filter=AMT", commit], root));
    for (let k = 0; k + 1 < raw.length; k += 2) {
      const [, mode, , blob] = raw[k].split(" ");
      const p = raw[k + 1];
      if (mode === "160000" || isExcluded(p) || seen.has(`${blob}\0${p}`)) continue; // 160000: a submodule
      seen.add(`${blob}\0${p}`);
      changes.push({ commit, path: p, blob });
    }
  }
  const content = blobs(root, [...new Set(changes.map((c) => c.blob))]);
  const hits = changes.flatMap((c) => findPersonalData([{ path: c.path, content: content.get(c.blob)! }]).map((h) => ({ ...h, commit: c.commit })));
  return { commits: commits.length, hits };
}

const args = process.argv.slice(2);
const mode = args[0] ?? "--tracked";
const usage = !["--tracked", "--staged", "--pre-push", "--commits"].includes(mode) || (mode === "--commits" ? args.length < 2 : args.length > 1);
if (usage) {
  console.error("Usage: check-personal-data.ts [--tracked | --staged | --pre-push | --commits <revisions>]");
  process.exit(2);
}

let hits: (Hit & { commit?: string })[];
let checked: string;
try {
  const root = git(["rev-parse", "--show-toplevel"], process.cwd()).toString().trim();
  if (mode === "--pre-push" || mode === "--commits") {
    const revisions = mode === "--pre-push" ? pushedRevisions(root, fs.readFileSync(0, "utf8")) : [args.slice(1)];
    const r = commitHits(root, revisions);
    hits = r.hits;
    checked = `${r.commits} ${mode === "--pre-push" ? "pushed " : ""}commit${r.commits === 1 ? "" : "s"}`;
  } else {
    const files = mode === "--staged" ? staged(root) : tracked(root);
    hits = findPersonalData(files);
    checked = `${files.length} ${mode === "--staged" ? "staged" : "tracked"} file${files.length === 1 ? "" : "s"}`;
  }
} catch (e) {
  console.error(`Could not read the files from git: ${(e as Error).message}`);
  process.exit(2);
}

if (hits.length) {
  console.error(`Personal data found in ${checked}:\n`);
  for (const h of hits) console.error(`  ${h.commit ? `${h.commit.slice(0, 7)} ` : ""}${h.line ? `${h.path}:${h.line}` : h.path} ${h.rule} (${h.excerpt})`);
  const remove = {
    "--tracked": "Stop tracking a file: git rm --cached <path>",
    "--staged": "Nothing was committed. Unstage a file: git restore --staged <path>",
    "--pre-push": "Nothing was pushed. A later commit that deletes the file does not help: the commit\nabove still holds it. Rewrite it first, e.g. git rebase -i <commit>^ and drop or edit it.",
    "--commits": "These commits hold it even if a later commit deletes the file. Rewrite them, e.g.\ngit rebase -i <commit>^ and drop or edit the commit, then force-push the branch.",
  }[mode];
  console.error(`
${remove}
Keep real exports, statuses and your profile outside the repo:
  DATA_DIR="$HOME/warm-paths-data" npm run dev
If a hit is invented test data, move it into tests/fixtures/.`);
  process.exit(1);
}
console.log(`No personal data in ${checked}.`);
