# Market-Research Discipline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bake `ecc:market-research` methodology into the `/research` skill prompt as behind-the-scenes reasoning discipline, so the recommendation/risks/news panels are consistently sourced, contrarian-aware, and decision-oriented.

**Architecture:** Single-file prompt edit. Add one "Research discipline" section to `.claude/skills/research/SKILL.md` (read by the main agent), then add short pointers from the Recommendation and Risks sections, plus a micro-nudge inside the Sonnet sub-agent blockquote for the news panel. No `src/`, no schema, no rebuild.

**Tech Stack:** Markdown (Claude Code skill prompt). No code, no tests, no dependencies.

---

## File Structure

- **Modify:** `.claude/skills/research/SKILL.md` — the only file touched. Adds a shared discipline section + three small pointers.

There are no new files and no code units. The "interface" is the prompt contract the agent reads at `/research` time.

## Scope Note

This plan covers one subsystem (the `/research` prompt). It is self-contained: after it lands, a `/research` run exhibits the new discipline. Value-chain is explicitly out of scope (separate session).

## Verification Model

Because this is a prompt edit, "tests" are: (a) `grep` confirming the inserted text is present, and (b) a read-back for well-formedness. The end-to-end acceptance check (optional, costs a live run) is a single `/research` pass whose recommendation/risks panels show the opposing case + a stale-data flag where applicable.

---

### Task 1: Add the shared "Research discipline" section

**Files:**
- Modify: `.claude/skills/research/SKILL.md` (insert between the "How to run this" list and "## Sub-agent prompt", currently lines 16–18)

- [ ] **Step 1: Insert the discipline section**

Use Edit with this exact `old_string`:

```
5. Relay to the user: confirm both panels rendered, and surface your recommendation **call + headline**. Don't re-paste the raw bundle.

## Sub-agent prompt (substitute `<TICKER>`)
```

and this exact `new_string`:

```
5. Relay to the user: confirm both panels rendered, and surface your recommendation **call + headline**. Don't re-paste the raw bundle.

## Research discipline (applies to every panel you write)

Distilled from market-research methodology. Apply as **behind-the-scenes reasoning discipline** — there is no citation UI; do not add a `sources` field. Five standards:

1. **Source important claims.** A non-obvious market/competitive claim must be grounded in something you actually saw — the app-fetched `data` bundle, the sub-agent's news/risk inputs, or a search you ran — not asserted from memory. If you can't ground it, soften it or drop it.
2. **Flag stale data.** When consensus, price targets, or figures predate a known newer event, say so in the panel's `note` / `asOf` (e.g. a "Strong Buy" consensus that predates a CEO-departure headline).
3. **Weigh contrarian evidence.** Never write a one-sided thesis. The recommendation's `buyIf` / `avoidIf` carry the opposing case; the risks panel is the downside case. Steelman the other side.
4. **Separate fact from inference.** Distinguish reported figures from your interpretation (e.g. "ROE 141%" is a fact; "that's a buyback artifact, not organic returns" is inference — label it).
5. **Decide, don't summarize.** Every panel should make the user's decision easier, not restate data. End on a call or a clear "so what."

## Sub-agent prompt (substitute `<TICKER>`)
```

- [ ] **Step 2: Verify the section is present**

Run: `grep -n "## Research discipline" .claude/skills/research/SKILL.md`
Expected: one match, on the line between the orchestration list and the sub-agent prompt heading.

Run: `grep -c "Decide, don't summarize" .claude/skills/research/SKILL.md`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/research/SKILL.md
git commit -m "feat(research): add market-research discipline section to skill prompt"
```

---

### Task 2: Point the Recommendation section at the discipline

**Files:**
- Modify: `.claude/skills/research/SKILL.md` (the "## Recommendation" section intro, currently line 114)

- [ ] **Step 1: Add a discipline pointer bullet**

Use Edit with this exact `old_string`:

```
After the sub-agent returns, write the recommendation **yourself** from its `data` bundle — this is the judgment call, kept on the stronger model:
- **Call + thesis:** your own buy/hold/avoid with reasoning, `buyIf`, `avoidIf`. Apply a **consistent valuation discipline across tickers** (e.g. forward P/E vs growth — the cross-ticker consistency is the main reason this lives on Opus, not the sub-agent). For non-USD filers, lean on currency-clean signals (forward P/E, margins, growth, price-vs-MA) and **ignore cross-currency ratios** like P/S.
```

and this exact `new_string`:

```
After the sub-agent returns, write the recommendation **yourself** from its `data` bundle — this is the judgment call, kept on the stronger model:
- **Apply the Research discipline** (above): weigh contrarian evidence (the thesis must acknowledge the opposing case, with `buyIf` / `avoidIf` as the vehicle), separate fact from inference, and flag stale consensus/targets in `asOf` when a newer event is known.
- **Call + thesis:** your own buy/hold/avoid with reasoning, `buyIf`, `avoidIf`. Apply a **consistent valuation discipline across tickers** (e.g. forward P/E vs growth — the cross-ticker consistency is the main reason this lives on Opus, not the sub-agent). For non-USD filers, lean on currency-clean signals (forward P/E, margins, growth, price-vs-MA) and **ignore cross-currency ratios** like P/S.
```

- [ ] **Step 2: Verify the pointer is present**

Run: `grep -n "Apply the Research discipline" .claude/skills/research/SKILL.md`
Expected: one match inside the Recommendation section (after line ~114).

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/research/SKILL.md
git commit -m "feat(research): point recommendation panel at discipline standards"
```

