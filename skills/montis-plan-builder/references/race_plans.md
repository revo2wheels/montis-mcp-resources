# Race plans: Run, Ride, Nordic ski, Triathlon and Rowing

A plan that ends on an **A race** in a supported event is a race plan. Montis sets every week, and the model writes the sessions to fit. These are the same rules as the Montis app's Plan Builder. The science and test results are in the Montis Help pages: [Plan Science: Run](https://www.montis.icu/help/science_plans_run), [Ride](https://www.montis.icu/help/science_plans_ride), [Nordic ski](https://www.montis.icu/help/science_plans_ski), [Triathlon](https://www.montis.icu/help/science_plans_tri) and [Rowing](https://www.montis.icu/help/science_plans_rowing).

Run `scripts/race_plan.mjs`, a bundle of the app's own race-plan code, for every number. Follow the rules below by hand only when you cannot run the script.

## When it applies

- **Run:** marathon, half marathon, 10K, 5K (parkrun), 50 km, 100 km.
- **Ride:** crit, road race, time trial (tt), cyclocross (cx), XC mountain bike (xc), gran fondo (fondo), gravel.
- **Nordic ski:** 10 km, 15 km, 30 km, 42 to 50 km (marathon), 90 km (long). Classic and skate share one plan.
- **Triathlon:** sprint, Olympic, 70.3 (half), Ironman. **Duathlon:** sprint (du_sprint), standard (du_standard).
- **Rowing:** 2 km, head race 5 to 7 km, half marathon, marathon.
- The plan's last day is the race, the athlete's **A race** for this plan. Only an A race gets a taper. A plan up to a B or C race uses the general plan (`references/periodization.md`), which runs to race day. Tell the athlete that race plans with a taper need an A race. Any other distance or event uses the general plan.
- Minimum weeks: Run 6 (marathon, half, 50 km, 100 km) or 4 (10K, 5K); Ride 4 (crit, road, tt, cx, xc), 6 (fondo), 8 (gravel); ski 4 (10 to 30 km), 6 (marathon), 8 (long); triathlon 6; rowing 6 (2 km, head), 8 (half, marathon).

## Steps

1. **Event.** Read the race from `get_calendar` and run `node scripts/race_plan.mjs detect '<raceJSON>'` with its `name`, `distance` or `distance_target` and `moving_time` (add `duathlon` for a duathlon). It gives the sport and the event for every sport. Confirm it with the athlete; a race whose name and length say nothing gives no event: ask which it is.
2. **The athlete's start, from the last 4 weeks of that sport only** (rowing: the last 6 months for the pace anchor). Call `get_activities` with `oldest` = today − 28 days (rowing: − 180), `newest` = today and `fields` = `id,type,start_date_local,moving_time,distance,icu_training_load`. Pass the reply to `run-baseline`, `ride-baseline`, `ski-baseline`, `row-baseline` (and `row-anchors` for the best 2k and 5k) or `tri-baseline`; for a triathlon, `tri-start <event> '<baseline>'` gives the start and the hours per sport.
   - Run with no runs: 150 TSS, 2.5 h, longest 8 km, 10 km/h, and say so. Other sports with no history: the start the athlete gives, and say so.
