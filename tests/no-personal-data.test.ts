import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findPersonalData, type FileInput } from "../scripts/personal-data.ts";
import { EMAIL, HEADER, HEADER_REORDERED, PROFILE, PROFILE_ENCODED } from "./fixtures/personal-data.ts";

const ROOT = path.join(import.meta.dirname, "..");
const CHECK = path.join(ROOT, "scripts", "check-personal-data.ts");
const find = (p: string, content: FileInput["content"]) => findPersonalData([{ path: p, content }]);
const rules = (p: string, content: FileInput["content"]) => find(p, content).map((h) => h.rule);

// Throwaway repos see none of the machine's git config or the caller's GIT_* variables.
const ENV = { ...process.env };
for (const k of Object.keys(ENV)) if (k.startsWith("GIT_")) delete ENV[k];
Object.assign(ENV, {
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
});
const check = (cwd: string, ...args: string[]) =>
  spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", CHECK, ...args], { cwd, env: ENV, encoding: "utf8" });
const tmpRepo = (...init: string[]) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, env: ENV }).toString().trim();
  git("init", "-q", "-b", "main", ...init);
  return { dir, git, write: (p: string, text: string) => fs.writeFileSync(path.join(dir, p), text) };
};

test("guard: no tracked file in this repo holds personal data", () => {
  const r = check(ROOT, "--tracked");
  assert.equal(r.status, 0, r.stderr);
});

test("guard: the Connections header, whatever the quotes, BOM, case or separator", () => {
  const plain = find("export/Connections.csv", `${HEADER}\nAino,Kallio\n`);
  assert.deepEqual(plain.map((h) => [h.line, h.rule]), [[1, "connections-header"]]);
  assert.deepEqual(rules("a.csv", `﻿${HEADER}`), ["connections-header"]);
  assert.deepEqual(rules("a.csv", HEADER.split(",").map((c) => `"${c}"`).join(",")), ["connections-header"]);
  assert.deepEqual(rules("a.txt", HEADER.toUpperCase()), ["connections-header"]);
  assert.deepEqual(rules("a.csv", HEADER.replaceAll(",", ";")), ["connections-header"]);
  assert.deepEqual(rules("notes.md", HEADER_REORDERED), ["connections-header"]);
  // Notes lines first and CRLF: the line number is the header's.
  assert.equal(find("a.csv", `Notes:\r\n"..."\r\n\r\n${HEADER}\r\n`)[0].line, 4);
  // UTF-16, as Excel saves "Unicode text".
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(HEADER, "utf16le")]);
  assert.deepEqual(rules("a.txt", utf16), ["connections-header"]);
  assert.deepEqual(rules("a.csv", "Name,Date,Amount\nFirst Name,Last Name"), []);
});

test("guard: an email address in .csv, .json and .txt, except reserved example domains", () => {
  for (const ext of ["csv", "json", "txt", "CSV"]) assert.deepEqual(rules(`a.${ext}`, `x,${EMAIL},y`), ["email"], ext);
  for (const ext of ["ts", "md", "mjs"]) assert.deepEqual(rules(`a.${ext}`, EMAIL), [], ext);
  for (const d of ["example.com", "example.org", "example.net", "mail.example.com", "host.invalid", "host.test", "EXAMPLE.COM"])
    assert.deepEqual(rules("a.csv", `aino@${d}`), [], d);
  for (const d of ["notexample.com", "example.co", "example.com.fi", "testing.fi"])
    assert.deepEqual(rules("a.csv", `aino@${d}`), ["email"], d);
  // Package specifiers are not addresses.
  assert.deepEqual(rules("package-lock.json", '"node_modules/@types/node": "next@15.5.28"'), []);
});

test("guard: a LinkedIn profile URL in any text file", () => {
  for (const p of ["a.csv", "README.md", "lib/x.ts", "notes"]) assert.deepEqual(rules(p, `see ${PROFILE}.`), ["linkedin-url"], p);
  assert.deepEqual(rules("a.md", PROFILE_ENCODED), ["linkedin-url"]);
  // A path with no one in it, and a template, are not profiles.
  assert.deepEqual(rules("a.ts", "are linkedin.com/in/ profile URLs"), []);
  assert.deepEqual(rules("a.ts", "`linkedin.com/in/${slug}`"), []);
  assert.deepEqual(rules("a.md", "linkedin.com/company/konepaja"), []);
});

test("guard: profile.json and state.json by name, at any depth, whatever is in them", () => {
  for (const p of ["profile.json", "config/profile.json", "data-mine/state.json", "data/State.json"]) {
    const hits = find(p, "{}");
    assert.deepEqual(hits, [{ path: p, line: 0, rule: "data-file", excerpt: path.basename(p) }], p);
  }
  for (const p of ["profile.json.example", "my-profile.json", "lib/profile.ts"]) assert.deepEqual(rules(p, "{}"), [], p);
});

test("guard: binary files by name only", () => {
  const binary = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04, 0]), Buffer.from(`${HEADER}\n${EMAIL}\n${PROFILE}`)]);
  assert.deepEqual(rules("export.zip", binary), []);
  assert.deepEqual(rules("data/state.json", binary), ["data-file"]);
});

