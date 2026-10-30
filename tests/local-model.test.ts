import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

// The optional local model (Ollama): off without OLLAMA_MODEL, only this
// machine, every reply checked. Invented people and companies; a fake
// transport, or a server on 127.0.0.1 that this test starts. No request
// leaves this process's machine, and no real model is called.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OLLAMA_MODEL;
delete process.env.OLLAMA_URL;

const { DEFAULT_OLLAMA_URL, jsonObject, localAddress, ollamaChat, ollamaEnabled, ollamaStatus } = await import("../lib/ollama.ts");
const { checkSuggestion, suggestProfile, SUGGEST_SYSTEM } = await import("../lib/suggest-profile.ts");
const { checkWritten, notInFacts } = await import("../lib/model-check.ts");
const { draftFacts, dropSignOff, writeAngle, writeDraft, writer } = await import("../lib/claude.ts");
const { EMPTY_PROFILE, mapIndustries } = await import("../lib/industry.ts");
type Transport = import("../lib/ollama.ts").Transport;
type Analysis = import("../lib/analysis.ts").Analysis;

const MODEL = "test-model:1b";
/** A fake Ollama: answers each chat with the next reply and records the requests. */
function fake(replies: (string | { status: number; text: string })[]) {
  const calls: { ip: string; method: string; path: string; body: Record<string, any> | undefined }[] = [];
  const transport: Transport = async (at, method, path, body) => {
    calls.push({ ip: at.ip, method, path, body: body ? JSON.parse(body) : undefined });
    const r = replies.shift() ?? "";
    return typeof r === "string" ? { status: 200, text: JSON.stringify({ message: { role: "assistant", content: r } }) } : r;
  };
  return { transport, calls };
}
const withModel = async <T>(fn: () => Promise<T>, url?: string): Promise<T> => {
  process.env.OLLAMA_MODEL = MODEL;
  if (url) process.env.OLLAMA_URL = url;
  try {
    return await fn();
  } finally {
    delete process.env.OLLAMA_MODEL;
    delete process.env.OLLAMA_URL;
  }
};

// One invented person, as the angle sees them.
const analysis = {
  title: "Partner",
  company: { name: "Esimerkki Ventures Oy", industry: "Investment funds", tol: "64310", groupLabel: "Finance and insurance" },
  reasons: [{ kind: "role", label: "Role", text: "Director-level title" }],
  fitLabel: "Strong fit",
  fitWhy: "Senior title at Funds and investment.",
  angle: { text: "Template angle from the facts." },
} as unknown as Analysis;
const ctx = {
  type: "direct",
  facts: ["First name: Aino", "Title: Partner", "Company: Esimerkki Ventures Oy (investment funds)", "Sender: Ville.", "What the sender is looking for (their goal, in their words): an analyst role in venture capital"],
  mustNotUse: ["Where any fact came from"],
  rules: ["Short."],
  examples: ["Hi Matti, I saw Keksitty Rahasto is hiring."],
  voice: { tone: "friendly", ask: "a 20-minute call" },
};
const names = { name: "Aino Kallio", sender: "Ville", owners: ["Ville"] };

test("local model: off unless OLLAMA_MODEL is set, and then nothing calls it", async () => {
  const f = fake(["should never be used"]);
  assert.equal(ollamaEnabled(), false);
  assert.equal(writer(), "template");
  assert.deepEqual(await writeAngle(analysis, "goal", f), { text: "Template angle from the facts.", by: "template" });
  assert.ok("error" in (await writeDraft(ctx, names, f)));
  assert.deepEqual(await suggestProfile("Find VC people", { profile: EMPTY_PROFILE, names: [] }, f), { error: "No OLLAMA_MODEL set." });
  assert.deepEqual(await ollamaChat("s", "u", f), { error: "No OLLAMA_MODEL set." });
  assert.deepEqual(await ollamaStatus(f), { enabled: false });
  assert.equal(f.calls.length, 0);
  await withModel(async () => assert.equal(writer(), "local"));
  // A key keeps Claude first.
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  await withModel(async () => assert.equal(writer(), "claude"));
  delete process.env.ANTHROPIC_API_KEY;
});

