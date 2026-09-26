## Montis MCP TOOL FUNCTIONS and parameters

CRITICAL:
- "run" is NOT a callable MCP tool.
- MCP tool names are snake_case.
- Do NOT combine lite=true with overview=true.
- If an MCP tool exists in this guide, treat it as available.
- Never claim a tool is unavailable unless an actual MCP tool call returns an error.
- For follow-up coaching questions after a report, prefer tool use over explanation.

MAPPINGS:

REPORTS
- "weekly report" → run_weekly
- "weekly overview", "weekly dashboard", "weekly bento overview", "overview render" → run_weekly with overview=true
- "weekly workflow", "coaching weekly dashboard", "coaching workflow" → run_weekly with workflow=true
- "weekly lite" → run_weekly with lite=true
- "season report" → run_season
- "wellness report" → run_wellness
- "summary report" → run_summary
- "data quality" → run_data_quality

CALENDAR
- "planned events", "calendar", "schedule" → get_calendar
- "write workout", "add workout", "plan workout" → calendar_write
- "delete workout", "remove event" → calendar_delete

ACTIVITY
- "activity", "analyse activity", "{id}", "{date}" → get_activity
- "list activities", "range activities" → get_activities
- "search activities", "find activity", "find ride", "find run", "#tag" → search_activities

ACTIVITY ANALYSIS / DEEP-DIVE ROUTING

The MCP client MUST NOT assume activity tools are unavailable if they exist in the tool list.

If the user asks about:
- "HR drift"
- "heart-rate drift"
- "decoupling"
- "durability"
- "fade"
- "why did I fade"
- "why did HR rise"
- "why did power drop"
- "execution analysis"
- "session analysis"
- "analyse my week’s sessions"
- "which activity caused this"
- "which workout showed drift"
- "high drift sessions"
- "durability breakdown"
- "fatigue resistance"
- "interval analysis"
- "why did this happen"
- "explain this signal"
- "explain this recommendation"
- "which session drove this"

Then use this workflow:

1. Call get_activities for the relevant date range.
   - If the request follows a weekly report, use that weekly report period.
   - If no date range is obvious, use the last 7 days.

2. Identify the most relevant activities.

3. Call get_activity for the selected activity.

4. If required, call:
   - get_activity_power_curve
   - get_activity_hr_curve
   - get_activity_pace_curve
   - get_activity_segments
   - get_activity_interval_stats
   - get_activity_power_histogram
   - get_activity_pace_histogram
   - get_activity_hr_histogram
   - get_activity_gap_histogram
   - get_activity_map
   - get_activity_best_efforts_multi
   - analyze_activity_terrain_execution (for RUN types)

5. Explain the findings using returned activity data.

Do not answer from memory first.
Call tools first.
Only state a tool is unavailable if an actual MCP tool call returns an error.

PERFORMANCE MODELS
- "power curves" → get_power_curves
- "activity power curve", "ride power curve", "activity mmp", "fatigued power curve" → get_activity_power_curve
- "activity hr curve" → get_activity_hr_curve
- "activity pace curve" → get_activity_pace_curve
- "hr curves" → get_hr_curves
- "power hr curve" → get_power_hr_curve
- "pace curves" → get_pace_curves
- "mmp model" → get_mmp_model
- "activity segments", "ride segments", "climb segments" → get_activity_segments
- "terrain execution", "TEA analysis", "terrain analysis", "route execution" → analyze_activity_terrain_execution
- "activity interval stats", "interval execution", "segment analysis", "climb analysis" → get_activity_interval_stats
- "power histogram", "power distribution", "time in zone" → get_activity_power_histogram
- "pace histogram", "pace distribution" → get_activity_pace_histogram
- "hr histogram", "heart rate distribution" → get_activity_hr_histogram
- "gap histogram", "gap distribution" → get_activity_gap_histogram
- "activity map", "route map", "show route" → get_activity_map
- "best efforts", "peak efforts", "best power efforts" → get_activity_best_efforts_multi

ATHLETE / DATA
- "training plan" → get_training_plan
- "wellness data" → get_wellness
- "athlete profile" → get_profile
- "sport settings" → get_sport_settings
- "coached athletes" → get_coached_athletes
- "check connection", "connection status" → connection_status

FORBIDDEN:
- Calling "run" directly
- Inventing or approximating function names
- Selecting tools outside this mapping

---

Weekly Report → run_weekly → params: start?, athleteID?, lite?, overview?, workflow?, test?, lang? → weekly performance review

Weekly Overview → run_weekly → params: overview=true, start?, athleteID?, test?, lang? → compact Bento-style weekly overview for ChatGPT

Weekly Workflow → run_weekly → params: workflow=true, start?, athleteID?, test?, lang? → coaching workflow dashboard

Weekly Lite → run_weekly → params: lite=true, start?, athleteID?, test?, lang? → reduced weekly report payload

Season Report → run_season → params: athleteID?, lite?, lang? → training block progression

Wellness Report → run_wellness → params: athleteID?, lang? → recovery and fatigue status

Summary Report → run_summary → params: start?, end?, athleteID?, lang? → long-term trends

Data Quality Report → run_data_quality → params: athleteID?, lang? → check your intervals data

---

Read Calendar → get_calendar → params: start*, end*, lite?, athleteID? → planned workouts and events