test("guard: data/demo/, tests/fixtures/ and the mock generator are excluded, nothing else", () => {
  const all = `${HEADER}\n${EMAIL}\n${PROFILE}`;
  for (const p of ["data/demo/Connections.csv", "data/demo/profile.json", "tests/fixtures/x.csv", "./tests/fixtures/state.json", "data\\demo\\x.csv", "scripts/generate-mock-connections.mjs"])
    assert.deepEqual(rules(p, all), [], p);
  for (const p of ["other/data/demo/x.csv", "data/demo-mine/x.csv", "tests/fixtures-real/x.csv", "scripts/generate-mock-connections.mjs.csv", "other/scripts/generate-mock-connections.mjs"])
    assert.ok(rules(p, all).includes("connections-header"), p);
});

test("guard: excerpts are masked", () => {
  const hits = find("a.csv", `${HEADER},Tags\nAino,Kallio,${PROFILE},${EMAIL},Konepaja,CEO,12 Apr 2024,Asiakas`);
  assert.deepEqual(
    hits.map((h) => [h.line, h.rule, h.excerpt]),
    [
      [1, "connections-header", `${HEADER.toLowerCase()},t***`],
      [2, "email", "a***@k***.fi"],
      [2, "linkedin-url", ".../in/a***"],
    ],
  );
  const shown = hits.map((h) => h.excerpt).join(" ");
  for (const secret of ["aino.kallio", "konepaja.fi", "aino-kallio", "Kallio"]) assert.ok(!shown.includes(secret), secret);
  // A masked excerpt pasted somewhere is not a hit itself.
  assert.deepEqual(rules("issue.txt", hits.slice(1).map((h) => h.excerpt).join("\n")), []);
});

test("guard: never matches its own source, the checker, the hooks or this test", () => {
  const own = ["scripts/personal-data.ts", "scripts/check-personal-data.ts", "scripts/hooks/pre-commit", "scripts/hooks/pre-push", "tests/no-personal-data.test.ts"];
  for (const p of own) {
    const content = fs.readFileSync(path.join(ROOT, p));
    // As itself, and as if it were data, where the email rule applies too.
    for (const as of [p, `${p}.txt`, `${p}.csv`]) assert.deepEqual(find(as, content), [], as);
  }
});

test("guard: --staged checks what is staged, lists path:line rule and prints no personal data", () => {
  const { dir, git, write } = tmpRepo();
  write("notes.md", "Nothing personal.\n");
  git("add", "notes.md");
  assert.equal(check(dir, "--staged").status, 0);

  fs.mkdirSync(path.join(dir, "export"));
  write("export/Connections.csv", `${HEADER}\nAino,Kallio,${PROFILE},${EMAIL},Konepaja,CEO,12 Apr 2024\n`);
  write("profile.json", "{}");
  git("add", ".");
  // Only the staged version counts: the file on disk is clean again.
  write("export/Connections.csv", "cleaned\n");
  const r = check(dir, "--staged");
  assert.equal(r.status, 1);
  for (const line of ["export/Connections.csv:1 connections-header", "export/Connections.csv:2 email (a***@k***.fi)", "export/Connections.csv:2 linkedin-url (.../in/a***)", "profile.json data-file (profile.json)"])
    assert.ok(r.stderr.includes(line), line);
  for (const secret of ["aino.kallio", "aino-kallio", "Kallio"]) assert.ok(!(r.stdout + r.stderr).includes(secret), secret);

  // --tracked reads every file git tracks (staged ones too) as it is on disk.
  const t = check(dir, "--tracked");
  assert.equal(t.status, 1);
  assert.ok(t.stderr.includes("profile.json data-file"));
  assert.ok(!t.stderr.includes("export/Connections.csv"));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("guard: the pre-push hook refuses data committed with --no-verify and deleted in a later commit", () => {
  const remote = tmpRepo("--bare");
  const { dir, git, write } = tmpRepo();
  git("config", "core.hooksPath", path.join(ROOT, "scripts", "hooks"));
  git("remote", "add", "origin", remote.dir);
  const push = (to: string) => spawnSync("git", ["push", "-q", "origin", `HEAD:${to}`], { cwd: dir, env: ENV, encoding: "utf8" });
  write("README.md", "Notes.\n");
  git("add", ".");
  git("commit", "-qm", "Start");
  const start = git("rev-parse", "HEAD");
  assert.equal(push("main").status, 0, "a clean new branch goes through");

  write("notes.txt", `Aino\n${EMAIL}\n`);
  git("add", "notes.txt");
  git("commit", "-q", "--no-verify", "-m", "Add notes");
  const bad = git("rev-parse", "--short=7", "HEAD");
  git("rm", "-q", "notes.txt");
  git("commit", "-qm", "Remove notes");
  assert.equal(check(dir, "--tracked").status, 0, "the tip alone is clean");

  const line = `${bad} notes.txt:2 email (a***@k***.fi)`;
  const r = push("main");
  assert.equal(r.status, 1, "refused");
  assert.ok(r.stderr.includes(line), r.stderr);
  assert.ok(!r.stderr.includes(EMAIL));
  assert.equal(remote.git("rev-parse", "main"), start, "nothing was pushed");
  // A new branch: every commit no remote branch has.
  const nb = push("feature");
  assert.equal(nb.status, 1);
  assert.ok(nb.stderr.includes(line), nb.stderr);
  // CI runs the same check over a range.
  const ci = check(dir, "--commits", `${start}..HEAD`);
  assert.equal(ci.status, 1);
  assert.ok(ci.stderr.includes(line), ci.stderr);

  // With the commit rewritten away, the push goes through.
  git("reset", "-q", "--hard", start);
  write("notes.txt", "Aino\n");
  git("add", "notes.txt");
  git("commit", "-qm", "Add notes");
  assert.equal(push("main").status, 0);
  for (const d of [dir, remote.dir]) fs.rmSync(d, { recursive: true, force: true });
});