3. **Race pace (Run).** `run-pace <distance> <thresholdKmh>`, threshold speed = 3600 ÷ threshold pace in s/km. Shares of threshold speed: marathon by likely finish (79 to 93%), half 97%, 10K 103%, 5K 106% (an estimate), 50 km 85%, 100 km 80%.
4. **The weeks.** `run-weeks`, `ride-weeks`, `ski-weeks`, `row-weeks` or `tri-weeks` with the input and `baseWeeks` `[{ "index": 1, "startStr": "YYYY-MM-DD", "endStr": "YYYY-MM-DD" }, …]`. Week 1 starts on a Monday; the last week is race week.
   - Run: `{ distance, start_tss, start_hours, longest_km, speed_kmh, weeks, days, last_week_days, race_date, b_race_weeks, b_race_dates, pace_percent, race_tss, season }`.
   - Ride: `{ event, start_tss, start_hours, longest_hours, event_hours, weeks, days, last_week_days, race_date, b_race_weeks, b_race_dates, model, peaking, strength, race_tss, season }`.
   - Ski: `{ distance, start_tss, start_hours, longest_hours, event_hours, weeks, days, last_week_days, race_date, b_race_weeks, b_race_dates, model, strength, double_poling, race_tss, season }`.
   - Rowing: `{ race, start_tss, start_hours, start_sessions, start_km, longest_minutes, speed_kmh, anchor_2k, anchor_5k, low_base, weeks, days, last_week_days, race_date, b_race_weeks, b_race_dates, model, strength, race_tss, season }`.
   - Triathlon: `{ event, start_tss, start_hours, sport_hours: { swim, ride, run }, longest_ride_hours, longest_run_km, bike_split_hours, weeks, days, last_week_days, race_date, b_race_weeks, b_race_dates, model, strength, race_tss }`.
   - `last_week_days` is the race week's days up to race day. B races are other races inside the plan; `race_tss` is what a race counts (step 6).
   - Each week comes back with `week_kind`, `target_tss`, `target_hours`, `target_duration_minutes`, `training_frequency` and the sport's own fields: Run `long_run_km`, `long_run_minutes`, `race_pace_minutes`; Ride `long_ride_minutes`, `quality_sessions`, `tempo_minutes`, `hard_minutes`, `strength_sessions`; ski `long_session_minutes`, `quality_sessions`, `race_effort_minutes`, `strength_sessions`, `double_poling_sessions`; rowing `long_session_minutes`, `long_session_km`, `quality_sessions`, `race_pace_minutes`, `strength_sessions`, `test_session`; triathlon hours and sessions per sport, the long ride, run and swim, the brick, race-pace minutes, `strength_sessions`.
5. **The session rules.** `run-prompt '<runInput>' <PACE|HR|POWER>`, `ride-prompt`, `ski-prompt`, `row-prompt` or `tri-prompt` prints the rules for writing the sessions; they outrank the general load rules. Write the sessions to them, week by week. In a Ride plan the rules open with one block on days, rest, strength and race load: `training_frequency` is the rides to write (already one fewer in a week with a race), every other day is a rest note, the race is on top of the week's target, and a strength session goes with an easy ride at least three days before a race.
6. **Race season** (Ride, Run, ski, rowing). Three or more races inside a plan up to a date: each race is its week's hard session, one quality session midweek, openers the day before, the long session the day after a short race, the load held at the start (the last week at 80%), race day one of the training days. Set `"season": true`, list every other race in `b_race_weeks` and `b_race_dates`, and set `race_tss`: `race-load '<race>' '<context>'` gives the load a race counts when the calendar gives none (the race's heart rate from the race studies through the athlete's LTHR and max HR; runs by pace). A season week's `target_tss` and `training_frequency` are then the training alone.
7. **Reconcile.** `run-reconcile`, `ride-reconcile`, `ski-reconcile`, `row-reconcile` or `tri-reconcile` with the weeks and the targets, instead of `harmonize`. Minutes and load come from each session's steps; a session with no steps gets easy ones; a rest becomes a note and every empty day gets one; the long session keeps its set length; race day holds nothing; Ride: a lighter, taper or race week keeps the Race Week Sharpener, and a strength session the AI placed on the wrong day moves to an easy-ride day at least three days before the race.
8. **Check before you show it.** If more than a quarter of the sessions have no step lines, write those weeks again. Ride: if most build and peak weeks with 6 or more `hard_minutes` have no work above 105%, write those weeks again.
9. **Show it.** Add the week kind and the sport's own columns to the weekly table.

## Training models (Ride, ski, triathlon, duathlon, rowing; Run without a race)

`models` prints them. **Theme decides** (the default: the periodisation theme sets the sessions; on a race plan the event rules do), **Polarised** (two hard sessions a loading week, one VO2 and one threshold or race-shape, about 80% easy), **Pyramidal / sub-threshold** (about 70 to 75% easy, 20 to 25% at 76 to 95%, a heart-rate cap on the sub-threshold steps), **Rønnestad** (durability sessions, one 30/15 VO2 session a week, two heavy strength sessions, fuelling; on a race plan of 8 weeks or more it can use **compressed peaking**: 11 days of daily 30/15s then a step taper, `"peaking": "compressed"`). Run without a race: Theme decides, Polarised or **Norwegian singles** (three sub-threshold runs a week, everything else easy).

## Run rules

