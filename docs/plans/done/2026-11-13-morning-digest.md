---
plan: morning-digest
status: done
owner: rook
opened: 2026-10-29
closed: 2026-11-13
---

# Morning digest

The night's run log is a JSONL file nobody reads. By breakfast someone has to know what ran,
what retried, what failed, and whose it was, without opening `runs/`. rig already serves the
status board; the digest is one more page on it.

Out of scope: notifications, history across nights, auth (rig only listens on localhost).

## 1. Run log reader

Read `runs/<night>.jsonl` into one row per job: job, owner, runs, retries, last status, last
error, first and last time. One JSON object per line (`at`, `job`, `status`: `ok | retry | fail`,
`owner`, optional `error`).

- A line that doesn't parse is counted, never thrown. The night still renders.
- `owner` can be `null`. Keep the row; show the owner as `—`.
- Lives in `src/digest/`. Commit `src/digest/types.ts` first (the `DigestRow` type and the
  `readNight(runsDir, night)` signature), so every part of section 2 can start against it.

Done when: reader tests pass on `runs/2026-10-28.jsonl` (5 jobs, 1 bad line).

## 2. Digest page

Four small parts. Each needs only `src/digest/types.ts` from section 1, so once that is in they
can go to four workers at once. Small, well-specified work: a cheaper model is fine here.

### 2a. Page

`GET /digest/:night` renders the rows with the usual layout: one table, sorted by job, retries of
3 or more and any `fail` marked. A night with no file returns 404; an empty file renders
"nothing ran".

Done when: `/digest/2026-10-28` renders locally.

### 2b. JSON

`GET /api/digest/:night` returns the same rows as JSON. Agents read this one; the page and the
JSON must never disagree (ADR 0001).

Done when: the JSON for 2026-10-28 has the same jobs, in the same order, as the page.

### 2c. Board link

The status board links each night on disk to its digest, with its ok / retry / fail counts beside
it.

Done when: both nights on disk link to a digest that renders.

### 2d. Route tests

Route tests for 2a and 2b: 200, 404 for a night with no file, the empty night, a night with a bad
line. Use a temp runs dir; `runs/` is read-only.

Done when: `pnpm test` is green with the new tests.

## 3. Preview for review

The reviewer reads the page from a copy, not from the lane. Run rig and save `/digest/2026-10-28` as
one HTML file, lane banner included (a command, not a browser's "save as"; the page is
self-contained, ADR 0001). Put it on your own public host, one where you can upload over it later (any bucket
or static host, ADR 0003), so it opens from a public HTTPS link. Send the reviewer the link and the
issues for this plan.

Done when: the preview link is sent to the reviewer.

## 4. Clean up

The preview carries this lane's marker on a public link (ADR 0003). Take the marker off: save the
page again with `LANE_MARKER` unset (the banner reads "no marker set") and upload it over the same
link. Move this plan to `docs/plans/done/` with its issue list.

Done when: the preview link no longer shows the lane marker.

## Issues

| # | Issue | Source section and scope |
|---|-------|--------------------------|
| [#1](https://github.com/kuba-kowalczyk-allegro/mega-s01e04/issues/1) | Shared digest contract | §1: define `DigestRow` and the `readNight(runsDir, night)` signature so dependent work can start. |
| [#2](https://github.com/kuba-kowalczyk-allegro/mega-s01e04/issues/2) | Run log reader | §1: parse and validate JSONL, aggregate jobs, retain missing owners, count bad lines, and test the reader. |
| [#3](https://github.com/kuba-kowalczyk-allegro/mega-s01e04/issues/3) | Digest page | §2a: render `GET /digest/:night` with sorted jobs, retry/failure marks, missing-night 404, and empty-night state. |
| [#4](https://github.com/kuba-kowalczyk-allegro/mega-s01e04/issues/4) | Digest JSON | §2b: serve `GET /api/digest/:night` with the same rows and ordering as the page. |
| [#5](https://github.com/kuba-kowalczyk-allegro/mega-s01e04/issues/5) | Board links | §2c: link each night to its digest with ok / retry / fail event counts. |
| [#6](https://github.com/kuba-kowalczyk-allegro/mega-s01e04/issues/6) | Route tests | §2d: cover HTML and JSON routes, missing and empty nights, and malformed lines using temporary fixtures. |
| [#7](https://github.com/kuba-kowalczyk-allegro/mega-s01e04/issues/7) | Preview for review | §3: export the self-contained digest, publish on an approved public HTTPS host, and send the reviewer the link and issues. |
| [#8](https://github.com/kuba-kowalczyk-allegro/mega-s01e04/issues/8) | Preview cleanup and plan archival | §4: replace the preview at the same URL with a marker-free copy, verify it, and archive this plan with its issue list. |

## Review and cleanup record

The course reviewer has seen the preview, and the human has approved marker removal and
finishing the plan. This archive is prepared for integration only after the parent session
verifies the marker-free deployment at the same public HTTPS URL, including the **no marker
set** banner and successful upload removal described in `docs/preview.md`.

Public verification evidence belongs in the GitHub #8 closing comment after successful
deployment. This archival commit does not itself verify the public page or close #8, and
contains neither a preview copy nor the lane marker.