test("local model: only an address on this machine; anything else is refused before a request", async () => {
  assert.equal(DEFAULT_OLLAMA_URL, "http://127.0.0.1:11434");
  for (const [url, ip] of [["http://127.0.0.1:11434", "127.0.0.1"], ["http://127.8.9.10:8080/", "127.8.9.10"], ["http://[::1]:11434", "::1"]]) {
    const r = await localAddress(url);
    assert.ok("ip" in r, url);
    assert.equal(r.ip, ip);
  }
  // localhost counts only when every address it resolves to is this machine.
  const lh = await localAddress("http://localhost:11434");
  assert.ok("ip" in lh && /^(127\.|::1$)/.test(lh.ip));
  for (const url of ["http://192.168.1.20:11434", "http://10.0.0.5:11434", "http://0.0.0.0:11434", "http://example.invalid:11434", "http://127.0.0.1.example.invalid", "http://[::ffff:7f00:1]:11434", "https://127.0.0.1:11434", "ftp://127.0.0.1", "http://user:secret@127.0.0.1:11434", "not a url"])
    assert.ok("error" in (await localAddress(url)), url);

  const f = fake(["never"]);
  const r = await withModel(() => ollamaChat("s", "u", f), "http://192.168.1.20:11434");
  assert.ok("error" in r && /not this machine/.test(r.error));
  assert.equal(f.calls.length, 0, "no request to a remote address");
});

test("local model: one chat turn, thinking off, temperature 0, to /api/chat on the loopback address", async () => {
  const f = fake(["Hello.", { status: 404, text: JSON.stringify({ error: `model "${MODEL}" not found` }) }, { status: 200, text: "not json" }]);
  await withModel(async () => {
    assert.deepEqual(await ollamaChat("system words", "user words", f), { text: "Hello." });
    const [c] = f.calls;
    assert.equal(c.ip, "127.0.0.1");
    assert.equal(c.method, "POST");
    assert.equal(c.path, "/api/chat");
    assert.deepEqual({ model: c.body!.model, stream: c.body!.stream, think: c.body!.think, options: c.body!.options }, { model: MODEL, stream: false, think: false, options: { temperature: 0 } });
    assert.deepEqual(c.body!.messages, [{ role: "system", content: "system words" }, { role: "user", content: "user words" }]);
    assert.match((await ollamaChat("s", "u", f) as { error: string }).error, /answered 404: model "test-model:1b" not found/);
    assert.match((await ollamaChat("s", "u", f) as { error: string }).error, /empty answer/);
    const broken: Transport = async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
    };
    assert.match((await ollamaChat("s", "u", { transport: broken }) as { error: string }).error, /Could not reach the local model: connect ECONNREFUSED/);
  });
});

test("local model: over real http on 127.0.0.1, a redirect is not followed and a slow answer times out", async () => {
  let seen = "";
  const server = http.createServer((req, res) => {
    seen = `${req.method} ${req.url}`;
    if (req.url === "/redirect/api/chat") return res.writeHead(302, { location: "http://example.invalid/api/chat" }).end();
    if (req.url === "/slow/api/chat") return setTimeout(() => res.end("{}"), 2000);
    if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: MODEL }] }));
    res.end(JSON.stringify({ message: { content: " Hei. " } }));
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.deepEqual(await withModel(() => ollamaChat("s", "u"), base), { text: "Hei." });
    assert.equal(seen, "POST /api/chat");
    const redirected = await withModel(() => ollamaChat("s", "u"), `${base}/redirect`);
    assert.ok("error" in redirected && /answered 302/.test(redirected.error), "a redirect is an error, never followed");
    process.env.OLLAMA_TIMEOUT_MS = "200";
    const slow = await withModel(() => ollamaChat("s", "u"), `${base}/slow`);
    delete process.env.OLLAMA_TIMEOUT_MS;
    assert.ok("error" in slow && /no answer in/.test(slow.error));
    const st = await withModel(() => ollamaStatus(), base);
    assert.deepEqual(st, { enabled: true, model: MODEL, url: base, ok: true, installed: true });
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("local model: Settings says when the model is missing or the address is refused", async () => {
  const missing = await withModel(() => ollamaStatus(fake([{ status: 200, text: JSON.stringify({ models: [{ name: "other:7b" }] }) }])));
  assert.ok(missing.enabled && !missing.ok && /not installed: ollama pull test-model:1b/.test(missing.error!));
  const refused = await withModel(() => ollamaStatus(), "http://192.168.1.20:11434");
  assert.ok(refused.enabled && !refused.ok && /not this machine/.test(refused.error!));
});

