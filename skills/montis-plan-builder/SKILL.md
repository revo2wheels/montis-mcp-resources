---
name: montis-plan-builder
description: Build a multi-week, block-periodised Montis training plan from authorized Intervals.icu data — governed weekly TSS/hours targets, event-aware structure, valid Intervals.icu workouts — and write it to the athlete's calendar on confirmation.
---

# Montis Plan Builder

Generate a full, multi-week periodised training plan (the "AI Builder v2" workflow) for the connected athlete or an authorized coached athlete, then write it to their Intervals.icu calendar. This is the structured, whole-block planner: it enforces a deterministic weekly load ramp and reconciles every week's totals to target. For a single workout or a conversational "what should I do next", use the `montis-coaching` skill instead.

Use only with authorized Montis.icu / Intervals.icu data via the hosted MCP at `https://montis.icu/mcp`. Never invent athlete numbers; read them.

## Workflow

Follow these steps in order. Do not skip the deterministic target step — the plan's periodization depends on it.

### 1. Gather plan parameters (ask the athlete; offer sensible defaults)

- **Duration** in weeks (1–24) and the **start** (default: next Monday).
- **Periodisation theme**: `MAINTAIN` (hold fitness / consistency), `BUILD` (progressive expansion), or base/general. If a target event is set, align the theme and taper to it.
- **Block cycle** loading:recovery, e.g. `3:1`, `2:1`, `4:1` (default `3:1`).
- **Starting weekly TSS**, **weekly target hours**, **training days per week** (2–7).
- **Growth limits** (default +6% week-2 and week-3) and **recovery-week reduction** (default 40%).
- **Primary sport** and whether to include **auxiliary disciplines**: strength, activation, recovery — and whether auxiliaries may share a day with the primary sport (`allow_multi_day_aux`).
- **Target event(s)**, priority, date, terrain.
- Any **custom instructions**.

### 2. Read the athlete context — the weekly report is the primary source

**Lead with one call: `run_weekly`** (use `overview=true`, or `workflow=true` for the coaching/execution view). The weekly report already carries almost all the context the plan needs — current phase, ADE directive, load (CTL/ATL/TSB, ACWR), physiology/readiness, event targets, planned-vs-completed, and the prescription anchors. Read it before generating; do not answer from memory. See `references/tools_mcp.md`.

Only add a call when the weekly report does **not** supply what you need:

- `get_calendar` over the plan's date range — to place workouts and preserve/avoid existing events and races (needed before writing).
- `get_profile` / `get_sport_settings` — only if the weekly report lacks FTP/CP, threshold pace, LTHR or zones.

Do not fan out across `run_season`, `coach_cockpit`, `get_wellness` etc. as well — that is slow and unnecessary; the weekly report is the context. Include any **curated progression pathways** the athlete supplies (with a `suggested_target` per pathway). Assemble what you read into a compact context object organised by the priority hierarchy below.

### 3. Compute the deterministic weekly targets — do not free-hand this

Compute per-week `target_tss`, `target_hours`, `target_duration_minutes`, `phase` (load/recovery) and `training_frequency` from the load constraints and theme, using, in order of preference:

1. a Montis MCP tool for plan targets if `tools/list` exposes one;
2. otherwise run `scripts/periodization.mjs targets '<loadConstraintsJSON>' '<theme>'`;
3. otherwise follow `references/periodization.md` by hand.

These numbers are governance. An LLM will not reliably reproduce the compounding ramp and block/recovery math.

### 4. Generate the plan (LLM)

Draft the sessions for every week. The model chooses session selection, titles, descriptions, intra-week distribution and the rationale — **within** the fixed targets and the rules below.

**Strict priority hierarchy — lower layers must never contradict higher layers:**

1. **Hard overrides** — athlete directives, injuries, explicit custom instructions.
2. **Plan governance** — microcycle phase, event taper, the weekly TSS/hours targets from step 3, sport constraints.
3. **Prescription anchors** — FTP, CP, personalised Z2 / LT1, threshold pace, LTHR.
4. **Progression evidence** — ESPE / performance-intelligence matching the theme, and curated progression pathways. If a curated pathway is provided, incorporate its next progressive step; a pathway's `suggested_target` is authoritative for that quality session.

**Load & progression governance (mandatory):**

1. **Weekly load adherence** — each week's session `tss` must sum to `target_tss` within ±3%, and `duration_minutes` to `target_duration_minutes` within ±5%. Put the flex into the aerobic Z2 endurance session. Each week has exactly `training_frequency` sessions. Week 1 must not fall below its starting TSS.
2. **Volume envelope** — for `MAINTAIN`, keep weekly hours within +5% of target; do not create 14-hour weeks when target is 11.6h.
3. **Key-session progression** — across loading weeks in a block, recurring quality sessions progress **monotonically** (never regress interval duration, work-in-zone or intensity); if a pathway says `REPEAT_FOR_CONFIRMATION`, hold the exact prescription until confirmed. Reduce only in designated recovery weeks.
4. **Rationale numeric integrity** — every number in the rationale must match the actual sessions generated.

For **strength** and other auxiliaries, follow `references/strength_skill.md` (event type `WeightTraining`, sets×reps @ RPE, no endurance/percent syntax, endurance-first interference rules, phase-dependent and single-variable progression).

**Workout step formatting — strict, at generation time** (the full rules are in `references/workoutsv2.md`; read it before writing any workout — these are the non-negotiable ones):

