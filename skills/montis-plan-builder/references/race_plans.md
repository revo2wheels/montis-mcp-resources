# Race plans: Run and Ride

A plan that ends on an **A race** in a supported event is a race plan. The code sets every week, and the model writes the sessions to fit. These are the same rules as the Montis app's AI Builder v2. The science and test results are in the Montis Help pages [Plan Science: Run](https://www.montis.icu/help/science_plans_run) and [Plan Science: Ride](https://www.montis.icu/help/science_plans_ride).

Run `scripts/race_plan.mjs`, a bundle of the app's own race-plan code, for every number. Follow the rules below by hand only when you cannot run the script.

## When it applies

- **Run:** marathon, half marathon or 10K.
- **Ride:** crit, road race, time trial (tt), cyclocross (cx), gran fondo (fondo) or gravel.
- The plan's last day is the race, and the race is the athlete's **A race** for this plan. Only an A race gets a taper.
  - A plan up to a B or C race uses the general plan (`references/periodization.md`), which stops the day before the race. Tell the athlete that race plans with a taper need an A race. If this is the race they're building for, they can treat it as their A race for this plan: their calendar keeps its own category.
  - Any other distance or event uses the general plan.
- Weeks: at least 6 for a marathon or half, 4 for a 10K, 4 for a crit, road race, time trial or cyclocross, 6 for a gran fondo and 8 for gravel.

## Steps

1. **Event.** Read the race from `get_calendar` and run `node scripts/race_plan.mjs detect '<raceJSON>'` with its `name`, `distance` or `distance_target`, and `moving_time`. It gives `run_distance` or `ride_event` and, for a long ride event, its hours. Confirm it with the athlete. A Ride race whose name and length say nothing gives no event: ask which it is.
2. **The athlete's start, from the last 4 weeks of that sport only.** Call `get_activities` with `oldest` = today − 28 days, `newest` = today and `fields` = `id,type,start_date_local,moving_time,distance,icu_training_load`. Pass the reply to `run-baseline` or `ride-baseline`. It returns weekly `tss`, `hours`, the longest run (`longestKm`) and speed (`speedKmh`), or the longest ride (`longestHours`).
   - Run with no runs: start at 150 TSS, 2.5 h, longest 8 km, 10 km/h, and say so.
   - Ride with no rides: use the start the athlete gives, and say so.
3. **Race pace (Run).** `run-pace <distance> <thresholdKmh>`, with threshold speed = 3600 ÷ threshold pace in s/km from the weekly report or `get_sport_settings`. Without a threshold, leave it out: the script uses the distance's usual share.
4. **The weeks.** Call `run-weeks` or `ride-weeks` with the input below and `baseWeeks` `[{ "index": 1, "startStr": "YYYY-MM-DD", "endStr": "YYYY-MM-DD" }, …]`. Week 1 starts on a Monday, and the last week is race week.
   - Run input: `{ distance, start_tss, start_hours, longest_km, speed_kmh, weeks, days, last_week_days, race_date, b_race_weeks, b_race_dates, pace_percent }`.
   - Ride input: `{ event, start_tss, start_hours, longest_hours, event_hours, weeks, days, last_week_days, race_date, b_race_weeks, b_race_dates }`.
   - `last_week_days` is the race week's days up to race day (7 when the race is on a Sunday). B races are other races inside the plan, before the peak.
   - Each week comes back with `week_kind` (build, lighter, peak, taper, race_week, b_race, b_recovery), `target_tss`, `target_hours`, `target_duration_minutes` and `training_frequency`.
     - Run weeks add `long_run_km`, `long_run_minutes` and `race_pace_minutes`.
     - Ride weeks add `long_ride_minutes`, `quality_sessions`, `tempo_minutes` (work at 76 to 105%) and `hard_minutes` (work above 105%).