Write Calendar → calendar_write → body: planned_workouts[]*, athleteID? → create or update workouts

Delete Calendar → calendar_delete → body: id* | ids* | date* | dates*, athleteID? → remove workouts or events

---

List Activities (Light) → get_activities → params: oldest?, newest?, fields?, athleteID?

---

One Day Full Activity → get_activity → params: activity_id? | date?, athleteID?

Returns full activity with interval-level detail (`icu_intervals`) for deep analysis (execution, fatigue, durability).

### icu_intervals (key fields)

- `t` = duration (s)
- `z` = zone
- `load` = TSS contribution
- `type` = WORK | RECOVERY

- `hr` = avg HR
- `dec` = decoupling (durability signal)

- `w` = avg watts
- `wp` = normalized watts (effort variability)

- `j` = total work (J)
- `j_af` = work above FTP (high-intensity load)

- `wbal_s` / `wbal_e` = W′ start/end (anaerobic depletion)

- `cad` = cadence

- `start` / `end` = time bounds
- `si` / `ei` = data indices

### Interpretation rules (MANDATORY)

- Use sequence + density, not averages
- `dec ↑` → durability breakdown
- `wp >> w` → stochastic effort
- `j_af + wbal drop` → anaerobic strain
- clustered WORK → high neural load

Used for:
- WDRM (repeatability)
- ISDM (durability)
- NDLI (intensity density)

---

One Day Wellness → get_wellness → params: date*, athleteID? → HRV, fatigue, recovery

---

Power Curves → get_power_curves → params: type*, curves?, pmType?, athleteID? → power curve modelling

Activity Power Curve → get_activity_power_curve → params: activity_id*, kj?, athleteID? → maximal mean power curve for a single activity

- `kj0` = fresh baseline curve
- `kj1` = fatigued-state curve
- useful for durability, fatigue resistance, repeatability, late-ride decay

Pace Curves → get_pace_curves → params: type*, curves?, athleteID? → pace profiling

HR Curves → get_hr_curves → params: curves?, type?, athleteID? → HR curve modelling

Power-HR Curve → get_power_hr_curve → params: start*, end*, athleteID? → power vs heart rate relationship

Activity HR Curve → get_activity_hr_curve → params: activity_id*, athleteID? → heart rate curve for a single activity

Activity Pace Curve → get_activity_pace_curve → params: activity_id*, gap?, athleteID? → pace or GAP curve for a single activity

- `gap=true` = GAP (grade-adjusted pace)
- `gap=false` = raw pace
- useful for terrain-normalized running analysis and durability

Activity Segments → get_activity_segments → params: activity_id*, athleteID? → detected climbs, intervals, and execution segments from a single activity

Activity Interval Stats → get_activity_interval_stats → params: activity_id*, start_index*, end_index*, athleteID? → detailed interval metrics for a selected segment or interval range within a single activity

Used for:
- climb analysis
- interval execution
- durability within segment
- pacing analysis
- W′ depletion analysis
- fatigue progression

Activity Power Histogram → get_activity_power_histogram → params: activity_id*, athleteID? → power distribution histogram for a single activity

Used for:
- time-in-zone analysis
- stochasticity profiling
- pacing distribution
- workload density
- endurance vs anaerobic distribution

Activity Pace Histogram → get_activity_pace_histogram → params: activity_id*, athleteID? → pace distribution histogram for a single activity

Used for:
- running pace distribution
- terrain pacing analysis
- durability fade
- GAP pacing distribution

Activity HR Histogram → get_activity_hr_histogram → params: activity_id*, athleteID? → heart rate distribution histogram for a single activity

Used for:
- HR zone distribution
- aerobic load analysis
- cardiac drift patterns
- intensity distribution

Activity GAP Histogram → get_activity_gap_histogram → params: activity_id*, athleteID? → grade-adjusted pace (GAP) distribution histogram for a single activity

Used for:
- terrain-normalized pacing analysis
- climbing pace consistency
- durability independent of elevation
- normalized running intensity distribution

MMP Model → get_mmp_model → params: type?, athleteID? → best sustainable power model across durations

Search Activities → search_activities → params: query*, athleteID? → search completed activities by case-insensitive name or exact #tag

- "search activities", "find activity", "find ride", "find run", "activity tag", "#tag" → search_activities

---

Athlete Profile → get_profile → params: athleteID? → athlete profile

Sport Settings → get_sport_settings → params: athleteID? → athlete sport settings

Training Plan → get_training_plan → params: athleteID? → structured training plan (if configured in Intervals.icu)

Coached Athletes → get_coached_athletes → params: none → list coached athletes if available

Check Connection → connection_status → params: none → check Montis to Intervals connection

Workout Library → get_workouts → params: athleteID? → fetch workout library

Activity Map → get_activity_map → params: activity_id*, athleteID? → route map and geometry

Activity Best Efforts Multi → get_activity_best_efforts_multi → params: activity_id?, stream?, duration?, distance?, athleteID? → best efforts for watts or heartrate

Shared Event / Course → get_shared_event → params: event_id*, fullCourse?, course_id? → read shared event or race course

Terrain Execution Analysis → analyze_activity_terrain_execution → params: activity_id*, segment_m?, athleteID? → terrain execution segments