| Rule | Marathon | Half marathon | 10K | 5K | 50 km | 100 km |
|---|---|---|---|---|---|---|
| Weekly rise | 5% | 6% | 6% | 6% | 5% | 5% |
| Most the plan rises | ×2 under 45 km a week, ×1.75 to 60, ×1.6 to 80, ×1.5 to 100, ×1.3 above | ×2 under 40 km a week, ×1.4 above | ×1.4 | ×1.4 | As the marathon | As the marathon |
| Low base | Up to ×3 to reach 55 km a week | Up to ×2.2 to reach 36 km | Up to ×1.8 to reach 25 km | Up to ×1.8 to reach 25 km | Up to ×3 to reach 55 km | Up to ×3 to reach 55 km |
| Peak | 3 weeks before the race | 2 weeks before | 3 weeks before | 3 weeks before | 2 weeks before | 3 weeks before |
| Taper, share of the peak | 75 / 55 / 25% | 75 / 35% | 90 / 75 / 30% | 90 / 75 / 30% | 75 / 35% | 75 / 55 / 25% |
| Lighter week | Every 4th, at 80% | Every 4th, at 88% | Every 4th, at 88% | Every 4th, at 88% | Every 4th, at 80% | Every 4th, at 80% |
| Longest long run | 32 km or 3 hours | 21 km or 2 hours | 16 km or 100 minutes | 16 km or 100 minutes | 32 km or 3 hours | 40 km or 3 h 30 |
| Race pace | From 12 weeks out, 8 to 15% of the week | From 10 weeks out, 10 to 15% | From 6 weeks out, 6 to 10% | From 6 weeks out, 6 to 10% | None | None |
| Quality sessions a week | 1 | 1 | 2 | 2 | 2: steady state + VO2, then tempo | 2: steady state + VO2, then tempo |

The 50 km and 100 km plans are polarised to the halfway week and pyramidal after it, the long run is easy throughout, and every run over 2 hours carries a fuelling line. The 5K plan is the 10K rule with the race's own distance.

By hand: a plan of N weeks peaks in week P = N − (taper weeks). Start S TSS and H hours. Build week w: TSS = S × r^((w − 1)/(P − 1)), where r is the lower of the rise compounded over P − 1 weeks and the "most" for the start's km a week. Lighter weeks are every 4th, never the week before the peak. Taper weeks are the peak × the taper shares. Hours = H × (TSS/S)^0.9. The long run grows 10% a build week from the longest so far up to the cap, takes 75% in lighter weeks and the week before the peak, is never more than 55% of the week's km, and race week has none.

## Ride rules

| Rule | Crit | Road race | Time trial | Cyclocross | XC MTB | Gran fondo | Gravel |
|---|---|---|---|---|---|---|---|
| Weekly rise | 4% | 4% | 4% | 4% | 4% | 5% | 5% |
| Most the plan rises | ×1.4 | ×1.5 | ×1.4 | ×1.4 | ×1.4 | ×1.6 | ×1.7 |
| Peak | 2 weeks out | 2 weeks out | 2 weeks out | 2 weeks out | 2 weeks out | 2 weeks out | 3 weeks out |
| Taper, share of the peak | 70 / 45% | 70 / 45% | 70 / 45% | 70 / 45% | 70 / 45% | 70 / 40% | 75 / 55 / 35% |
| Longest ride | 2 h 30 | 4 h 30 | 3 h | 2 h 30 | 3 h | 80% of the event, up to 6 h | 60% of the event, up to 6 h |
| Hard sessions a loading week | 2 | 2 | 2 | 2 | 2 | 2 | 2 |
| Time at tempo to threshold (76 to 105%) | 8% | 8% | 17% | 8% | 8% | 13% | 12% |
| Minutes above threshold, per hour of the week | 3 | 3 | 1.5 | 3 | 3 | 3 | 3 |
| Event length when the race gives none | 1 h | 3 h | 1 h | 1 h | 1 h 30 | 5 h | 8 h |

What the hard sessions are:

| Event | Hard sessions |
|---|---|
| Crit | One VO2 session (30/15s, or 3 to 5 minutes at 110 to 120%) and one race session of repeated 15 to 60 second efforts at 130 to 200%, and sprints |
| Road race | One VO2 session and one threshold or race session with surges above 120% inside longer efforts |
| Time trial | One threshold session (2 to 4 × 10 to 20 minutes at 95 to 105%) and one VO2 session |
| Cyclocross | One VO2 session and one session of repeated 15 to 30 second efforts at 130 to 200%, with skills; in a loading week with no race, Cyclocross Repeatability from the library |
| XC MTB | One VO2 session (4 to 6 × 3 to 5 minutes at 110 to 120%, or 30/15s) and one race session of repeated 5 to 30 second efforts at 130 to 200% with a fast start and skills; in a loading week with no race, XC Surges or XCO Race Simulation from the library |
| Gran fondo and gravel | One VO2 session (4 to 6 × 3 to 5 minutes at 110 to 120%, or 30/15s) and one threshold session (2 to 3 × 10 to 20 minutes at 90 to 100%) |