---

### Task 3: Point the Risks section at the discipline

**Files:**
- Modify: `.claude/skills/research/SKILL.md` (the "## Risks" section intro, currently line 146)

- [ ] **Step 1: Add a discipline pointer bullet**

Use Edit with this exact `old_string`:

```
After the sub-agent returns, write the `risks` panel **yourself** from its risk-input notes + the `data` bundle + SEC figures — the severity judgment stays on the stronger model:
- **Categories:** group risks under labels like Financial / Competitive / Regulatory / Macro / Operational. Each gets a `severity` (`high` | `medium` | `low`) and tight bullet `points`.
```

and this exact `new_string`:

```
After the sub-agent returns, write the `risks` panel **yourself** from its risk-input notes + the `data` bundle + SEC figures — the severity judgment stays on the stronger model:
- **Apply the Research discipline** (above): every risk point should be grounded in the bundle/filing/news inputs (not asserted), and you should separate reported facts from your inference when stating a point. Note unconfirmed or stale items rather than presenting them as settled.
- **Categories:** group risks under labels like Financial / Competitive / Regulatory / Macro / Operational. Each gets a `severity` (`high` | `medium` | `low`) and tight bullet `points`.
```

- [ ] **Step 2: Verify the pointer is present**

Run: `grep -c "Apply the Research discipline" .claude/skills/research/SKILL.md`
Expected: `2` (one in Recommendation from Task 2, one here in Risks).

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/research/SKILL.md
git commit -m "feat(research): point risks panel at discipline standards"
```

---

### Task 4: Light-touch discipline nudge for the sub-agent news panel

**Files:**
- Modify: `.claude/skills/research/SKILL.md` (inside the Sonnet sub-agent blockquote, step 3b, currently line 81)

Rationale: the Sonnet sub-agent reads only the blockquoted prompt — it does not see the top-level "Research discipline" section — so its one judgment panel (`news`) needs the nudge inlined. `sec-summary` is reported figures (facts) and needs no change.

- [ ] **Step 1: Append the discipline nudge to the news instructions**

Use Edit with this exact `old_string`:

```
> Do NOT send markdown for this type. Keep `why` to one tight line; set `sentiment` per item; use ISO dates (`YYYY-MM-DD`).
```

and this exact `new_string`:

```
> Do NOT send markdown for this type. Keep `why` to one tight line; set `sentiment` per item; use ISO dates (`YYYY-MM-DD`).
> **Discipline:** include a headline only if it's material; set `sentiment` honestly (not optimistically); ground each `why` in the item itself; flag any stale or unconfirmed item in `note` rather than presenting it as settled.
```

- [ ] **Step 2: Verify the nudge is present and still inside the blockquote**

Run: ``grep -n "set \`sentiment\` honestly" .claude/skills/research/SKILL.md``
Expected: one match; the line begins with `> ` (still part of the sub-agent blockquote).

- [ ] **Step 3: Commit**

```bash
git add .claude/skills/research/SKILL.md
git commit -m "feat(research): add discipline nudge to sub-agent news panel"
```

---

### Task 5: (Optional) Live acceptance check

**Only run if you want end-to-end confirmation — this spends a real `/research` run.**

- [ ] **Step 1: Run a research pass**

In Claude Code: `/research <a ticker with a recent material headline>` (a name where stale-data flagging will actually trigger is the best test).

- [ ] **Step 2: Confirm the success criteria**

Read the rendered Recommendation and Risks panels and confirm:
- The recommendation includes the opposing case (`buyIf` and `avoidIf` both meaningfully populated).
- Any consensus/target that predates a newer event is flagged in `note` / `asOf`.
- Risk points distinguish reported figures from interpretation.

Expected: all three hold. If any is missing, the discipline wording needs strengthening — return to Task 1's section and tighten the relevant standard.

---

## Self-Review

**1. Spec coverage:**
- Spec §"Add a Research discipline block" → Task 1 ✅ (all five standards inserted).
- Spec §"Weave pointers into existing sections" → Tasks 2 (recommendation), 3 (risks), 4 (sub-agent news) ✅.
- Spec §"sec-summary minimal change" → covered by omission, with rationale stated in Task 4 ✅.
- Spec §"Success criteria" → Task 5 acceptance check maps to the three criteria ✅.
- Spec §"Out of scope" (value-chain, citation UI, runtime invocation, src/db) → no task touches any of these ✅.

**2. Placeholder scan:** No TBD/TODO/"handle appropriately". Every Edit shows exact old/new strings. ✅

**3. Type consistency:** No code types. The pointer phrase "Apply the Research discipline" is used identically in Tasks 2 and 3, and Task 3's grep expects count `2`, consistent with Task 2 adding the first. ✅

All checks pass.
