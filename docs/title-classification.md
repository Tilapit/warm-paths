# Title classification by the local model (designed, not built)

Status: a design for later. Nothing here is in the code yet. The local model
client (`lib/ollama.ts`), its checks and the `OLLAMA_MODEL` switch already
exist; this adds one more use of them.

## Why

`lib/roles.ts` reads a title with fixed rules in English, Finnish and Swedish.
Titles the rules do not know get level "other": never a decision-maker,
whatever the profile says. A model can read many more titles, in any of the
three languages. But a model is not deterministic and can be wrong, so its
answer is an input field that code reads, never a fit or a score.

## What it does

- **Classify each title once.** Each distinct title (trimmed, lower case) is
  classified into a fixed set:
  - **Categories:** investor, founder, executive, board, finance,
    engineering, sales, marketing, people, operations, legal, consulting,
    academic, public sector, student, other.
  - **Seniority:** c_level, partner, director, manager, senior, mid, junior,
    student, unknown.
- **Documented mapping.** The sets and their mapping to `Level` live in one
  file, `lib/title-classes.ts`. Changing them bumps a version, which
  classifies every title again.
  - c_level and partner → exec.
  - director → director.
  - manager → manager.
  - category board → board.
  - Everything else → other.
  - Category student → `notDecider`.
- **Rules first.** The model's answer is used only where the rules give level
  "other". A user's correction wins over both.
- **Capped until confirmed.** A title read only by the model gives a Possible
  fit at most: a new cap in `fitCaps`, "title read by the local model". Once
  the user confirms or corrects it, it counts like a title the rules read.
- **Ranking is code.** Fit, approach, score and order stay in
  `lib/network.ts`, over cached fields. The same cache and the same
  corrections always give the same list.

## Storage

- **Cache.** `DATA_DIR/cache/titles/<hash>.json`, keyed by a SHA-256 of the
  normalised title, the model and the version of the sets:
  `{ category, seniority, model, version, at }`. Deleting the cache only
  means classifying again.
- **Corrections.** `DATA_DIR/title-corrections.json`, keyed by the same title
  hash, so one correction covers everyone with that title: `{ category,
  seniority, by, at }`. Not under `cache/`, because they are the user's
  decisions.
- **Guard.** Add `title-corrections.json` to the personal-data guard's file
  names (`scripts/personal-data.ts`), next to `profile.json` and
  `state.json`.

## Running it

- **When.** In the background, like the PRH lookups (`ensureMatching`). Titles
  of decision-maker candidates at target companies go first. It can also be
  run by hand with `npm run titles:classify`. Settings shows "N of M titles
  classified".
- **Batches.** 20 titles per call, numbered:

  ```json
  {"items":[{"i":0,"category":"investor","seniority":"partner"}]}
  ```
- **Checks before anything is cached:**
  - Every index from 0 to n−1 appears exactly once, and nothing else.
  - Category and seniority come from the sets.
  - No other fields.
- **When a batch fails.** It is split in halves and retried. A title that
  still fails stays unclassified and is tried again on the next run.
- **No structured output.** The MLX build of `qwen3.6:35b` does not support
  Ollama's structured output (`format` with a schema or `"json"` answers
  "structured output is unavailable"). JSON is asked for in the prompt and
  checked in code, as `lib/suggest-profile.ts` does.

## Cost (measured with invented titles, M2 Max, 64 GB)

- In batches of 20: about 0.25 s per title. One at a time: about 0.47 s.
- So about 2–3 minutes for 500–600 distinct titles, once. After that, only
  new titles.
- The model takes about 24 GB of memory while loaded.

Quality notes from the same test:
- **Right:** investor, HR, legal and student titles.
- **Wrong:** "Sijoitusjohtaja" (investment director) rated C-level.
- **Guessed:** "Principal" with nothing else gave investor.
- **Invalid:** one seniority value was not in the set, which the check
  rejects.

This is why the cap and the corrections are part of the design.

## In the app

- **Person view.** The category and seniority next to the title, labelled
  "Local model" (provenance Inferred), with Confirm and Correct. A correction
  is labelled "You".
- **find_people.** A `category` filter (MCP and the People page), for example
  `category: "investor"`.
- **Analysis.** The fit explanation says when the cap applies: "Title read by
  the local model, not confirmed: Possible at most."

## Tests (all invented titles, fake transport)

- Batch checks: a missing or duplicate index, a value not in the set, an
  extra field.
- The cache key changes with the model or the version of the sets.
- A correction wins over the model, and the rules win over the model.
- The cap: a model-only title is Possible at most; a confirmed one can be
  Strong.
- Without `OLLAMA_MODEL`, fits are identical to today's, cache or not.
- The guard flags `title-corrections.json`.

## CLAUDE.md change when built

The rule "The LLM never sets or changes them" stays, with one addition: the
local model's title category is an input field, like a LinkedIn title. Code
reads it, and it is capped at Possible until the user confirms it.