test("local model: the one JSON object in a reply, fenced or with words around it; nothing else", () => {
  assert.deepEqual(jsonObject('{"a":1}'), { a: 1 });
  assert.deepEqual(jsonObject('```json\n{"a":[1,2]}\n```'), { a: [1, 2] });
  assert.deepEqual(jsonObject('Here it is: {"a":true} Hope it helps.'), { a: true });
  for (const bad of ["", "no json", "[1,2]", '{"a":', "{'a':1}"]) assert.equal(jsonObject(bad), null, bad);
});

const SUGGEST = { profile: { ...EMPTY_PROFILE, roles: ["partner"], keywords: ["capital"] }, names: ["Aino Kallio", "Esimerkki Ventures Oy", "Ville"] };

test("profile suggestions: exactly the expected fields, or the whole reply is rejected", () => {
  const ok = { roles: [], keywords: [], industries: [] };
  assert.ok("suggestion" in checkSuggestion(ok, SUGGEST));
  assert.ok("suggestion" in checkSuggestion({ ...ok, noEmployeesOk: true }, SUGGEST));
  for (const [bad, why] of [
    [[], /not a JSON object/],
    [{ roles: [], keywords: [] }, /"industries" is not a list/],
    [{ ...ok, roles: "partner" }, /"roles" is not a list/],
    [{ ...ok, roles: ["partner"] }, /"roles" is not a list of \{"en", "fi", "sv"\}/],
    [{ ...ok, roles: [{ en: "partner", de: "Partner" }] }, /"roles" is not a list/],
    [{ ...ok, keywords: [{ en: 1 }] }, /"keywords" is not a list/],
    [{ ...ok, industries: [{ en: "venture capital" }] }, /"industries" is not a list of words/],
    [{ ...ok, excluded: ["Esimerkki Ventures Oy"] }, /unexpected field "excluded"/],
    [{ ...ok, noEmployeesOk: "yes" }, /noEmployeesOk/],
  ] as const) {
    const r = checkSuggestion(bad, SUGGEST);
    assert.ok("error" in r && why.test(r.error), JSON.stringify(bad));
  }
});

test("profile suggestions: plain terms only, never a name from the networks or an organisation; industries mapped by code", () => {
  const r = checkSuggestion(
    {
      roles: [
        { en: "Investment Director", fi: "Sijoitusjohtaja", sv: "Investeringsdirektör" },
        { en: "Partner", fi: "Partner", sv: "Partner" },
        { en: "Aino Kallio", fi: "Head of 2026 Talent", sv: "see https://example.com" },
        { en: "a@b.fi", fi: "Chief Investment Officer and Founding Partner", sv: "" },
      ],
      keywords: [{ en: "Ventures", fi: "pääoma", sv: "riskkapital" }, { en: "Capital", fi: "Esimerkki Ventures Oy", sv: "Nordic Funds Ab" }, { en: "vc" }],
      industries: ["venture capital", "underwater basket weaving", "6430"],
      noEmployeesOk: true,
    },
    SUGGEST,
  );
  assert.ok("suggestion" in r);
  const s = r.suggestion;
  // Each term in English, Finnish and Swedish, together. "Partner" is already a role, "Capital" already a keyword.
  assert.deepEqual(s.roles, ["Investment Director", "Sijoitusjohtaja", "Investeringsdirektör"]);
  assert.deepEqual(s.keywords, ["ventures", "pääoma", "riskkapital", "vc"]);
  assert.deepEqual(s.industries, mapIndustries(["venture capital"]), "mapped as on save, not by the model");
  assert.deepEqual(s.industryKeywords, ["underwater basket weaving"]);
  assert.equal(s.noEmployeesOk, true);
  // Partner three times, Aino Kallio, 2026, link, address, over four words; Capital, two organisations; a code.
  assert.equal(s.left, 12);
});