- **Every step line starts with `"- "`** (hyphen + space). Give every step a duration or distance, and exactly **one** intensity anchor.
- **No absolute values in parentheses** — never `(159w)`, `(160bpm)`, `(Zone 2)` — and no trailing duplicate watts (`"- 20m 100% 250w"` → `"- 20m 100%"`).
- **Repeat blocks**: put the repeat header (`Main Set 3x`, or `3x`) on **its own line with no leading hyphen**, and leave **one blank line before and after** the block; steps inside start with `"- "`.
- **Per-sport intensity anchor:**
  - **Ride/bike** with FTP → bare `%` of FTP (`"- 10m 85%"`, `"- 8m 105%"`); no FTP → heart rate (`"- 15m 75% HR"`, `"- 5m 80% LTHR"`, `"- 20m 145bpm"`). Never write `"% FTP"` — bare `%` only.
  - **Run** → **never** bare `%`; use pace (`"- 10m 5:00/km Pace"`, `"- 4m 105% Pace"`) or heart rate.
  - **Swim** → pace per 100 (`"- 100m 1:45/100m Pace"`) or distance pace; never bare `%`.
  - **Strength (`WeightTraining`)** → `movement sets×reps @ RPE/RIR` (`"- Goblet Squat 3x8 @ RPE 7"`); never endurance/percent/pace syntax. Don't invent kg/lb loads unless the athlete gave them.
  - **Yoga/mobility/recovery** → simple steady instruction, no complex intensity.
- **Output raw JSON only** — no markdown fences, no prose around it.

Example (cycling):

```text
- Warmup 20m 50%

Main Set 3x
- 8m 95%
- 4m 50%

- Cooldown 15m 50%
```

Produce this JSON shape:

```json
{
  "rationale": {
    "target_theme": "...", "training_load": "...", "recovery": "...",
    "completed_vs_prescribed": "...", "upcoming_events": "...",
    "overall_coaching_verdict": "..."
  },
  "weeks": {
    "1": [ { "title": "...", "type": "...", "description": "...", "duration_minutes": 60, "tss": 50, "date": "YYYY-MM-DD" } ]
  }
}
```

### 5. Reconcile and clean (deterministic)

- Run `scripts/periodization.mjs harmonize '<weeksJSON>' '<targetsJSON>'` (or follow `references/periodization.md`) to snap each week's totals onto target by adjusting the longest aerobic session, leaving interval sessions untouched.
- Clean every `description` with `sanitizeWorkoutDescription` (same script) so each step is valid Intervals.icu DSL.

### 6. Always show the plan first (never write on this step)

Present the finished plan to the athlete before touching the calendar:

- the weekly targets (phase, TSS, hours) and the reconciled per-week sessions, plus the rationale;
- the total number of weeks and the exact date range;
- a note of any existing planned workouts your plan would overlap or replace.

**Present it visually, matched to the client:**

- **Always** render a per-week table — day, sport, title, duration, TSS — with a simple bar for each week's total TSS against `target_tss` (e.g. unicode block bars), so the ramp is readable in plain text.
- **On clients that render rich content** (claude.ai and Claude Code artifacts): also produce an HTML/SVG view that draws each workout as zone-coloured step segments (parse the `- <dur> <intensity>` steps and the `Main Set Nx` repeats) and a weekly TSS-vs-target chart — a lightweight echo of the app's visualiser. Keep it read-only. On ChatGPT or other text-only surfaces, skip the artifact and rely on the table.
- Never block the plan summary or the commit step on the visual — the table is the source of truth; the artifact is a convenience.

Then ask what to commit — all of it, or a specific week range. This step writes nothing.

### 7. Commit only after explicit confirmation

- Write only what the athlete confirmed. Follow `references/workoutsv2.md` and the Calendar Safety rules below.
- Write with a single bulk `calendar_write` call carrying `planned_workouts[]`: each `{ date, title, name, type, category: "WORKOUT", description, duration_minutes, tss }`.
- Preserve races and existing events the athlete did not ask to change; skip past dates. Remove overlapping existing WORKOUT events with `calendar_delete` only after the athlete has confirmed the replacement.
- Report back what was written (weeks and dates), and any errors plainly.

## Calendar safety and authorization

- Confirm explicitly before any `calendar_write` that may replace events, and before any `calendar_delete`. Identify the exact events and dates. Do not delete-and-recreate when an update is possible.
- Act only on the connected athlete, or an authorized coached athlete (pass `athleteID`). Respect the hosted service's entitlement and authorization; report a returned error and any `reconnect_url` plainly.

## What this skill does not do (vs the app's AI Builder v2)

The interactive app extras are not part of this skill: the drag-drop step editor, the live in-app TSS/hours chart and per-step visualiser, saved-plan history/templates, and click-to-select week/day commit. The plan is still shown visually (a table everywhere, and a read-only zone-block / TSS-chart artifact on Claude — see step 6), but that is a static echo, not the app's editable visualiser. Selective commit is handled conversationally ("commit weeks 1–4?"). Everything that determines plan quality — the governed targets, the generation rules, harmonisation and DSL validity — is preserved.

## References

- `references/periodization.md` — the deterministic ramp, block/recovery math, weekly reconciliation and DSL cleanup (with a worked example). Read before step 3/5.
- `references/workoutsv2.md` — Intervals.icu workout and interval construction rules. Read before writing any workout or calendar event.
- `references/strength_skill.md` — strength methodology, progression and endurance-strength integration.
- `references/tools_mcp.md` — exact MCP tool selection, parameters, sequencing and error handling.
- `scripts/periodization.mjs` — runnable, dependency-free port of the Montis target/harmonise/sanitise functions.
