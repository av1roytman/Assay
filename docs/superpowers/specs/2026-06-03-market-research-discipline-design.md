# Market-research discipline for `/research` panels — design

**Date:** 2026-06-03
**Status:** Approved (design)
**Scope owner:** `/research` skill prompt only

## Problem

Assay's qualitative panels (recommendation, risks, news, sec-summary) are written by
Claude during a `/research` run. Their quality currently depends on the model
applying good analytical habits ad hoc — which works on a strong model but is
inconsistent run-to-run and across the Opus/Sonnet split. The `ecc:market-research`
skill codifies exactly the habits we want (source claims, flag stale data, weigh
contrarian evidence, decide don't summarize, separate fact from inference), but it
is a heavyweight *methodology* skill with a full report-format output that fights
Assay's tight structured-panel model.

We want the **discipline** of that skill without its weight, cost, or output format.

## Decision summary

| Question | Decision |
|---|---|
| Goal | Upgrade the *methodology* of existing `/research` panels |
| Mechanism | **Approach A** — distill the methodology into the `/research` `SKILL.md` prompt |
| Sourcing | **Behind-the-scenes only** — no citation UI, no schema fields |
| Value-chain | **Out of scope** — handled in a separate Claude Code session |
| Code/schema impact | **None** — edits `.claude/skills/research/SKILL.md` only |

Approaches B (invoke `ecc:market-research` live) and C (dedicated market-research
sub-agent pass) were rejected: both add per-run token/latency cost and contradict
Assay's "stay lean" principle. Surfaced citations were scoped to value-chain edges
only; with value-chain excluded, the remaining work is fully behind-the-scenes, so
there are **no data-shape changes**.

## What changes

Edit only `.claude/skills/research/SKILL.md`. No changes to `src/`, no migrations,
no rebuild.

### 1. Add a "Research discipline" block

A compact block distilled from the five `ecc:market-research` standards, written to
fit Assay's structured panels (not the skill's report format):

1. **Source important claims** — a non-obvious market/competitive claim must be
   grounded in something Claude actually saw (the app-fetched bundle, the news feed,
   or a search already run), not asserted. No citation UI — this is reasoning
   discipline, not a rendered field.
2. **Flag stale data** — when consensus/targets predate a known event, say so in the
   panel's `note` / `asOf`. (Precedent: the AAPL run flagged that consensus predated
   the CEO-succession headline.)
3. **Weigh contrarian evidence** — the recommendation must carry the opposing case;
   `buyIf` / `avoidIf` are the vehicle. No one-sided theses.
4. **Separate fact / inference / recommendation** — label interpretation as
   interpretation (e.g. "ROE 141% is a buyback artifact" is inference, not a reported
   figure).
5. **Decide, don't summarize** — reinforce the existing ethos of the recommendation
   panel.

### 2. Weave pointers into the existing sections

No new panels. Touch points:

- **Recommendation (main agent / Opus)** — one-line pointer to the discipline block in
  the existing "Recommendation" section: emphasize contrarian evidence, fact/inference
  separation, and stale-data flagging.
- **Risks (main agent / Opus)** — pointer emphasizing source-discipline and
  fact-vs-inference on each risk point.
- **Sub-agent panels (sec-summary, news)** — light touch. `news` already has
  `source` / `url` / `date` fields, so a "flag stale, set sentiment honestly" nudge.
  `sec-summary` is reported figures (facts) — minimal change.

Estimated change: ~30–40 lines of prompt guidance added to one markdown file.

## Success criteria

A re-run of `/research <TICKER>` produces recommendation/risks panels that:

1. Always include the opposing case (contrarian evidence present).
2. Flag any stale consensus/target in `note` / `asOf` when a more recent event is known.
3. Distinguish reported figures from Claude's interpretation.

Verifiable by reading the rendered panels. No measurable cost increase vs today — the
change mandates **no additional tool calls** (discipline applies to data already
gathered).

## Out of scope

- Value-chain panel (separate session).
- Any surfaced citation UI or `sources` schema field.
- Invoking `ecc:market-research` at runtime.
- Any `src/` or database change.