test("profile suggestions: only the goal goes to the model; a wrong shape is asked for once more, then rejected", async () => {
  const good = JSON.stringify({ roles: [{ en: "Principal", fi: "Principal", sv: "Principal" }], keywords: [{ en: "ventures", fi: "pääoma", sv: "riskkapital" }], industries: ["venture capital"], noEmployeesOk: true });
  const f = fake(["Sure! Here are some ideas.", "```json\n" + good + "\n```"]);
  const r = await withModel(() => suggestProfile("Find people at VC funds in Finland.", SUGGEST, f));
  assert.ok("suggestion" in r);
  assert.deepEqual(r.suggestion.roles, ["Principal"]);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].body!.messages[0].content, SUGGEST_SYSTEM);
  assert.equal(f.calls[0].body!.messages[1].content, "Goal (their words): Find people at VC funds in Finland.");
  assert.match(f.calls[1].body!.messages[1].content, /rejected \(no JSON object in the answer\)/);
  const sent = JSON.stringify(f.calls);
  for (const n of SUGGEST.names) assert.ok(!sent.includes(n), `${n} never goes to the model`);

  const twice = fake(['{"roles":["x"],"keywords":[],"industries":[]}', '{"roles":[],"keywords":[],"industries":[],"extra":1}']);
  const bad = await withModel(() => suggestProfile("Find VC people", SUGGEST, twice));
  assert.deepEqual(bad, { error: `The local model's answer was rejected: unexpected field "extra".` });
  assert.deepEqual(await withModel(() => suggestProfile("  ", SUGGEST, fake([]))), { error: "Write your goal first." });
});

test("written text: only what the facts have; names, numbers, links, placeholders and sources are caught", () => {
  const facts = draftFacts(ctx, names);
  assert.ok(!facts.includes("Keksitty Rahasto"), "the examples are not facts");
  assert.ok(!facts.includes("Kallio"), "names stay masked");
  const ok = "Hi [FIRST_NAME], I see you work as Partner at Esimerkki Ventures. I'm looking at an analyst role in venture capital. Would you have time for a 20-minute call?";
  assert.deepEqual(notInFacts(ok, facts), []);
  assert.deepEqual(checkWritten(ok, facts, 500), { ok: true });
  // Finnish and Swedish case endings of a fact still count as the fact.
  assert.deepEqual(notInFacts("Hei [FIRST_NAME], kiitos. Esimerkki Venturesilla on kiinnostavaa.", facts), []);
  // A sentence may start with any word.
  assert.deepEqual(notInFacts("Thanks [FIRST_NAME]. Quick question for you.", facts), []);

  for (const [text, found] of [
    ["Hi [FIRST_NAME], I saw Keksitty Rahasto is hiring.", ["Keksitty", "Rahasto"]],
    ["Hi [FIRST_NAME], your fund raised 40 million.", ["40"]],
    ["Hi [FIRST_NAME], see example.com/x or https://example.com/y", ["https://example.com/y"]],
    ["Hi [FIRST_NAME] and [COMPANY], hello.", ["[COMPANY]"]],
    ["Hi [FIRST_NAME], we met in Helsinki.", ["Helsinki"]],
  ] as const)
    assert.deepEqual(notInFacts(text, facts), found, text);
  const source = checkWritten("Hi [FIRST_NAME], I saw in the trade register that you joined.", facts, 500);
  assert.ok(!source.ok && /trade register/.test(source.why));
  const long = checkWritten("Hi [FIRST_NAME]. " + "Thanks. ".repeat(100), facts, 500);
  assert.ok(!long.ok && /over 500/.test(long.why));
});