**XC strength** (`"strength": true`, XC MTB only, not on the Rønnestad model): one heavy whole-body session (squat, deadlift, hip hinge, trunk; sets × reps at RPE, never a weight) in each loading week, two weeks in three in a race season, as the second session of an easy-ride day at least three days before a race.

By hand: lighter weeks are at 70%, counted back from the peak so the block before it is three loading weeks. Lighter, taper and race weeks keep one short hard session, the Race Week Sharpener (3 × 3 minutes at 105 to 110%). Openers the day before a race are the library's Race Openers (45 minutes). Hours = H × (TSS/S)^0.9. The long ride grows 12% a build week from the longest so far up to the cap, takes 70% in lighter weeks, 60% then 45% of the cap in the taper, and is never more than 60% of the week's hours. Long events practise fuelling on the long ride: 60 to 90 g of carbohydrate an hour.

## Nordic ski rules

| Rule | 10 km | 15 km | 30 km | 42 to 50 km | 90 km |
|---|---|---|---|---|---|
| Weekly rise | 4% | 4% | 5% | 5% | 5% |
| Most the plan rises | ×1.4 | ×1.4 | ×1.5 | ×1.6 | ×1.7 |
| Low base | Up to ×1.6 to reach 3 h a week | As 10 km | Up to ×1.8 to reach 3.5 h | Up to ×2 to reach 5 h | Up to ×2 to reach 5 h |
| Peak | 2 weeks out | 2 weeks out | 2 weeks out | 3 weeks out | 3 weeks out |
| Taper, share of the peak | 90 / 70% | 90 / 70% | 85 / 65% | 80 / 60 / 40% | 80 / 60 / 40% |
| Lighter week | Every 4th at 70% | same | same | same | same |
| Longest session | 1 h 30 | 2 h | 2 h 30 | 3 h | 60% of the expected finish, up to 4 h |
| Hard sessions a loading week | 2 | 2 | 2 | 2 | 2 |
| Race effort | None | None | None | From 8 weeks out, 15 to 30 min at race effort in the long session | From 8 weeks out, 30 to 60 min in double poling in the long session |
| Double-poling block | No | No | No | 2 sessions a week in the 6 weeks before the taper (on by default) | same |

Sessions are in heart-rate zones; one moderate session (4 to 6 × 8 to 15 min at 82 to 87% of max HR) and one high-intensity session (5 × 4 to 5 min at 87 to 95%) a loading week; easy under 82%; sprints once a week inside an easy session; roller ski, running with poles or easy cycling when there is no snow. **Ski strength** (`"strength": true`, on by default): 2 whole-body sessions a week in loading weeks, 1 in the taper, extra to the ski sessions. Openers the day before a race: Ski Openers from the library (40 min with 3 × 1 min at Z4 HR).

## Triathlon and duathlon rules

| Rule | Sprint | Olympic | 70.3 | Ironman | Duathlon sprint | Duathlon standard |
|---|---|---|---|---|---|---|
| Weekly rise | 4% | 4% | 5% | 5% | 4% | 4% |
| Most the plan rises | ×1.4 | ×1.4 | ×1.6 from 8 h a week, ×1.8 below | ×1.6 from 10 h, ×2 from 6 to 10 h, ×2.6 below | ×1.4 | ×1.4 |
| Peak | 2 weeks out | 2 weeks out | 3 weeks out | 3 weeks out | 2 weeks out | 2 weeks out |
| Taper, share of the peak | 75 / 45% | 75 / 45% | 70 / 40% | 75 / 55 / 30% | 75 / 45% | 75 / 45% |
| Lighter week | Every 4th at 80% | same | same | same | same | same |
| Hours per sport | Own split; 30 / 40 / 30 for a missing sport | Own split; 28 / 42 / 30 | Own split; 22 / 48 / 30 | Own split; 18 / 52 / 30 | Own split, runs and rides | same |
| Sessions a week | 2 / 2 / 2 and a brick | 3 / 3 / 3 | 3 / 3 / 3, 4 / 4 / 4 from 14 h | 3 / 3 / 3 | 3 rides, 3 runs, a brick | same |
| Longest ride | 1 h 30 | 2 h 30 | 4 h, or 80% of the expected bike split | 6 h, or 80% of the bike split | 1 h 30 | 2 h |
| Longest run | 60 min | 90 min / 16 km | 1 h 50 / 18 km | 3 h / 29 km | 45 to 60 min | 75 to 90 min / 14 km |
| Longest swim | 1,500 m | 2,500 m | 3,000 m | 4,000 m | — | — |
| Bricks | 1 a week from week 1 | 1 a week, 2 in the last 8 weeks | 1 a week, longest 2 h 15 | 1 a week, longest 3 h | 1 a week | 1 a week |

