---
name: montis-app-trial
description: Build the user's own "Montis Today" app, an artifact in the Montis app's look (logo, colours, cards) that reads their training data live through their Montis connector (today's coaching directive, plan and wellness vitals, the week with insights, recent activities, a coach roster) with an Ask Claude box, and can be installed as a desktop app. Use when the user says "build my Montis app", "make my Montis dashboard" or asks for a Montis app in Claude. Trial.
metadata:
  version: "0.3.0"
  updated: "2026-11-28"
---

# Montis Today app (trial)

> Version 0.3.0, updated 2026-11-28. A trial skill, not a release.

## What this skill does

When the user asks for their Montis app, build ONE artifact called **Montis Today** in this conversation, in the user's own account. A page that uses connectors only works for its owner, so never send a link to someone else's page. Each time it opens it reads live through the user's Montis connector; in the Claude desktop app it can be installed as its own window.

This skill ships a working page: `references/montis-today.html`. Start from it rather than writing a new one. It already follows every rule below. Change only what this user's setup needs (the connector name, a tool the connector lacks).

## Before you build

1. Call `connection_status`. If it is not connected, stop and tell the user to add the Montis connector (https://www.montis.icu/setup-claude), then ask again.
2. Find the connector's exact display name in this conversation, as the user's connector list shows it (commonly "Montis ICU Coach (MCP)", but people name it themselves, e.g. "Montis coach"). Never guess it. If more than one Montis connector is connected (for example a staging one), ask the user which one the app should use.
3. In the reference page, replace `__MONTIS_CONNECTOR_NAME__` with that exact name. The page declares and calls the connector by this name only, and the error line quotes it.
4. If you can, call each tool below once to check the answer shape still matches. Learn the shape only: never put the user's values into the page as samples.

## Look: the Montis app

The page should feel like the Montis app. The reference page carries all of this; keep it when you change anything.

- **Logo**: `assets/icon-256.png`. Publish it beside the page as `logo.png`, show it in the header (42 px, rounded) and on the page-level error screen, and, where the desktop ability offers it, set it as the installed app's icon while the page loads.
- **Header**: logo, "Montis **Today**" (Today in Montis green), under it the athlete's name and "Coach intelligence" in small uppercase, a **Refresh** button and, where offered, **Install as app**.
- **Fonts**: Space Grotesk for headings (weight 600, letter-spacing −0.03em), Inter for text, JetBrains Mono for small data.
- **Colours, light**: paper `#f4f6f0` ground, white cards, ink `#0b1816`, soft ink `#42534f`, lines `#dce4dd`, green `#19b77a`, dark green `#087c58`, soft green `#dff2e9`, aqua `#55d7c0`, blue `#3987f6`, red `#ef5350`. **Dark**: ground `#071310`, cards `#0c201b`, text `#ffffff`, muted `#a0b3ac`, muted fill `#122c25`, lines `rgba(255,255,255,.12)`.
- **Zones**: Z1 `#6b7280` recovery, Z2 `#3b82f6` endurance, Z3 `#22c55e` tempo, Z4 `#eab308` threshold, Z5 `#f97316` VO2max, Z6 `#ef4444` anaerobic, Z7 `#a855f7` neuromuscular; minutes without a target "no target (strength, notes)".
- **Shapes**: cards with 1.2rem corners, a soft shadow and a coloured 4 px top stripe; uppercase pills (soft green on green text, 800 weight, wide letter-spacing); big Space Grotesk numbers with a small muted unit. CTL in blue, ATL in orange, TSB in green, load in rose, time in blue.
- **Status colours** come from the report's own `status` fields, never from the page's judgement: positive green, neutral blue, watch amber, strain orange, warning red, risk rose; critical / watch / positive insights in rose / amber / green.
- **Navigation**: tabs as pills along the top on a wide screen; at phone width a fixed bottom bar (60 px, icon tabs, only the active tab shows its label, a green line on top of it).

## The app: four tabs, a fifth for coaches

Each section loads on its own, fails on its own, and shows its own error line with a **Try again** button.

**1. Today**
- *Coaching directive* (first): from the weekly report (Tab 2's call), word for word. A hero card with a red top stripe: the `actions` item with `type` "adaptive_summary" → `directive` (if it contains "Can:" and "Should:", show them as two lines, Can in green and Should in rose), then `training_guidance`. Under it, one striped card each where the report has it: Load state (`training_volume.load_pattern.label`, `.meaning`, pill from `.status`), Autonomic readiness (the "state_action" item → `readiness_signal`), Physiology (`wellness.physiology_state.label`, `.meaning`, pill from `.status`), System progression (the "system_guidance" item → `message`), Next two weeks (`future_actions[0].label` and `.reason`), Next event (`event_targets.next_event` `name`, `date`, `days_to_event`). If `meta.recency.is_current` is false, say "This report is not for the current week." The report has no ready-made "What next" text: do not write one.
- *Planned today*: `get_calendar` with `{start: today, end: today + 7 days}` (dates YYYY-MM-DD in the athlete's `timezone` from `connection_status`). Keep the events whose `start_date_local` starts with today: `name`, `category` (WORKOUT, NOTE, RACE_A/B/C…) as a pill, `type`, `moving_time` (seconds) as Time, `icu_training_load` as Load, and the first 4 non-empty lines of `description`. If there are none, say "Nothing planned for today."
- *Wellness vitals*: `get_wellness` with `{date: today}`. The answer is a list with one record. A "Today · at sunrise" card with `ctl` Fitness (CTL) and `atl` Fatigue (ATL), then one tinted tile per figure the record has: `hrv` Autonomic HRV ms, `restingHR` Resting HR bpm, `sleepSecs` Sleep as h m, `sleepScore`, `readiness`, `BodyBatteryMax` Body Battery, `weight` kg. A null or missing figure gets no tile.

**2. This week**
- `run_weekly` with `{overview: true}`: one call. It is slow (often 10–30 s), so show "Montis is building your weekly report…" meanwhile. Read `semantic_graph`. If it is missing, show the answer's `message` as text.
- Last 7 days (title with `meta.period`): a totals strip of `training_volume.distance_km`, `hours`, `tss`, `CTL` fitness, `ATL` fatigue, `TSB` form; then the `load_pattern.label` pill and `.meaning`.
- This calendar week: `current_ISO_weekly_microcycle`: Weekly TSS as `completed_tss` of `weekly_target_tss` with a bar, and a line "`planned_remaining_tss` still planned · projected `projected_total_tss`"; Weekly time as `completed_hours` of `projected_hours`.
- Time in zones: one stacked bar from `zone_time.zones_min` (`z1`…`z7`, minutes) and `no_zone_min`, drawn to scale against `total_min`; the line "easy `three_zone.easy_pct`% · moderate `moderate_pct`% · hard `hard_pct`%"; a legend with each zone's name and minutes. Print only the minutes and percentages the report gives.
- Insights: `insight_view.critical`, `.watch` and `.positive`, one row each: a Critical / Watch / Positive pill, `name`, `interpretation`, `value`. Leave the card out when all three are empty.
- Next 7 days: the `get_calendar` events after today, one row each: day, name, category and type pills, duration, load.
- The overview has no session count: do not count sessions yourself.

**3. Activities**
- `get_activities` with `{oldest: today − 13 days, newest: today, fields: "id,start_date_local,name,type,moving_time,distance,icu_training_load"}`, newest first, as cards: day, name, type pill, load (large), moving time and km.
- A row with no `name` or `type` is an activity the connector cannot read (for example a Strava one): leave it out and say under the list how many were left out.
- Tapping a card opens it: `get_activity` with `{activity_id: <the row's id, exact text>}`. The answer is `{activities: [{activity: {…}}]}`. Show what it has: `moving_time`, `distance`, `icu_training_load`, `icu_intensity` %, `icu_weighted_avg_watts`, `icu_average_watts`, `average_heartrate`, `max_heartrate`, `average_cadence`, `total_elevation_gain`, `decoupling` %, `icu_efficiency_factor`, `compliance` %, `icu_rpe` /10, `feel` /5, `calories`, and `interval_summary` (a list of strings). If `montis_held` is true, add "From Montis's own copy of this activity."

**4. Ask Claude**
- A text box, quick-question chips ("What next?", "Review fatigue", "Explain today's directive") that fill the box, an **Ask** button (and **Stop** while it answers). Only the athlete's click sends a question; never ask on load.
- Send Claude the question plus the data the page has loaded, as JSON: today's wellness record, the calendar events, the weekly report parts above (plus `insight_view` names, classes and values), the 14-day list and any activity the athlete opened. Tell Claude to use only that data, to say what is missing rather than guess, to explain Montis's guidance rather than overrule it, no medical advice, short plain answer in the question's language.
- Label it on the page: "Claude reads only the figures this page has loaded and answers from them. It uses your own Claude plan." Label the answer "Claude's answer, from the figures on this page". No other AI key is needed.
- Use your environment's artifact ability to ask Claude. If it has none, or the user declines it, leave this tab out.

**5. Coach (only for coaches)**
- `get_coached_athletes` with `{}`. If `athletes` is empty (or the call fails), leave the tab out entirely.
- Otherwise list `name` and a Connected / Not connected pill. A **Load each athlete's week** button calls `coach_cockpit` with `{}`. It is slow because Montis builds a report per athlete, so only call it on that click. One card per item of `athletes`, with a green left border: `name`; if `cockpit_state.data_available` is false, show `cockpit_state.message`; else `insight_counts.critical` and `.watch` pills, `weekly_load.load_pattern_label` and `physiology.state_label` pills, `weekly_load.hours` and `.tss`, `adaptive_decision.directive` (Can / Should split as above) and `adaptive_decision.final_guidance`. Say how many are in `not_connected` and `errors`.

## Rules

- Read-only tools only: `connection_status`, `get_wellness`, `get_calendar`, `run_weekly`, `get_activities`, `get_activity`, `get_coached_athletes`, `coach_cockpit`. Never `calendar_write`, `calendar_delete` or any other tool. Never `check_pending_training_updates`: calling it uses up the athlete's pending update.
- Show only what the tools return. The page works out no figures: no form zone labels, rings, totals, averages or trends of its own. Bars may be drawn to scale from figures the report gives.
- None of the user's data in the page source: the page reads live on open and on Refresh, and stores nothing.
- Every value from the connector or from Claude is text, never markup.
- Ids are exact text: pass `id` back as given, never add or remove a leading "i".
- Name "Intervals.icu" at most once on the page.
- Phone width with no sideways scroll; readable in light and dark.
- If a tool is missing from the connector, leave out the part that needs it and say so to the user. Ask Claude and Coach are optional; Today, This week and Activities are the core.

## Failures (one plain line per failed section, with Try again)

- Connector not added or wrong name: "This app looks for a connector named “<exact name>”. Add the Montis connector in Claude under Plugins, Connectors. If yours has another name, ask Claude to rebuild the app."
- Sign-in lapsed: "Reconnect the Montis connector."
- Not allowed for this page: "Choose Allow when Claude asks."
- Montis unreachable: "Montis did not answer just now. Try again in a moment."
- Anything else: "Your data could not be read just now."

## How to build it

- Use the connector access your artifact environment provides. Make `connection_status` the first call, so a permission prompt comes once, up front. The other calls follow.
- If your environment asks what the page may use, declare the Montis connector by its exact name with exactly the eight tools above, the ask-Claude ability, and installing as a desktop app. Ask for nothing else: no files, notifications or menu bar item.
- Publish `assets/icon-256.png` with the page as `logo.png`.

## After you build it

Tell the user, in four short lines:
1. Open the artifact and choose **Allow** when Claude asks about the Montis connector (and about Claude, the first time you use Ask).
2. In the Claude desktop app, choose **Install as app** from the artifact's menu to keep it as its own window, with the Montis logo as its icon.
3. It reads live each time it opens; nothing is stored in the page, and Ask Claude uses your own Claude plan.
4. It uses the connector named "<exact name>". If you rename or re-add the connector under another name, ask Claude to rebuild the app.
