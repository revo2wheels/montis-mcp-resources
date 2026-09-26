# Periodization targets & weekly reconciliation

This is the deterministic layer of the Montis plan builder. It fixes the **weekly load ramp**, the **block/recovery structure**, and the **weekly-total reconciliation** so the plan's periodization is mathematically correct and not left to the model's judgement.

Prefer running `scripts/periodization.mjs` (a verbatim, dependency-free port of the Montis engine functions) to compute the numbers. Only follow the rules below by hand when you cannot run the script. **Do not free-hand the TSS ramp** — small drift compounds across a block and breaks the periodization.

The best fidelity is to call a Montis MCP tool for these targets if one is exposed (`tools/list`). Absent that, use the script, then the rules.

## Inputs (load constraints)

- `duration_weeks` — clamped to 1..24 (default 8).
- `block_cycle` — `"L:R"`, loading:recovery weeks, e.g. `"3:1"`, `"2:1"`, `"4:1"` (default `3:1`).
- `starting_tss` — week-1 weekly TSS, min 50 (default 350).
- `weekly_target_hours` — min 1 (default 8).
- `training_frequency` — sessions per week, clamped 2..7 (default 4).
- `load_progression_limits.week_2_growth_pct` / `week_3_growth_pct` — default 6 each.
- `recovery_week_reduction` — percent, clamped 15..60 (default 40).
- `theme` — `MAINTAIN` (or STABILIZE/CONSISTENCY), `BUILD` (or PROGRESS), else treated as general/base.

## Week classification

For week index `i` (0-based): `cycleLen = L + R`; `cyclePos = i mod cycleLen`; `cycleNum = floor(i / cycleLen)`. A week is a **recovery** week when `cyclePos >= L`, otherwise a **loading** week.

## Loading-week TSS ramp

Let `g2 = week_2_growth_pct`, `g3 = week_3_growth_pct` (percent).

- **MAINTAIN** (hours stay tight to target):
  - pos 0: `tss = startTss`, `hours = targetHours`
  - pos 1: `tss = round(startTss × (1 + g2/100))`, `hours = targetHours`
  - pos 2: `tss = round( round(startTss×(1+g2/100)) × (1 + g3/100) )`, `hours = round(targetHours×1.03, .1)`
  - pos ≥3 (e.g. 4:1): `tss = round(prevWeekTss × (1 + g3/100))`, `hours = round(targetHours×1.04, .1)`
- **BUILD** (expands across cycles): let `blockBaseTss = cycleNum==0 ? startTss : round(startTss × 1.04^cycleNum)` and `blockBaseHours = cycleNum==0 ? targetHours : round(targetHours × 1.03^cycleNum, .1)`. Then within the block use the same pos-0/1/2 pattern as MAINTAIN but anchored to `blockBaseTss`/`blockBaseHours`, with hours growing modestly (`blockBaseHours × (1 + (g2/100)×0.4)` at pos 1, etc.).
- **General/base**: pos 0 = start; pos 1 = `round(startTss×(1+g2/100))`, `hours = targetHours×(1+(g2/100)×0.3)`; pos ≥2 = `round(prevWeekTss×(1+g3/100))`, `hours = targetHours×1.04`.

## Recovery-week ramp

`tss = round(prevWeekTss × (1 − recovery_week_reduction/100))`; `hours = round(targetHours × (1 − (recovery_week_reduction/100)×0.75), .1)`.

## Per-week output

`{ index, phase: "load"|"recovery", target_tss, target_hours, target_duration_minutes: round(hours×60), training_frequency }`.

### Worked example — MAINTAIN, 3:1, startTss 350, growth 6/6, targetHours 8

| Week | Phase | target_tss | target_hours |
|---|---|---|---|
| 1 | load | 350 | 8.0 |
| 2 | load | 371 | 8.0 |
| 3 | load | 393 | 8.2 |
| 4 | recovery | 236 | 5.6 |
| 5 | load | 350 | 8.0 |
| … | … | … | … |

## Weekly reconciliation (`harmonize`)

After the model drafts each week's sessions, reconcile every week to its `target_tss` / `target_duration_minutes`:

1. Sum the week's session `tss` and `duration_minutes`.
2. If total TSS is within `max(5, target_tss×0.03)` **and** minutes within 15 → keep unchanged.
3. Otherwise absorb the whole delta into **one** session: the **longest non-quality endurance** session (title/desc without `interval`, `threshold`, `vo2`, `main set`, `repeat`). If every session looks like quality, pick the longest overall.
4. On that session set `tss = max(20, tss + tssDiff)`, `duration_minutes = max(30, minutes + minsDiff)`. If its description is a single steady step like `"- 180m 65%"` (no `Main Set`), rewrite the minutes in that token to match.

This deliberately leaves interval/quality sessions untouched and moves flex into the aerobic base session.

## Session text cleanup (`sanitize`)

Before writing to the calendar, clean each `description` with the Intervals.icu rules in `references/workoutsv2.md` (also implemented in `scripts/periodization.mjs → sanitizeWorkoutDescription`):

- every step line starts with `"- "`;
- no absolute values in parentheses (`(159w)`, `(160bpm)`, `(Zone 2)`);
- for cycling, `"100% FTP"` → `"100%"`; strip trailing duplicate watts (`"- 20m 100% 250w"` → `"- 20m 100%"`);
- repeat headers (`Main Set 3x`) on their own line, no leading hyphen, one blank line before and after;
- strength/yoga/core sessions keep their markdown (sets × reps @ RPE), never endurance/percent syntax.