The taper takes the same share in every sport with the session count kept. Rides are written in power, runs in pace, swims in time with the metres in the title; a brick is a ride and a run on the same day with "Brick" in both titles. **Strength** (`"strength": true`, on by default): 2 sessions a week in loading weeks, 1 in the taper.

## Rowing rules

| Rule | 2 km | Head race 5 to 7 km | Half marathon | Marathon |
|---|---|---|---|---|
| Plan length | 8 to 12 weeks, at least 6 | 12 weeks, at least 6 | 10 weeks, at least 8 | 12 to 16 weeks, at least 8 |
| Weekly rise | 5% | 5% | 5% | 5% |
| Most the plan rises | ×1.3 | ×1.3 | ×1.5 | ×1.8 |
| Low base | Under 3 rows or 20 km a week: 4 easy base weeks first | same | same | same |
| Peak | 2 weeks out | 2 weeks out | 2 weeks out | 3 weeks out |
| Taper, share of the peak | 70 / 45% | 70 / 45% | 75 / 55% | 75 / 55 / 35% |
| Lighter week | Every 4th at 70% | same | same | same |
| Hard sessions a loading week | 2 under 8 h a week, 3 from 12 h | 2 | 1, then 2 once race-pace work starts | 1, then 2 |
| Their shape | VO2max (8 × 2.5 min at 95 to 100% of 2k power, or 4 to 6 × 4 min) and short reps at 2k pace (6 × 500 m, 4 × 1000 m, 8 × 500 m every 3:30) | Threshold 3 × 10 to 15 min at AT, and long intervals at 5k pace | AT session and, later, 2 × 20 min at half-marathon pace | AT session and, later, marathon-pace pieces |
| Race-pace work | From week 1, 12 to 16 min | From week 1, 16 to 32 min | From week 7 of 10, 40 to 50 min | From week 10 of 16, 50 to 75 min |
| Longest row | 60 min or 10 km | 60 min or 10 km | 16 km | 34 km, reached 4 weeks out |
| Intensity distribution | About 85 / 10 / 5 | About 80 / 15 / 5 | About 85 / 15 / 0 | About 85 / 15 / 0 |

Paces are seconds per 500 m from the best 2k or 5k on record (the anchor); with none, week 1 holds the test. **Rowing strength** (`"strength": true`, on by default): 2 sessions a week in loading weeks, 1 in the taper. Openers the day before a race: Row Openers from the library (30 min with 4 × 20 s at race pace).

## Race load when the calendar gives none

A race inside the plan that carries no planned load counts an estimate (`race-load`): its length at the race's share of max HR from the race studies, through the athlete's LTHR and max HR of that sport (no anchors: LTHR = 90% of max), load = hours × intensity² × 100; runs by pace, the race speed as a share of threshold speed. Shares of max HR: XC MTB 90, cyclocross 94, time trial 80, criterium 85, road race 78, gran fondo 77, gravel 79; ski 10 and 15 km 91, 30 km 90, 42 to 50 km 89, 90 km 82; rowing 2 km 94, head race 93, half marathon 85, marathon 80; triathlon swim / bike / run sprint 92 / 94 / 92, Olympic 90 / 91 / 91, 70.3 91 / 85 / 84, Ironman 92 / 78 / 77; duathlon sprint 94 / 94, standard 93 / 86. Show an estimate as such (≈), count it in the week, and pass it as `race_tss`.

## After the plan

The athlete's edits come first: a longer long run or a moved session is their choice, even past these rules. Write what they confirm.
