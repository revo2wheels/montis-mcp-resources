---
name: montis-plan-builder
description: Build a multi-week, block-periodised Montis training plan from authorized Intervals.icu data — governed weekly TSS/hours targets, event-aware structure, Run and Ride race plans for an A race (marathon, half, 10K; crit, road race, time trial, cyclocross, gran fondo, gravel), valid Intervals.icu workouts — and write it to the athlete's calendar on confirmation.
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

**Race plan:** a plan up to an **A race** for a Run marathon, half marathon or 10K, or a Ride crit, road race, time trial, cyclocross race, gran fondo or gravel event, is a race plan. Its weeks come from the athlete's own last 4 weeks of that sport and the race, not from the start TSS, block cycle and growth limits above: see `references/race_plans.md`. Only an A race gets a taper. A plan up to a B or C race uses the general plan and stops the day before the race; say that race plans with a taper need an A race.

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

**In a race plan, use `scripts/race_plan.mjs` instead** (`references/race_plans.md`, steps 1 to 4):
- `detect` names the event.
- `get_activities` over the last 28 days with `run-baseline` or `ride-baseline` gives the start.
- `run-weeks` or `ride-weeks` sets each week: its kind (build, lighter, peak, taper, race week), load and hours, the long run or ride, race-pace minutes (Run), and the hard sessions with their tempo and hard minutes (Ride).
- Without the script, follow the rules in that reference by hand.

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

**In a race plan**, add the session rules that `run-prompt` or `ride-prompt` prints. They outrank the load rules above where the two differ:
- The long run or ride is exactly its set length, with no spare minutes moved into it.
- Race-pace minutes (Run), and tempo and hard minutes (Ride), are written as given.
- Every session is the race's sport, and a rest day is a note.
- Race day holds no workout: the race is already on the calendar.

For **strength** and other auxiliaries, follow `references/strength_skill.md` (event type `WeightTraining`, sets×reps @ RPE, no endurance/percent syntax, endurance-first interference rules, phase-dependent and single-variable progression).

**Workout step formatting — strict, at generation time** (the full rules are in `references/workoutsv2.md`; read it before writing any workout — these are the non-negotiable ones):

- **Every step line starts with `"- "`** (hyphen + space). Give every step a duration or distance, and exactly **one** intensity anchor.
- **No absolute values in parentheses** — never `(159w)`, `(160bpm)`, `(Zone 2)` — and no trailing duplicate watts (`"- 20m 100% 250w"` → `"- 20m 100%"`).
- **Repeat blocks**: put the repeat header (`Main Set 3x`, or `3x`) on **its own line with no leading hyphen**, and leave **one blank line before and after** the block; steps inside start with `"- "`.
- **Per-sport intensity anchor:**
  - **Ride/bike** with FTP → bare `%` of FTP (`"- 10m 85%"`, `"- 8m 105%"`); no FTP → heart rate (`"- 15m 75% HR"`, `"- 5m 80% LTHR"`, `"- 20m 145bpm"`). Never write `"% FTP"` — bare `%` only.
  - **Run** → the first metric in the run's `load_order` (Intervals.icu Training Load Priority, `meta.athlete.profiles.run.load_order`) that has a threshold set: `POWER` → bare `%` of FTP (`"- 10m 75%"`), `PACE` → pace (`"- 10m 5:00/km Pace"`, `"- 4m 105% Pace"`), `HR` → `% LTHR` or HR zones (`"- 10m 95% LTHR"`, `"- 40m Z2 HR"`). An explicit athlete request wins. If `load_order` is unknown: pace, never bare `%`.
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
- **In a race plan**, reconcile with `scripts/race_plan.mjs run-reconcile` or `ride-reconcile` instead of `harmonize`. It does the following:
  - Minutes and load come from each session's own steps, and the long session keeps its set length.
  - Ride only: a lighter, taper or race week keeps one short hard session.
  - Then check: if more than a quarter of the sessions have no step lines, or (Ride) most build and peak weeks have no work above 105%, write those weeks again.

### 6. Always show the plan first (never write on this step)

Present the finished plan to the athlete before touching the calendar:

- the weekly targets (phase, TSS, hours) and the reconciled per-week sessions, plus the rationale;
- the total number of weeks and the exact date range;
- a note of any existing planned workouts your plan would overlap or replace.

**Present it visually, matched to the client:**

- **Always** render a per-week table — day, sport, title, duration, TSS — with a simple bar for each week's total TSS against `target_tss` (e.g. unicode block bars), so the ramp is readable in plain text. Give the % change on the week before, so rises, lighter weeks and the taper show. A race plan's table also gives each week's kind, plus the long run and race-pace minutes (Run), or the long ride and hard sessions (Ride).
- **On clients that render rich content** (claude.ai and Claude Code artifacts): also produce an HTML/SVG view that draws each workout as zone-coloured step segments (parse the `- <dur> <intensity>` steps and the `Main Set Nx` repeats) and a weekly TSS-vs-target chart — a lightweight echo of the app's visualiser. Keep it read-only. On ChatGPT or other text-only surfaces, skip the artifact and rely on the table.
- Never block the plan summary or the commit step on the visual — the table is the source of truth; the artifact is a convenience.

Then ask what to commit — all of it, or a specific week range. This step writes nothing.

**Changes before commit:** the athlete can ask to move, swap, lengthen, add or remove sessions in any weeks. Show each change first, and ask which weeks when they haven't said. Make it only once they agree. Their changes stand even past the plan's own rules, such as a longer long run, as it's their plan. Don't regenerate a plan they have changed without saying their changes will be lost.

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
- `references/race_plans.md` — Run and Ride race plans for an A race: when they apply, the steps, and the rules for each distance and event. Read before step 3 of a race plan.
- `scripts/race_plan.mjs` — the Montis app's own race plan code, bundled and dependency-free: event detection, the athlete's start, the weeks, the session rules and reconciliation. Run it with no arguments for its commands.
- `references/workoutsv2.md` — Intervals.icu workout and interval construction rules. Read before writing any workout or calendar event.
- `references/strength_skill.md` — strength methodology, progression and endurance-strength integration.
- `references/tools_mcp.md` — exact MCP tool selection, parameters, sequencing and error handling.
- `scripts/periodization.mjs` — runnable, dependency-free port of the Montis target/harmonise/sanitise functions.