5. **The session rules.** `run-prompt '<runInput>' <PACE|HR|POWER>` (the run's target metric, as SKILL.md step 4 picks it) or `ride-prompt '<rideInput>'` prints the rules for writing the sessions. They outrank the general load rules where the two differ. Write the sessions to them, week by week.
6. **Reconcile.** Use `run-reconcile '<weeks>' '<targets>' <metric> '<bRaceDates>' <raceDate>` or `ride-reconcile '<weeks>' '<targets>' '<bRaceDates>' <raceDate>` instead of `harmonize`. It does the following:
   - Minutes and load come from each session's steps, and a session with no steps gets easy ones.
   - A rest becomes a note.
   - The long session keeps its set length, and easy sessions give back a week's overrun.
   - Ride only: a lighter, taper or race week keeps one short hard session (3 × 3 minutes at 108%).
   - Race day holds no workout. The race is already on the calendar.
7. **Check before you show it.**
   - If more than a quarter of the sessions have no step lines, write those weeks again.
   - Ride: if most build and peak weeks with 6 or more `hard_minutes` have no work above 105%, write those weeks again.
8. **Show it.** Add these columns to the weekly table: the week kind, plus long run and race-pace minutes (Run), or long ride and hard sessions (Ride).

## Run rules

| Rule | Marathon | Half marathon | 10K |
|---|---|---|---|
| Weekly rise | 5% | 6% | 6% |
| Most the plan rises | ×2 under 45 km a week, ×1.75 to 60, ×1.6 to 80, ×1.5 to 100, ×1.3 above | ×2 under 40 km a week, ×1.4 above | ×1.4 |
| Low base | Up to ×3 (7% a week) to reach 55 km a week | Up to ×2.2 (8%) to reach 36 km | Up to ×1.8 (8%) to reach 25 km |
| Peak | 3 weeks before the race | 2 weeks before | 3 weeks before |
| Taper, share of the peak | 75 / 55 / 25% | 75 / 35% | 90 / 75 / 30% |
| Lighter week | Every 4th, at 80% | Every 4th, at 88% | Every 4th, at 88% |
| Longest long run | 32 km or 3 hours | 21 km or 2 hours | 16 km or 100 minutes |
| Long run in the taper | 70 / 40% of the longest | 60% | 75 / 50% |
| Race pace | From 12 weeks out, 8 to 15% of the week | From 10 weeks out, 10 to 15% | From 6 weeks out, 6 to 10% |
| Quality sessions a build week | 1 | 1 | 2 |

By hand:
- A plan of N weeks peaks in week P = N − (taper weeks).
- Start S TSS and H hours. Build week w: TSS = S × r^((w − 1)/(P − 1)), where r = the lower of 1.05^(P − 1) (or 1.06) and the "most" for the start's km a week.
- Lighter weeks are every 4th, but never the week before the peak.
- Taper weeks are the peak × the taper shares.
- Hours = H × (TSS/S)^0.9.
- Long run:
  - Each build week grows it 10% from the longest so far, up to the cap.
  - Lighter weeks and the week before the peak take 75%.
  - It's never more than 55% of the week's km.
  - Race week has none.

## Ride rules

| Rule | Crit | Road race | Time trial | Cyclocross | Gran fondo | Gravel |
|---|---|---|---|---|---|---|
| Weekly rise | 4% | 4% | 4% | 4% | 5% | 5% |
| Most the plan rises | ×1.4 | ×1.5 | ×1.4 | ×1.4 | ×1.6 | ×1.7 |
| Peak | 2 weeks out | 2 weeks out | 2 weeks out | 2 weeks out | 2 weeks out | 3 weeks out |
| Taper, share of the peak | 70 / 45% | 70 / 45% | 70 / 45% | 70 / 45% | 70 / 40% | 75 / 55 / 35% |
| Longest ride | 2 h 30 | 4 h 30 | 3 h | 2 h 30 | 80% of the event, up to 6 h | 60% of the event, up to 6 h |
| Hard sessions a loading week | 2 | 2 | 2 | 2 | 2 | 2 |
| Time at tempo to threshold (76 to 105%) | 8% | 8% | 17% | 8% | 13% | 12% |
| Minutes above threshold, per hour of the week | 3 | 3 | 1.5 | 3 | 3 | 3 |

What the hard sessions are:

| Event | Hard sessions |
|---|---|
| Crit | One VO2 session (30/15s, or 3 to 5 minutes at 110 to 120%) and one race session of repeated 15 to 60 second efforts at 130 to 200%, and sprints |
| Road race | One VO2 session and one threshold or race session with surges above 120% inside longer efforts |
| Time trial | One threshold session (2 to 4 × 10 to 20 minutes at 95 to 105%) and one VO2 session |
| Cyclocross | One VO2 session and one session of repeated 15 to 30 second efforts at 130 to 200%, with skills |
| Gran fondo and gravel | One VO2 session (4 to 6 × 3 to 5 minutes at 110 to 120%, or 30/15s) and one threshold session (2 to 3 × 10 to 20 minutes at 90 to 100%) |

By hand:
- Lighter weeks are at 70%, counted back from the peak: the block before the peak is three loading weeks.
- Lighter, taper and race weeks keep one short hard session: 3 × 3 minutes at 105 to 110%.
- Hours = H × (TSS/S)^0.9.
- Long ride:
  - Each build week grows it 12% from the longest so far, up to the cap.
  - Lighter weeks take 70%.
  - Taper weeks take 60% then 45% of the cap.
  - It's never more than 60% of the week's hours.
- Long events practise fuelling on the long ride: 60 to 90 g of carbohydrate an hour.

## After the plan

The athlete's edits come first: a longer long run or a moved session is their choice, even past these rules. Write what they confirm.