test("written text: claims the facts do not make are rejected; translations of a place and line starts are not", () => {
  const facts = draftFacts({ ...ctx, facts: [...ctx.facts, "Based in Finland."] }, names);
  for (const [text, what] of [
    ["Hi [FIRST_NAME], I saw your post and wanted to reach out.", "a post"],
    ["Hei [FIRST_NAME], näin postauksesi.", "a post"],
    ["Hi [FIRST_NAME], great to see you again since we met at the fair.", "a meeting"],
    ["Hi [FIRST_NAME], a mutual friend suggested I write.", "a mutual contact"],
    ["Hi [FIRST_NAME], congratulations on the new role!", "congratulations"],
    ["Hej [FIRST_NAME], grattis till det nya jobbet!", "congratulations"],
  ] as const) {
    const r = checkWritten(text, facts, 500);
    assert.ok(!r.ok && r.why.includes(what), text);
  }
  // A reaction to the team's post is a fact for a reaction follow-up.
  const reacted = draftFacts({ ...ctx, facts: [...ctx.facts, "They reacted to the sender's own LinkedIn post on 3 Oct 2026. This may be mentioned."] }, names);
  assert.deepEqual(checkWritten("Hi [FIRST_NAME], thanks for reacting to my post on 3 Oct.", reacted, 500), { ok: true });
  // Finland in the facts allows Suomi and its forms; a new line starts a sentence.
  assert.deepEqual(notInFacts("Hei [FIRST_NAME],\n\nToivon, että ehdit. Etsin analyytikon roolia Suomessa.", facts), []);
  assert.deepEqual(notInFacts("Hej [FIRST_NAME],\n\nJag söker en roll i Finland och Sverige.", facts), ["Sverige"]);
});

test("drafts: a sign-off the local model adds is dropped; the app adds the signature", () => {
  assert.equal(dropSignOff("Hi [FIRST_NAME], a question.\n\nBest,\n[SENDER]"), "Hi [FIRST_NAME], a question.");
  assert.equal(dropSignOff("Hei [FIRST_NAME], kysymys.\n\nYstävällisin terveisin\n[SENDER]"), "Hei [FIRST_NAME], kysymys.");
  assert.equal(dropSignOff("Hi [FIRST_NAME], a question.\n[SENDER]"), "Hi [FIRST_NAME], a question.");
  assert.equal(dropSignOff("Hi [FIRST_NAME], a question? Best, [SENDER]"), "Hi [FIRST_NAME], a question?");
  assert.equal(dropSignOff("Hi [FIRST_NAME], [SENDER] here with a question."), "Hi [FIRST_NAME], [SENDER] here with a question.");
});

test("angles from the local model: used when they hold to the facts, else the template with the reason", async () => {
  const good = fake(['"Partner at Esimerkki Ventures, an investment fund, so close to how analyst roles in venture capital are filled."']);
  const r = await withModel(() => writeAngle(analysis, "an analyst role in venture capital", good));
  assert.deepEqual(r, { text: "Partner at Esimerkki Ventures, an investment fund, so close to how analyst roles in venture capital are filled.", by: "local" });
  assert.match(good.calls[0].body!.messages[1].content, /^The user's goal \(their words\): an analyst role in venture capital/);

  const invented = fake(["She led Keksitty Rahasto's 40 million fund.", "She led Keksitty Rahasto's 40 million fund."]);
  const t = await withModel(() => writeAngle(analysis, "an analyst role in venture capital", invented));
  assert.equal(t.by, "template");
  assert.equal(t.text, "Template angle from the facts.");
  assert.match(t.error!, /not used: it used "40", "Keksitty", "Rahasto's", not in the facts/);
  assert.equal(invented.calls.length, 2, "asked once more with the reason");
  assert.match(invented.calls[1].body!.messages[1].content, /Your last answer was rejected: it used/);
});

test("drafts from the local model: names masked going in, put back coming out, checked against the facts", async () => {
  const f = fake(["Hi [FIRST_NAME], I'm looking at an analyst role in venture capital. As Partner at Esimerkki Ventures, would you have time for a 20-minute call?"]);
  const r = await withModel(() => writeDraft(ctx, names, f));
  assert.deepEqual(r, { text: "Hi Aino, I'm looking at an analyst role in venture capital. As Partner at Esimerkki Ventures, would you have time for a 20-minute call?", model: `ollama:${MODEL}` });
  const sent = JSON.stringify(f.calls[0].body!.messages);
  assert.ok(!sent.includes("Kallio") && !sent.includes("Aino"), "the person's name is masked");

  const copied = fake(["Hi [FIRST_NAME], I saw Keksitty Rahasto is hiring.", "Hi [FIRST_NAME], I saw Keksitty Rahasto is hiring."]);
  const bad = await withModel(() => writeDraft(ctx, names, copied));
  assert.ok("error" in bad && /not used: it used "Keksitty", "Rahasto"/.test(bad.error), "an example's company is not a fact");
});
