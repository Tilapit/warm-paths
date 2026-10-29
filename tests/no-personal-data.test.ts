import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findPersonalData, type FileInput } from "../scripts/personal-data.ts";

// Every value here is invented and written with escapes (\x20, \x40, \x2e), so
// this file does not match the rules it tests.
const ROOT = path.join(import.meta.dirname, "..");
const CHECK = path.join(ROOT, "scripts", "check-personal-data.ts");
const HEADER = "First\x20Name,Last\x20Name,URL,Email\x20Address,Company,Position,Connected\x20On";
const EMAIL = "aino.kallio\x40konepaja.fi";
const PROFILE = "https://www.linkedin\x2ecom/in/aino-kallio-3f2a";
const find = (p: string, content: FileInput["content"]) => findPersonalData([{ path: p, content }]);
const rules = (p: string, content: FileInput["content"]) => find(p, content).map((h) => h.rule);

const check = (cwd: string, ...args: string[]) =>
  spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", CHECK, ...args], { cwd, encoding: "utf8" });

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
  assert.deepEqual(rules("notes.md", "Connected\x20On,Tags,Last\x20Name,First\x20Name"), ["connections-header"]);
  // Notes lines first and CRLF: the line number is the header's.
  assert.equal(find("a.csv", `Notes:\r\n"..."\r\n\r\n${HEADER}\r\n`)[0].line, 4);
  // UTF-16, as Excel saves "Unicode text".
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(HEADER, "utf16le")]);
  assert.deepEqual(rules("a.txt", utf16), ["connections-header"]);
  assert.deepEqual(rules("a.csv", "Name,Date,Amount\nFirst\x20Name,Last\x20Name"), []);
});

test("guard: an email address in .csv, .json and .txt, except reserved example domains", () => {
  for (const ext of ["csv", "json", "txt", "CSV"]) assert.deepEqual(rules(`a.${ext}`, `x,${EMAIL},y`), ["email"], ext);
  for (const ext of ["ts", "md", "mjs"]) assert.deepEqual(rules(`a.${ext}`, EMAIL), [], ext);
  for (const d of ["example.com", "example.org", "example.net", "mail.example.com", "host.invalid", "host.test", "EXAMPLE.COM"])
    assert.deepEqual(rules("a.csv", `aino\x40${d}`), [], d);
  for (const d of ["notexample.com", "example.co", "example.com.fi", "testing.fi"])
    assert.deepEqual(rules("a.csv", `aino\x40${d}`), ["email"], d);
  // Package specifiers are not addresses.
  assert.deepEqual(rules("package-lock.json", '"node_modules/\x40types/node": "next\x4015.5.28"'), []);
});

test("guard: a LinkedIn profile URL in any text file", () => {
  for (const p of ["a.csv", "README.md", "lib/x.ts", "notes"]) assert.deepEqual(rules(p, `see ${PROFILE}.`), ["linkedin-url"], p);
  assert.deepEqual(rules("a.md", "fi.linkedin\x2ecom/in/aino-k%C3%A4llio"), ["linkedin-url"]);
  // A path with no one in it, and a template, are not profiles.
  assert.deepEqual(rules("a.ts", "are linkedin\x2ecom/in/ profile URLs"), []);
  assert.deepEqual(rules("a.ts", "`linkedin\x2ecom/in/${slug}`"), []);
  assert.deepEqual(rules("a.md", "linkedin\x2ecom/company/konepaja"), []);
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

test("guard: data/demo/ and tests/fixtures/ are excluded, only at the repo root", () => {
  const all = `${HEADER}\n${EMAIL}\n${PROFILE}`;
  for (const p of ["data/demo/Connections.csv", "data/demo/profile.json", "tests/fixtures/x.csv", "./tests/fixtures/state.json", "data\\demo\\x.csv"])
    assert.deepEqual(rules(p, all), [], p);
  for (const p of ["other/data/demo/x.csv", "data/demo-mine/x.csv", "tests/fixtures-real/x.csv"])
    assert.deepEqual(rules(p, all), ["connections-header", "email", "linkedin-url"], p);
});

test("guard: excerpts are masked", () => {
  const hits = find("a.csv", `${HEADER},Tags\nAino,Kallio,${PROFILE},${EMAIL},Konepaja,CEO,12 Apr 2024,Asiakas`);
  assert.deepEqual(
    hits.map((h) => [h.line, h.rule, h.excerpt]),
    [
      [1, "connections-header", "first\x20name,last\x20name,url,email\x20address,company,position,connected\x20on,t***"],
      [2, "email", "a***\x40k***.fi"],
      [2, "linkedin-url", "linkedin\x2ecom/in/a***"],
    ],
  );
  const shown = hits.map((h) => h.excerpt).join(" ");
  for (const secret of ["aino.kallio", "konepaja.fi", "aino-kallio", "Kallio"]) assert.ok(!shown.includes(secret), secret);
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
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "guard-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
  git("init", "-q");
  fs.writeFileSync(path.join(repo, "notes.md"), "Nothing personal.\n");
  git("add", "notes.md");
  assert.equal(check(repo, "--staged").status, 0);

  fs.mkdirSync(path.join(repo, "export"));
  fs.writeFileSync(path.join(repo, "export", "Connections.csv"), `${HEADER}\nAino,Kallio,${PROFILE},${EMAIL},Konepaja,CEO,12 Apr 2024\n`);
  fs.writeFileSync(path.join(repo, "profile.json"), "{}");
  git("add", ".");
  // Only the staged version counts: the file on disk is clean again.
  fs.writeFileSync(path.join(repo, "export", "Connections.csv"), "cleaned\n");
  const r = check(repo, "--staged");
  assert.equal(r.status, 1);
  for (const line of ["export/Connections.csv:1 connections-header", "export/Connections.csv:2 email (a***\x40k***.fi)", "export/Connections.csv:2 linkedin-url (linkedin\x2ecom/in/a***)", "profile.json data-file (profile.json)"])
    assert.ok(r.stderr.includes(line), line);
  for (const secret of ["aino.kallio", "aino-kallio", "Kallio"]) assert.ok(!(r.stdout + r.stderr).includes(secret), secret);

  // --tracked reads every file git tracks (staged ones too) as it is on disk.
  const t = check(repo, "--tracked");
  assert.equal(t.status, 1);
  assert.ok(t.stderr.includes("profile.json data-file"));
  assert.ok(!t.stderr.includes("export/Connections.csv"));
  fs.rmSync(repo, { recursive: true, force: true });
});
