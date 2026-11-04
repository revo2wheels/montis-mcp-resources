// Montis race plans for the plan-builder skill: the app's own src/lib/runRacePlan.ts and src/lib/rideRacePlan.ts (AI Builder v2), bundled. Dependency-free; Node 18+. Run with no arguments for usage.

// src/lib/workoutSteps.ts
var PLAN_ZONE_TOPS = [55, 75, 90, 105, 120, 150];
var SCALABLE_TOP_PCT = 75;
var DURATION = /(?:^|\s)(\d+h(?:\d+m)?(?:\d+s)?|\d+m(?:\d+s)?|\d+s)(?=\s|$)/i;
var REPEAT_HEADER = /(?:^|\s)(\d+)x\s*\{?$/i;
var PCT_TARGET = /(?:ramp\s+)?(\d+(?:\.\d+)?)%?(?:\s*-\s*(\d+(?:\.\d+)?))?\s*%/i;
var ANY_ZONE = /\bZ([1-7])(?:\s*-\s*Z?([1-7]))?\b/i;
var NO_STEP_TYPES = /weight|strength|yoga|core|stretch|mobility|pilates/i;
var DISTANCE_STEP = /^\s*-.*\b\d+(?:\.\d+)?(?:mtr|km|mi|yd?)\b/i;
var hasDistanceStep = (text) => String(text || "").split("\n").some((line) => DISTANCE_STEP.test(line) && !DURATION.test(line));
function durationSeconds(token) {
  const h = /(\d+)h/i.exec(token);
  const m = /(\d+)m/i.exec(token);
  const s = /(\d+)s/i.exec(token);
  return (h ? Number(h[1]) * 3600 : 0) + (m ? Number(m[1]) * 60 : 0) + (s ? Number(s[1]) : 0);
}
function zoneMidPct(zone) {
  const tops = PLAN_ZONE_TOPS;
  if (zone <= 1) return tops[0] * 0.9;
  if (zone > tops.length) return tops[tops.length - 1] * 1.05;
  return (tops[zone - 2] + tops[zone - 1]) / 2;
}
function parseSteps(description) {
  const steps = [];
  let repeats = 1;
  let block = 0;
  String(description || "").split("\n").forEach((raw, line) => {
    const text = raw.trim();
    if (!text) {
      repeats = 1;
      return;
    }
    const duration = DURATION.exec(text);
    const header = REPEAT_HEADER.exec(text);
    if (header && !duration && !text.includes("%")) {
      repeats = Math.max(1, Number(header[1]));
      block++;
      return;
    }
    if (!duration) return;
    if (repeats > 1 && /^[-\s]*(cool\s*down|warm\s*up)/i.test(text)) repeats = 1;
    let pct = null;
    const p = PCT_TARGET.exec(text);
    if (p) pct = p[2] ? (Number(p[1]) + Number(p[2])) / 2 : Number(p[1]);
    else {
      const z = ANY_ZONE.exec(text);
      if (z) pct = z[2] ? (zoneMidPct(Number(z[1])) + zoneMidPct(Number(z[2]))) / 2 : zoneMidPct(Number(z[1]));
    }
    steps.push({ line, seconds: durationSeconds(duration[1]), repeats, inRepeat: repeats > 1, pct, ramp: /\bramp\b/i.test(text), block });
  });
  return steps;
}
function stepTotals(description) {
  const steps = parseSteps(description);
  if (!steps.length || hasDistanceStep(description)) return null;
  const minutes = Math.round(steps.reduce((s, x) => s + x.seconds * x.repeats, 0) / 60);
  const tss = Math.round(steps.filter((x) => x.pct !== null).reduce((s, x) => {
    const f = x.pct / 100;
    return s + x.seconds * x.repeats / 3600 * f * f * 100;
  }, 0));
  return { minutes, tss };
}
function itemTotals(item) {
  if (String(item?.category || "").toUpperCase() === "NOTE" || NO_STEP_TYPES.test(String(item?.type || ""))) return null;
  return stepTotals(item?.description || "");
}
var isEasy = (s) => !s.inRepeat && s.pct !== null && s.pct <= SCALABLE_TOP_PCT && !s.ramp;
function easyEdgeSteps(steps) {
  const first = steps.findIndex((s) => !isEasy(s));
  if (first === -1) return steps;
  let last = steps.length - 1;
  while (isEasy(steps[last])) last--;
  return steps.filter((s, i) => isEasy(s) && (i < first || i > last));
}
function changeLength(line, change) {
  const d = DURATION.exec(line);
  if (!d) return line;
  const at = d.index + d[0].indexOf(d[1]);
  return line.slice(0, at) + change(d[1]) + line.slice(at + d[1].length);
}
function lengthLike(token, seconds) {
  const inHours = /h/i.test(token);
  const h = inHours ? Math.floor(seconds / 3600) : 0;
  const m = Math.floor((seconds - h * 3600) / 60);
  const s = seconds % 60;
  return `${h ? `${h}h` : ""}${m ? `${m}m` : ""}${s ? `${s}s` : ""}`;
}
var MIN_EASY_SECONDS = 300;
function stretchSteps(steps, lines) {
  const edge = easyEdgeSteps(steps);
  if (edge.length) return [...edge];
  return steps.filter((s) => isEasy(s) && s.pct > PLAN_ZONE_TOPS[0] && !/\b(rest|recover)/i.test(lines[s.line]));
}
var wholeMinutes = (seconds) => Math.ceil(seconds / 60 - 0.5) * 60;
function fitToMinutes(text, minutes) {
  const steps = parseSteps(text);
  if (!steps.length || !(minutes > 0)) return null;
  let change = Math.round(minutes) * 60 - steps.reduce((sum, s) => sum + s.seconds * s.repeats, 0);
  if (Math.abs(change) < 30) return text;
  const lines = String(text || "").split("\n");
  const longestFirst = stretchSteps(steps, lines).sort((a, b) => b.seconds - a.seconds || b.line - a.line);
  if (!longestFirst.length) return null;
  const lengthen = (step, seconds) => {
    lines[step.line] = changeLength(lines[step.line], (token) => lengthLike(token, wholeMinutes(seconds)));
  };
  if (change > 0) {
    lengthen(longestFirst[0], longestFirst[0].seconds + change);
    return lines.join("\n");
  }
  for (const step of longestFirst) {
    const taken = Math.min(-change, step.seconds - MIN_EASY_SECONDS);
    if (taken <= 0) continue;
    lengthen(step, step.seconds - taken);
    change += taken;
  }
  return change <= -30 ? null : lines.join("\n");
}

// src/knowledge/workoutSanitizer.ts
var LENGTH = "\\d+h(?:\\d+m)?(?:\\d+s)?|\\d+m(?:\\d+s)?|\\d+(?:\\.\\d+)?s|\\d+(?:\\.\\d+)?(?:km|mi|mtr|y)";
var STEP_LENGTH = new RegExp("(?:^|\\s)(?:" + LENGTH + ")(?=\\s|$)", "i");
var STEP_LENGTHS = new RegExp("(^|\\s)(" + LENGTH + ")(?=\\s|$)", "gi");
function sanitizeWorkoutDescription(raw, sportType) {
  if (!raw || typeof raw !== "string") return "";
  let cleaned = raw.replace(/\\r\\n|\\n|\\r/g, "\n").replace(/^```[a-zA-Z0-9_-]*\n?/gm, "").replace(/\n?```$/gm, "").replace(/\r\n/g, "\n");
  cleaned = cleaned.replace(/\s*\(\s*~?\s*\d+(?:\.\d+)?\s*(?:w|watts|bpm|lthr|%|rpm|w\/kg)?\s*\)/gi, "").replace(/\s*\(\s*(?:zone|z)\s*\d+\s*\)/gi, "");
  const st = (sportType || "").toLowerCase();
  const isNonCardio = st.includes("weighttraining") || st.includes("strength") || st.includes("yoga") || st.includes("core") || st.includes("stretch") || st.includes("mobility") || st.includes("pilates");
  if (isNonCardio) {
    const lines2 = cleaned.split("\n");
    const resultLines2 = [];
    for (let l of lines2) {
      const trimmed = l.trimEnd().replace(/(^|\s)(\d+(?:\.\d+)?\s?(?:h|m|s|min|mins|sec|secs))(?=$|[\s,;])/gi, "$1($2)");
      if (!trimmed.trim()) {
        if (resultLines2.length > 0 && resultLines2[resultLines2.length - 1] !== "") {
          resultLines2.push("");
        }
        continue;
      }
      resultLines2.push(trimmed);
    }
    while (resultLines2.length > 0 && resultLines2[resultLines2.length - 1] === "") {
      resultLines2.pop();
    }
    return resultLines2.join("\n");
  }
  const isCycling = !sportType || st.includes("ride") || st.includes("bike") || st.includes("cycling");
  if (isCycling) {
    cleaned = cleaned.replace(/(\d+)%\s*FTP\b/gi, "$1%");
  }
  cleaned = cleaned.replace(/(^|[\s-])(\d+)\.(\d+)(h|m|s)(?![a-z])/gim, (match, lead, whole, frac, unit) => {
    const value = Number(`${whole}.${frac}`);
    const u = unit.toLowerCase();
    const small = Math.round(value * (u === "s" ? 1 : 60));
    const big = u === "s" ? 0 : Math.floor(small / 60);
    const rest = u === "s" ? small : small % 60;
    const length = `${big ? `${big}${u}` : ""}${rest ? `${rest}${u === "h" ? "m" : "s"}` : ""}`;
    return length ? `${lead}${length}` : match;
  });
  cleaned = cleaned.replace(/(\d+(?:-\d+)?%)\s+\d+\s*(?:w|watts)\b/gi, "$1");
  const lines = cleaned.split("\n");
  const resultLines = [];
  let inRepeatBlock = false;
  for (let idx = 0; idx < lines.length; idx++) {
    let line = lines[idx].trim();
    if (!line) {
      if (resultLines.length > 0 && resultLines[resultLines.length - 1] !== "") {
        resultLines.push("");
      }
      inRepeatBlock = false;
      continue;
    }
    const headerWithoutDash = line.replace(/^[-\s]+/, "").trim();
    const isLabelledRepeatHeader = /^\S.*\s\d+x\s*\{?$/i.test(headerWithoutDash) && !STEP_LENGTH.test(headerWithoutDash.replace(/\s\d+x\s*\{?$/i, "")) && !/%/.test(headerWithoutDash);
    const isRepeatHeaderOnly = /^(?:Main Set\s+)?\d+x\s*\{?$/i.test(headerWithoutDash) || /^Set\s+\w+\s+\d+x\s*\{?$/i.test(headerWithoutDash) || isLabelledRepeatHeader;
    if (isRepeatHeaderOnly) {
      if (resultLines.length > 0 && resultLines[resultLines.length - 1] !== "") {
        resultLines.push("");
      }
      let headerText = headerWithoutDash;
      if (!isLabelledRepeatHeader && !headerText.startsWith("Main Set") && !/^\d+x\s*\{?$/i.test(headerText) && !/^Set\s+/i.test(headerText)) {
        headerText = `Main Set ${headerText}`;
      }
      resultLines.push(headerText);
      inRepeatBlock = true;
      continue;
    }
    const inlineRepeatMatch = line.match(/^(?:-\s*)?((?:Main Set\s+)?\d+x)\s+(?:-\s*)?(.*)/i);
    if (inlineRepeatMatch) {
      let headerText = inlineRepeatMatch[1].trim();
      if (!headerText.startsWith("Main Set") && !/^\d+x$/i.test(headerText) && !/^Set\s+/i.test(headerText)) {
        headerText = `Main Set ${headerText}`;
      }
      let stepText = inlineRepeatMatch[2].trim();
      if (resultLines.length > 0 && resultLines[resultLines.length - 1] !== "") {
        resultLines.push("");
      }
      resultLines.push(headerText);
      inRepeatBlock = true;
      if (stepText) {
        if (!stepText.startsWith("-")) {
          stepText = `- ${stepText}`;
        }
        if (isCycling) {
          stepText = stepText.replace(/(\d+)%\s*FTP\b/gi, "$1%");
        }
        resultLines.push(stepText);
      }
      continue;
    }
    const lowerLine = line.toLowerCase();
    if (inRepeatBlock && (lowerLine.startsWith("cooldown") || lowerLine.startsWith("- cooldown") || lowerLine.startsWith("warmup") || lowerLine.startsWith("- warmup"))) {
      if (resultLines.length > 0 && resultLines[resultLines.length - 1] !== "") {
        resultLines.push("");
      }
      inRepeatBlock = false;
    }
    if (!line.startsWith("-") && !STEP_LENGTH.test(line)) {
      resultLines.push(line);
      continue;
    }
    let content = line.replace(/^-\s*/, "").trim();
    if (isCycling) {
      content = content.replace(/(\d+)%\s*FTP\b/gi, "$1%");
    }
    resultLines.push(`- ${content}`);
  }
  const finalLines = [];
  for (const l of resultLines) {
    if (l === "" && (finalLines.length === 0 || finalLines[finalLines.length - 1] === "")) {
      continue;
    }
    finalLines.push(l);
  }
  while (finalLines.length > 0 && finalLines[finalLines.length - 1] === "") {
    finalLines.pop();
  }
  return finalLines.join("\n");
}

// src/lib/runRacePlan.ts
var RUN_RACE_RULES = {
  // A 5% weekly rise predicts published plans' peaks. Its most is what the 5,928 real runners reached from each start:
  // the higher the start, the smaller the rise
  marathon: { label: "marathon", raceType: "run_marathon", km: 42.195, growth: 1.05, ratioByStartKm: [[45, 2], [60, 1.75], [80, 1.6], [100, 1.5], [Infinity, 1.3]], growthLowBase: 1.07, maxRatioLowBase: 3, floorKm: 55, lighter: 0.8, taper: [0.75, 0.55, 0.25], longMaxKm: 32, longMaxMinutes: 180, longTaper: [0.7, 0.4], paceFromWeeksOut: 12, paceShare: [0.08, 0.15], quality: 1, minWeeks: 6 },
  // The half marathon benchmark, 14 plans: 6% a week, to 2 × at most and about 1.4 × from 40 km a week, a peak 2 weeks
  // out, a long run to 21 km or 2 hours (Fokkema 2020), and half-marathon pace from 10 weeks out
  half: { label: "half marathon", raceType: "run_half", km: 21.1, growth: 1.06, ratioByStartKm: [[40, 2], [Infinity, 1.4]], growthLowBase: 1.08, maxRatioLowBase: 2.2, floorKm: 36, lighter: 0.88, taper: [0.75, 0.35], longMaxKm: 21, longMaxMinutes: 120, longTaper: [0.6], paceFromWeeksOut: 10, paceShare: [0.1, 0.15], quality: 1, minWeeks: 6 },
  // Runner's World's 6-week plans peak 3 weeks out, keep two speed sessions and taper to about 95 / 80 / 30%
  "10k": { label: "10K", raceType: "run_10k", km: 10, growth: 1.06, ratioByStartKm: [[Infinity, 1.4]], growthLowBase: 1.08, maxRatioLowBase: 1.8, floorKm: 25, lighter: 0.88, taper: [0.9, 0.75, 0.3], longMaxKm: 16, longMaxMinutes: 100, longTaper: [0.75, 0.5], paceFromWeeksOut: 6, paceShare: [0.06, 0.1], quality: 2, minWeeks: 4 }
};
var RUN_RACE = {
  lighterEvery: 4,
  // Real runners' hours rise a little slower than their load
  hoursPower: 0.9,
  longUp: 1.1,
  longLighter: 0.75,
  longMaxShare: 0.55,
  bRace: { before: 0.9, week: 0.75, after: 0.7 },
  lookbackDays: 28,
  // A start for someone with no Run activities, about 24 km a week as first-time plans use. Shown as such, and editable
  noHistory: { tss: 150, hours: 2.5, longestKm: 8, speedKmh: 10 }
};
var EASY_TOP_PCT = 80;
var MIN_RUN_MINUTES = 20;
var round1 = (n) => Math.round(n * 10) / 10;
var toFive = (n) => Math.round(n / 5) * 5;
var rulesOf = (distance) => RUN_RACE_RULES[distance] || RUN_RACE_RULES.marathon;
function raceDistanceOf(race) {
  const metres = Number(race?.distance || race?.distance_target || 0);
  if (metres > 0) {
    const km = metres / 1e3;
    if (km >= 41 && km <= 44) return "marathon";
    if (km >= 20 && km <= 22) return "half";
    if (km >= 9.5 && km <= 10.5) return "10k";
    return "other";
  }
  const name = String(race?.name || race?.title || "");
  if (/\b(half|semi|demi|halb|mezza|media|medio)\b|halbmarathon|halve/i.test(name)) return "half";
  if (/marat[oó]n|marathon/i.test(name)) return "marathon";
  if (/\b10\s?(k|km)\b/i.test(name)) return "10k";
  return null;
}
function activitiesOf(raw) {
  const parse = (value2) => {
    if (typeof value2 !== "string") return value2;
    try {
      return JSON.parse(value2);
    } catch {
      return null;
    }
  };
  let value = parse(raw);
  if (Array.isArray(value?.content) && value.content[0]?.text) value = parse(value.content[0].text);
  if (value?.result) value = parse(value.result);
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.activities) ? value.activities : Array.isArray(value?.data) ? value.data : [];
}
function runBaselineFromActivities(activities, today = /* @__PURE__ */ new Date()) {
  const from = today.getTime() - RUN_RACE.lookbackDays * 864e5;
  const seen = /* @__PURE__ */ new Set();
  const runs = (Array.isArray(activities) ? activities : []).filter((a) => {
    const when = new Date(String(a?.start_date_local || "")).getTime();
    if (!/run/i.test(String(a?.type || "")) || !(Number(a?.moving_time) > 0) || !(when >= from && when <= today.getTime())) return false;
    const key = `${a.start_date_local}|${Math.round(Number(a.distance) || 0)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!runs.length) return null;
  const weeks = RUN_RACE.lookbackDays / 7;
  const seconds = runs.reduce((s, a) => s + Number(a.moving_time), 0);
  const metres = runs.reduce((s, a) => s + (Number(a.distance) || 0), 0);
  const load = runs.reduce((s, a) => s + (Number(a.icu_training_load) || 0), 0);
  if (!(metres > 0) || !(load > 0)) return null;
  return {
    tss: Math.round(load / weeks),
    hours: round1(seconds / 3600 / weeks),
    km: Math.round(metres / 1e3 / weeks),
    longestKm: Math.round(Math.max(...runs.map((a) => Number(a.distance) || 0)) / 1e3),
    speedKmh: round1(metres / 1e3 / (seconds / 3600)),
    runs: runs.length
  };
}
function racePacePercent(distance, thresholdKmh) {
  if (distance === "half") return 97;
  if (distance === "10k") return 103;
  const cs = Number(thresholdKmh);
  if (!(cs > 0)) return 88;
  const share = (minutes) => {
    if (minutes <= 150) return 93;
    if (minutes >= 360) return 78.9;
    return minutes <= 230 ? 93 + (84.8 - 93) * (minutes - 150) / 80 : 84.8 + (78.9 - 84.8) * (minutes - 230) / 130;
  };
  let pct = 85;
  for (let i = 0; i < 5; i++) pct = share(42.195 / (cs * pct / 100) * 60);
  return Math.round(pct);
}
function runRaceWeekTargets(input, baseWeeks) {
  const G = RUN_RACE;
  const R = rulesOf(input.distance);
  const N = Math.max(R.minWeeks, Math.round(Number(input.weeks) || 0));
  const S = Math.max(50, Number(input.start_tss) || 0);
  const H = Math.max(1, Number(input.start_hours) || 0);
  const v = Math.max(5, Number(input.speed_kmh) || G.noHistory.speedKmh);
  const days = Math.max(2, Math.min(7, Number(input.days) || 4));
  const lastDays = Math.round(Number(input.last_week_days) || 7);
  const peakWeek = N - R.taper.length;
  const startKm = H * v;
  const most = R.ratioByStartKm.find(([belowKm]) => startKm < belowKm)[1];
  const normal = Math.min(most, Math.pow(R.growth, peakWeek - 1));
  const needed = R.floorKm / startKm;
  const ratio = needed > normal ? Math.max(normal, Math.min(needed, R.maxRatioLowBase, Math.pow(R.growthLowBase, peakWeek - 1))) : normal;
  const peak = S * ratio;
  const bWeeks = (input.b_race_weeks || []).filter((w) => w >= 1 && w <= peakWeek);
  const longTop = Math.min(R.longMaxKm, R.longMaxMinutes / 60 * v);
  let longBest = Math.max(1, Number(input.longest_km) || G.noHistory.longestKm);
  const out = [];
  for (let w = 1; w <= N; w++) {
    const weeksOut = N - w;
    let kind = "build";
    let tss;
    if (w > peakWeek) {
      tss = peak * R.taper[w - peakWeek - 1];
      kind = w === N ? "race_week" : "taper";
    } else {
      tss = S * Math.pow(ratio, (w - 1) / Math.max(1, peakWeek - 1));
      if (w === peakWeek) kind = "peak";
      else if (bWeeks.includes(w)) {
        tss *= G.bRace.week;
        kind = "b_race";
      } else if (bWeeks.includes(w - 1)) {
        tss *= G.bRace.after;
        kind = "b_recovery";
      } else if (bWeeks.includes(w + 1)) tss *= G.bRace.before;
      else if (w % G.lighterEvery === 0 && w !== peakWeek - 1) {
        tss *= R.lighter;
        kind = "lighter";
      }
    }
    const hours = H * Math.pow(tss / S, G.hoursPower);
    let longKm;
    if (w > peakWeek) longKm = w === N ? 0 : longTop * R.longTaper[w - peakWeek - 1];
    else if (kind === "b_race") longKm = 0;
    else if (kind === "b_recovery") longKm = longBest * 0.5;
    else if (kind === "lighter" || w === peakWeek - 1) longKm = longBest * G.longLighter;
    else {
      longKm = Math.min(longTop, longBest * G.longUp);
      longBest = Math.max(longBest, longKm);
    }
    longKm = Math.min(longKm, hours * v * G.longMaxShare);
    const paceOn = weeksOut <= R.paceFromWeeksOut && weeksOut >= 2 && (kind === "build" || kind === "peak" || weeksOut === 2);
    const paceShare = paceOn ? R.paceShare[0] + (R.paceShare[1] - R.paceShare[0]) * (R.paceFromWeeksOut - weeksOut) / Math.max(1, R.paceFromWeeksOut - 3) : 0;
    const base = baseWeeks?.find((b) => b.index === w) || baseWeeks?.[w - 1] || {};
    const share = w === N && lastDays >= 1 && lastDays < 7 ? lastDays / 7 : 1;
    const weekHours = round1(hours * share);
    out.push({
      index: w,
      startStr: base.startStr,
      endStr: base.endStr,
      startLabel: base.startLabel,
      endLabel: base.endLabel,
      phase: kind === "build" || kind === "peak" ? "load" : "recovery",
      target_tss: Math.round(tss * share),
      target_hours: weekHours,
      target_duration_minutes: Math.round(weekHours * 60),
      training_frequency: w === N ? Math.max(1, Math.min(days, 4, lastDays)) : days,
      ceiling: true,
      week_kind: kind,
      long_run_km: Math.round(longKm),
      long_run_minutes: toFive(longKm / v * 60),
      race_pace_minutes: toFive(hours * 60 * Math.min(1, paceShare))
    });
  }
  return out;
}
function runMetricOf(run) {
  const m = String(run?.target_metric || "").toUpperCase();
  if (m === "PACE" || m === "HR" || m === "POWER") return m;
  if (run?.threshold_pace) return "PACE";
  return "HR";
}
var zoneWord = (metric) => metric === "PACE" ? " Pace" : metric === "HR" ? " HR" : "";
var pctWord = (metric) => metric === "PACE" ? "% Pace" : metric === "HR" ? "% LTHR" : "%";
function easySteps(minutes, metric) {
  const word = zoneWord(metric);
  const edges = minutes >= 35 ? [10, 5] : [5, 5];
  const main2 = Math.max(5, Math.round(minutes) - edges[0] - edges[1]);
  return `- Warmup ${edges[0]}m Z1${word}
- ${main2}m Z2${word}
- Cooldown ${edges[1]}m Z1${word}`;
}
function runStepSyntax(metric, input) {
  const z = zoneWord(metric), p = pctWord(metric);
  const label = rulesOf(input.distance).label;
  const pace = metric === "HR" ? { marathon: 93, half: 98, "10k": 102 }[input.distance] ?? 93 : Number(input.pace_percent) || racePacePercent(input.distance);
  const jog = metric === "HR" ? "Z1 HR" : `65${p}`;
  return `INTERVALS.ICU WORKOUT STEP SYNTAX (MANDATORY):
1. EVERY STEP MUST START WITH "- " AND HOLD A TIME AND A TARGET:
   Times are written like 40m, 1h30m or 90s, never in words such as "40 minutes". A session with no such step lines is wrong.
2. STRICTLY NO CALCULATED VALUES IN PARENTHESES, such as "(160bpm)" or "(4:30/km)".
3. REPEAT BLOCKS USE A HEADER LINE WITHOUT A HYPHEN, WITH ONE BLANK LINE BEFORE AND AFTER. Repeats cannot be nested.
4. TARGETS: warm-up, cool-down and recovery running are Z1${z}. Easy running is Z2${z}. Threshold is 100${p}. ${label} race pace is ${pace}${p}.
   Recovery between reps is an easy jog, ${jog}, never 50%.

Example, easy run:
- Warmup 10m Z1${z}
- 40m Z2${z}
- Cooldown 5m Z1${z}

Example, threshold:
- Warmup 15m Z1${z}

3x
- 10m 100${p}
- 2m ${jog}

- Cooldown 10m Z1${z}

Example, race pace:
- Warmup 15m Z1${z}
- 30m ${pace}${p}
- Cooldown 10m Z1${z}`;
}
function runRacePromptRules(input) {
  const R = rulesOf(input.distance);
  const dates = (input.b_race_dates || []).join(", ");
  return `
RUN ${R.label.toUpperCase()} PLAN (these rules outrank the load rules above where they differ):
Every week in 'WEEKS TO GENERATE' carries week_kind, long_run_minutes and race_pace_minutes. The code has set these from the athlete's own Run history. Follow them.
1. LONG RUN: when long_run_minutes is above 0, write one long run of exactly that length on the weekend, easy throughout unless rule 3 puts race pace in it. Never make it longer, and never move the week's spare minutes into it.
2. OTHER RUNS: spread the week's other minutes evenly over the other sessions. Every session is a Run. Keep to training_frequency sessions.
3. RACE PACE: when race_pace_minutes is above 0, one session holds that many minutes at race pace, as one block or as reps, in a mid-week run${R.quality === 1 ? " or inside the long run" : ""}. Otherwise write no race pace.
4. QUALITY: in a week of kind build or peak, ${R.quality === 1 ? "one quality session" : "up to two quality sessions, with at least 5 training days"}: threshold or speed before race pace begins, and race pace once it does. In a lighter week, b_race or b_recovery week: easy running with strides only. In a taper week keep one short quality session and the same number of runs.
5. HARD DAYS: always one easy run or rest day between quality sessions and the long run. At least 75% of the week is easy.
6. PROGRESS: never copy a week. Each loading week must differ from the same week of the block before it, in reps, rep length or race-pace time.
7. RACE WEEK: the race itself is on the calendar and is never written as a workout.${dates ? `
8. B RACES: ${dates} ${input.b_race_dates && input.b_race_dates.length > 1 ? "are races" : "is a race"} on the calendar. Never write a race as a workout, and write nothing hard in the 3 days before one or the 2 days after it.` : ""}
`;
}
function reconcileRunRaceWeeks(weeks, targets, metric, bRaceDates = [], raceDate = "") {
  const out = {};
  const isNote = (w) => String(w?.category || "").toUpperCase() === "NOTE";
  for (const key of Object.keys(weeks || {})) {
    const target = targets.find((t) => t.index === Number(key));
    const list = (Array.isArray(weeks[key]) ? weeks[key] : []).filter((w) => {
      const date = String(w?.date || "").slice(0, 10);
      if (isNote(w)) return true;
      if (raceDate && date === raceDate) return false;
      if (/opener|activation|shake/i.test(String(w?.title || ""))) return true;
      return !(bRaceDates.includes(date) && /\brace\b|marathon/i.test(`${w?.title || ""} ${w?.description || ""}`));
    }).map((w) => {
      if (isNote(w)) return w;
      if (!/run/i.test(String(w?.type || "Run"))) return parseSteps(String(w?.description || "")).length ? w : { ...w, category: "NOTE", duration_minutes: 0, tss: 0 };
      const stated = Number(w.duration_minutes) || 0;
      const text = String(w.description || "").split("\n").filter((line) => !/^\s*-.*\b(0[ms]|\d+ms)\b/.test(line)).join("\n");
      const description = parseSteps(sanitizeWorkoutDescription(text, w.type)).length ? text : easySteps(stated, metric);
      const minutes2 = itemTotals({ ...w, description })?.minutes || stated;
      return { ...w, description, duration_minutes: minutes2, tss: stated > 0 ? Math.round((Number(w.tss) || 0) * minutes2 / stated) : w.tss };
    });
    const runs = list.filter((w) => !isNote(w) && Number(w.duration_minutes) > 0);
    const longestOf = (from) => from.reduce((best, w) => Number(w.duration_minutes) > Number(best?.duration_minutes || 0) ? w : best, null);
    const long = target && target.long_run_minutes > 0 ? longestOf(runs.filter((w) => /\blong\b/i.test(String(w.title || "")))) || longestOf(runs) : null;
    if (target && target.long_run_minutes > 0) {
      if (long && Math.abs(Number(long.duration_minutes) - target.long_run_minutes) > Math.max(5, target.long_run_minutes * 0.05)) {
        const fitted = fitToMinutes(long.description, target.long_run_minutes);
        if (fitted) {
          const scale = target.long_run_minutes / Number(long.duration_minutes);
          long.description = fitted;
          long.duration_minutes = target.long_run_minutes;
          long.tss = Math.round((Number(long.tss) || 0) * scale);
        }
      }
    }
    const easy = runs.filter((w) => w !== long && /run/i.test(String(w.type || "Run")) && parseSteps(w.description).every((step) => step.pct === null || step.pct <= EASY_TOP_PCT));
    const easyEach = easy.map((w) => Number(w.duration_minutes));
    const easyTotal = easyEach.reduce((sum, n) => sum + n, 0);
    const others = runs.reduce((sum, w) => sum + (easy.includes(w) ? 0 : Number(w.duration_minutes)), 0);
    const room = target && target.week_kind !== "b_race" ? Math.max(MIN_RUN_MINUTES, target.target_duration_minutes - others) : easyTotal;
    const longMinutes = long ? Number(long.duration_minutes) : Infinity;
    const minutes = Math.min(easyTotal, room, longMinutes * easy.length);
    const uneven = easy.length > 1 && (Math.min(...easyEach) < MIN_RUN_MINUTES || Math.max(...easyEach) > Math.min(...easyEach) * 1.5);
    const over = easyTotal - minutes > Math.max(15, minutes * 0.1);
    let kept = easy;
    if (uneven || over || easyEach.some((n) => n > longMinutes)) {
      const load = easy.reduce((sum, w) => sum + (Number(w.tss) || 0), 0) * minutes / easyTotal;
      kept = [...easy].sort((x, y) => Number(y.duration_minutes) - Number(x.duration_minutes));
      while (kept.length > 1 && minutes / kept.length < MIN_RUN_MINUTES) kept = kept.slice(0, -1);
      const each = toFive(minutes / kept.length);
      kept.forEach((w) => {
        w.description = easySteps(each, metric);
        w.duration_minutes = each;
        w.tss = Math.round(load / kept.length);
      });
    }
    out[key] = list.filter((w) => !easy.includes(w) || kept.includes(w));
  }
  return out;
}

// src/lib/rideRacePlan.ts
var RIDE_RACE_RULES = {
  // Short events: published plans hold or barely raise load (Friel 1.0, British Cycling TT 1.14) and peak 1 to 3 weeks out
  crit: { label: "criterium", raceType: "crit", eventHours: 1, speedKmh: 38, growth: 1.04, maxRatio: 1.4, taper: [0.7, 0.45], longTop: 2.5, longShare: 0, quality: 2, focus: "one VO2 session (30/15s, or 3 to 5 minutes at 110 to 120%) and one race session of repeated 15 to 60 second efforts at 130 to 200% with short recoveries, and sprints", tempoShare: 0.08, hardPerHour: 3, minWeeks: 4 },
  road: { label: "road race", raceType: "road_race", eventHours: 3, speedKmh: 32, growth: 1.04, maxRatio: 1.5, taper: [0.7, 0.45], longTop: 4.5, longShare: 0, quality: 2, focus: "one VO2 session and one threshold or race session with surges above 120% inside longer efforts", tempoShare: 0.08, hardPerHour: 3, minWeeks: 4 },
  tt: { label: "time trial", raceType: "tt", eventHours: 1, speedKmh: 38, growth: 1.04, maxRatio: 1.4, taper: [0.7, 0.45], longTop: 3, longShare: 0, quality: 2, focus: "one threshold session (2 to 4 x 10 to 20 minutes at 95 to 105%) and one VO2 session, on the TT bike where possible", tempoShare: 0.17, hardPerHour: 1.5, minWeeks: 4 },
  cx: { label: "cyclocross", raceType: "cx", eventHours: 1, speedKmh: 20, growth: 1.04, maxRatio: 1.4, taper: [0.7, 0.45], longTop: 2.5, longShare: 0, quality: 2, focus: "one VO2 session and one cyclocross session of repeated 15 to 30 second efforts at 130 to 200% with short recoveries, with skills where possible", tempoShare: 0.08, hardPerHour: 3, minWeeks: 4 },
  // Long events: published sportive and gravel plans rise 1.4 to 2.2 times and ride 4 to 11 hours at most. Climbs and
  // attacks still take riders above threshold (14% of an Ötztaler above 90% of max HR, Neumayr 2002; finish time follows
  // climbing power, Sitko 2020). A gran fondo takes 3 minutes an hour above threshold (5% of the time: WorldTour riders
  // 4.2 to 7.4%, Mateo-March 2026) in two hard sessions, as the interval trials (Seiler 2013, Rønnestad 2015) and
  // Roadman's plan have. Gravel takes the same: published race files show 2 to 7 hour gravel races at least as hard as a
  // gran fondo (5 to 12 minutes an hour above threshold where zones were given; SBT GRVL 2025, Gravel Worlds 2019,
  // Gralloch), and Unbound 200 hardest in its first 2 to 3 hours (Clive, 2026-11-03)
  fondo: { label: "gran fondo", raceType: "fondo", eventHours: 5, speedKmh: 25, growth: 1.05, maxRatio: 1.6, taper: [0.7, 0.4], longTop: 6, longShare: 0.8, quality: 2, focus: "one VO2 session (4 to 6 x 3 to 5 minutes at 110 to 120%, or 30/15s) and one threshold session (2 to 3 x 10 to 20 minutes at 90 to 100%, as on long climbs)", tempoShare: 0.13, hardPerHour: 3, minWeeks: 6 },
  gravel: { label: "gravel or ultra", raceType: "gravel", eventHours: 8, speedKmh: 20, growth: 1.05, maxRatio: 1.7, taper: [0.75, 0.55, 0.35], longTop: 6, longShare: 0.6, quality: 2, focus: "one VO2 session (4 to 6 x 3 to 5 minutes at 110 to 120%, or 30/15s) and one threshold session (2 to 3 x 10 to 20 minutes at 90 to 100%, as on the climbs and the hard opening hours)", tempoShare: 0.12, hardPerHour: 3, minWeeks: 8 }
};
var RIDE_RACE = {
  lighterEvery: 4,
  lighter: 0.7,
  hoursPower: 0.9,
  longUp: 1.12,
  longLighter: 0.7,
  longMaxShare: 0.6,
  longTaper: [0.6, 0.45],
  // The short sharp session that keeps the intensity in a lighter, taper or race week: 3 x 3 minutes above 105%
  sharpMinutes: 9,
  bRace: { before: 0.9, week: 0.75, after: 0.8 },
  lookbackDays: 28
};
var EASY_TOP_PCT2 = 75;
var MIN_RIDE_MINUTES = 45;
var round12 = (n) => Math.round(n * 10) / 10;
var toFive2 = (n) => Math.round(n / 5) * 5;
var rulesOf2 = (event) => RIDE_RACE_RULES[event] || RIDE_RACE_RULES.road;
function rideEventOf(race) {
  const name = String(race?.name || race?.title || "");
  if (/cyclo-?cross|\bcx\b|\bveldrit\b/i.test(name)) return "cx";
  if (/\btt\b|\bitt\b|time\s?trial|chrono|contre[- ]la[- ]montre|zeitfahren|cronometro/i.test(name)) return "tt";
  if (/\bcrit\b|crit[eé]rium|kermesse|kermis/i.test(name)) return "crit";
  if (/gravel|unbound|\bultra\b|bikepacking|grvl/i.test(name)) return "gravel";
  if (/fondo|sportive|century|[eé]tape|randonn|marmotte|audax|brevet/i.test(name)) return "fondo";
  if (/road\s?race|\brr\b|classic|grand prix|\bgp\b|kermesse/i.test(name)) return "road";
  const hours = rideEventHours(race, null);
  if (hours == null) return null;
  if (hours >= 4) return "fondo";
  if (hours >= 1.5) return "road";
  return null;
}
function rideEventHours(race, event) {
  const seconds = Number(race?.moving_time || 0);
  if (seconds > 0) return round12(seconds / 3600);
  const metres = Number(race?.distance || race?.distance_target || 0);
  if (metres > 0) return round12(metres / 1e3 / (event ? rulesOf2(event).speedKmh : 28));
  return null;
}
function rideBaselineFromActivities(activities, today = /* @__PURE__ */ new Date()) {
  const from = today.getTime() - RIDE_RACE.lookbackDays * 864e5;
  const seen = /* @__PURE__ */ new Set();
  const rides = (Array.isArray(activities) ? activities : []).filter((a) => {
    const when = new Date(String(a?.start_date_local || "")).getTime();
    if (!/ride/i.test(String(a?.type || "")) || /ebike/i.test(String(a?.type || "")) || !(Number(a?.moving_time) > 0) || !(when >= from && when <= today.getTime())) return false;
    const key = `${a.start_date_local}|${Math.round(Number(a.distance) || 0)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!rides.length) return null;
  const weeks = RIDE_RACE.lookbackDays / 7;
  const seconds = rides.reduce((s, a) => s + Number(a.moving_time), 0);
  const load = rides.reduce((s, a) => s + (Number(a.icu_training_load) || 0), 0);
  if (!(load > 0)) return null;
  return {
    tss: Math.round(load / weeks),
    hours: round12(seconds / 3600 / weeks),
    longestHours: round12(Math.max(...rides.map((a) => Number(a.moving_time) || 0)) / 3600),
    rides: rides.length
  };
}
function rideLongTop(event, eventHours) {
  const R = rulesOf2(event);
  return R.longShare > 0 ? Math.min(R.longTop, Math.max(2, R.longShare * (Number(eventHours) || R.eventHours))) : R.longTop;
}
function rideRaceWeekTargets(input, baseWeeks) {
  const G = RIDE_RACE;
  const R = rulesOf2(input.event);
  const N = Math.max(R.minWeeks, Math.round(Number(input.weeks) || 0));
  const S = Math.max(50, Number(input.start_tss) || 0);
  const H = Math.max(1, Number(input.start_hours) || 0);
  const days = Math.max(2, Math.min(7, Number(input.days) || 4));
  const lastDays = Math.round(Number(input.last_week_days) || 7);
  const peakWeek = N - R.taper.length;
  const ratio = Math.min(R.maxRatio, Math.pow(R.growth, peakWeek - 1));
  const peak = S * ratio;
  const bWeeks = (input.b_race_weeks || []).filter((w) => w >= 1 && w <= peakWeek);
  const longTop = rideLongTop(input.event, input.event_hours);
  const every = peakWeek % G.lighterEvery === 0 ? 3 : G.lighterEvery;
  let longBest = Math.max(1, Number(input.longest_hours) || H * 0.35);
  const out = [];
  for (let w = 1; w <= N; w++) {
    let kind = "build";
    let tss;
    if (w > peakWeek) {
      tss = peak * R.taper[w - peakWeek - 1];
      kind = w === N ? "race_week" : "taper";
    } else {
      tss = S * Math.pow(ratio, (w - 1) / Math.max(1, peakWeek - 1));
      if (w === peakWeek) kind = "peak";
      else if (bWeeks.includes(w)) {
        tss *= G.bRace.week;
        kind = "b_race";
      } else if (bWeeks.includes(w - 1)) {
        tss *= G.bRace.after;
        kind = "b_recovery";
      } else if (bWeeks.includes(w + 1)) tss *= G.bRace.before;
      else if (w >= 2 && (peakWeek - w) % every === every - 1) {
        tss *= G.lighter;
        kind = "lighter";
      }
    }
    const hours = H * Math.pow(tss / S, G.hoursPower);
    let longH;
    if (w > peakWeek) longH = w === N ? 0 : longTop * (G.longTaper[w - peakWeek - 1] ?? G.longTaper[G.longTaper.length - 1]);
    else if (kind === "b_race") longH = 0;
    else if (kind === "b_recovery") longH = longBest * 0.5;
    else if (kind === "lighter") longH = longBest * G.longLighter;
    else {
      longH = Math.min(longTop, longBest * G.longUp);
      longBest = Math.max(longBest, longH);
    }
    longH = Math.min(longH, hours * G.longMaxShare);
    const quality = kind === "build" || kind === "peak" ? R.quality : kind === "b_race" ? 0 : 1;
    const loading = kind === "build" || kind === "peak";
    const tempo = loading ? toFive2(hours * 60 * R.tempoShare) : kind === "lighter" || kind === "taper" || kind === "b_recovery" ? toFive2(hours * 60 * R.tempoShare * 0.5) : 0;
    const hard = loading ? Math.round(hours * R.hardPerHour) : kind === "lighter" || kind === "taper" || kind === "race_week" ? G.sharpMinutes : 0;
    const base = baseWeeks?.find((b) => b.index === w) || baseWeeks?.[w - 1] || {};
    const share = w === N && lastDays >= 1 && lastDays < 7 ? lastDays / 7 : 1;
    const weekHours = round12(hours * share);
    out.push({
      index: w,
      startStr: base.startStr,
      endStr: base.endStr,
      startLabel: base.startLabel,
      endLabel: base.endLabel,
      phase: kind === "build" || kind === "peak" ? "load" : "recovery",
      target_tss: Math.round(tss * share),
      target_hours: weekHours,
      target_duration_minutes: Math.round(weekHours * 60),
      training_frequency: w === N ? Math.max(1, Math.min(days, 4, lastDays)) : days,
      ceiling: true,
      week_kind: kind,
      long_ride_minutes: toFive2(longH * 60),
      quality_sessions: quality,
      tempo_minutes: tempo,
      hard_minutes: hard
    });
  }
  return out;
}
function rideRacePromptRules(input) {
  const R = rulesOf2(input.event);
  const long = R.longShare > 0;
  const dates = (input.b_race_dates || []).join(", ");
  const extra = long ? "\n8. LONG EVENT: the long ride practises fuelling (60 to 90 g of carbohydrate an hour)." : "";
  return `
RIDE ${R.label.toUpperCase()} PLAN (these rules outrank the load rules above where they differ):
Every week in 'WEEKS TO GENERATE' carries week_kind, long_ride_minutes, quality_sessions, tempo_minutes and hard_minutes. The code has set these. Follow them.
1. LONG RIDE: when long_ride_minutes is above 0, write one long ride of exactly that length on the weekend, Z2 (56 to 75%) apart from the tempo blocks of rule 3. Never make it longer, and never move the week's spare minutes into it.
2. HARD SESSIONS: write exactly quality_sessions hard sessions that week. In a build or peak week: ${R.focus}. In a lighter, taper or race week the one hard session is short and sharp: 3 x 3 minutes at 105 to 110% with 3 minutes easy between, in race week two or three days before the race. Openers are extra to it.
3. TEMPO AND HARD MINUTES: tempo_minutes is the week's work time at 76 to 105% and hard_minutes its work time above 105%, counting work steps only (not warm-ups, recoveries, cool-downs or openers). Write those amounts, within 5 minutes: the hard minutes in the hard sessions, the tempo minutes in the hard sessions and as blocks of 10 to 20 minutes in the long ride's second half.
   Everything else is Z2 (60 to 75%) or Z1 recovery. Never two hard days in a row: an easy ride or rest day between the hard sessions and the long ride.
4. RIDES: keep to training_frequency sessions. Every session is a Ride. A rest day is a note (category NOTE), never a workout.
   STEPS: every step line starts with "- " and holds a time written like 40m, 1h30m or 90s, never in words such as "40 minutes", and a % target. Repeats use a header line such as "4x" with a blank line before and after. A session with no such step lines is wrong.
5. PROGRESS: never copy a week. Each loading week must differ from the same week of the block before it, in reps, rep length or target.
6. RACE WEEK: the race itself is on the calendar and is never written as a workout. Openers the day before are fine: 30 to 45 minutes easy with 3 x 1 minute at 110 to 120%.
7. TAPER: in a taper week keep the same number of rides, shorter, with the one short hard session.${extra}${dates ? `
9. B RACES: ${dates} ${input.b_race_dates && input.b_race_dates.length > 1 ? "are races" : "is a race"} on the calendar. Never write a race as a workout, and write nothing hard in the 2 days before one or the day after it.` : ""}
`;
}
function easySteps2(minutes) {
  const edges = minutes >= 60 ? [10, 10] : [5, 5];
  const main2 = Math.max(5, Math.round(minutes) - edges[0] - edges[1]);
  return `- Warmup ${edges[0]}m 55%
- ${main2}m 65%
- Cooldown ${edges[1]}m 50%`;
}
var isRide = (w) => /ride/i.test(String(w?.type || "Ride"));
function sharpSteps(minutes) {
  const rest = Math.max(5, Math.round(minutes) - 15 - 18 - 10);
  return `- Warmup 15m 55%

3x
- 3m 108%
- 3m 60%

- ${rest}m 65%
- Cooldown 10m 50%`;
}
function hasHardSet(description) {
  let above = 0, threshold = 0;
  for (const step of parseSteps(description)) {
    const seconds = step.seconds * (step.inRepeat ? step.repeats : 1);
    if ((step.pct ?? 0) > 105) above += seconds;
    else if ((step.pct ?? 0) >= 91) threshold += seconds;
  }
  return above >= 360 || threshold >= 600;
}
var daysApart = (from, to) => Math.round(((/* @__PURE__ */ new Date(to + "T12:00:00Z")).getTime() - (/* @__PURE__ */ new Date(from + "T12:00:00Z")).getTime()) / 864e5);
function reconcileRideRaceWeeks(weeks, targets, bRaceDates = [], raceDate = "") {
  const out = {};
  const isNote = (w) => String(w?.category || "").toUpperCase() === "NOTE";
  for (const key of Object.keys(weeks || {})) {
    const target = targets.find((t) => t.index === Number(key));
    const list = (Array.isArray(weeks[key]) ? weeks[key] : []).filter((w) => {
      const date = String(w?.date || "").slice(0, 10);
      if (isNote(w)) return true;
      if (raceDate && date === raceDate) return false;
      if (/opener|activation|shake|prime/i.test(String(w?.title || ""))) return true;
      return !(bRaceDates.includes(date) && /\brace\b|crit|fondo|sportive|\btt\b|time trial|gravel|cross/i.test(`${w?.title || ""} ${w?.description || ""}`));
    }).map((w) => {
      if (isNote(w)) return w;
      if (!isRide(w)) return parseSteps(String(w?.description || "")).length || /weight|strength|yoga|core|mobility/i.test(String(w?.type || "")) ? w : { ...w, category: "NOTE", duration_minutes: 0, tss: 0 };
      const stated = Number(w.duration_minutes) || 0;
      if (!(stated > 0) && !parseSteps(String(w.description || "")).length) return { ...w, category: "NOTE", duration_minutes: 0, tss: 0 };
      const text = String(w.description || "").split("\n").filter((line) => !/^\s*-.*\b(0[ms]|\d+ms)\b/.test(line)).join("\n");
      const readable = parseSteps(sanitizeWorkoutDescription(text, w.type)).length > 0;
      const description = readable ? text : easySteps2(stated);
      const totals = itemTotals({ ...w, description });
      const hardTitle = /interval|threshold|vo2|tempo|sweet|race|sprint|over|ftp|hill|attack|surge|effort|max|\btt\b/i.test(String(w.title || ""));
      return { ...w, ...readable || !hardTitle ? {} : { title: "Easy ride" }, description, duration_minutes: totals?.minutes || stated, tss: totals?.tss || w.tss };
    });
    const rides = list.filter((w) => !isNote(w) && isRide(w) && Number(w.duration_minutes) > 0);
    const longestOf = (from) => from.reduce((best, w) => Number(w.duration_minutes) > Number(best?.duration_minutes || 0) ? w : best, null);
    const long = target && target.long_ride_minutes > 0 ? longestOf(rides.filter((w) => /\blong\b/i.test(String(w.title || "")))) || longestOf(rides) : null;
    if (long && target && Math.abs(Number(long.duration_minutes) - target.long_ride_minutes) > Math.max(5, target.long_ride_minutes * 0.05)) {
      const fitted = fitToMinutes(long.description, target.long_ride_minutes);
      if (fitted) {
        long.description = fitted;
        const totals = itemTotals(long);
        long.duration_minutes = totals?.minutes || target.long_ride_minutes;
        long.tss = totals?.tss || long.tss;
      }
    }
    const easy = rides.filter((w) => w !== long && parseSteps(w.description).every((step) => step.pct === null || step.pct <= EASY_TOP_PCT2));
    const easyTotal = easy.reduce((sum, w) => sum + Number(w.duration_minutes), 0);
    const others = rides.reduce((sum, w) => sum + (easy.includes(w) ? 0 : Number(w.duration_minutes)), 0);
    const room = target && target.week_kind !== "b_race" ? Math.max(MIN_RIDE_MINUTES, target.target_duration_minutes - others) : easyTotal;
    const longMinutes = long ? Number(long.duration_minutes) : Infinity;
    const minutes = Math.min(easyTotal, room, longMinutes * easy.length);
    let kept = easy;
    if (easy.length && easyTotal - minutes > Math.max(15, minutes * 0.1)) {
      kept = [...easy].sort((x, y) => Number(y.duration_minutes) - Number(x.duration_minutes));
      while (kept.length > 1 && minutes / kept.length < MIN_RIDE_MINUTES) kept = kept.slice(0, -1);
      const each = toFive2(minutes / kept.length);
      kept.forEach((w) => {
        w.description = fitToMinutes(w.description, each) || easySteps2(each);
        const totals = itemTotals(w);
        w.duration_minutes = totals?.minutes || each;
        w.tss = totals?.tss || w.tss;
      });
    }
    if (target && target.week_kind !== "b_race" && kept.length) {
      const total = rides.filter((w) => !easy.includes(w) || kept.includes(w)).reduce((sum, w) => sum + Number(w.duration_minutes), 0);
      const short = target.target_duration_minutes - total;
      if (short > target.target_duration_minutes * 0.15) {
        const cap = Number.isFinite(longMinutes) ? longMinutes : 90;
        kept.forEach((w) => {
          const each = Math.min(cap, toFive2(Number(w.duration_minutes) + short / kept.length));
          const fitted = each > Number(w.duration_minutes) ? fitToMinutes(w.description, each) : null;
          if (!fitted) return;
          w.description = fitted;
          const totals = itemTotals(w);
          w.duration_minutes = totals?.minutes || each;
          w.tss = totals?.tss || w.tss;
        });
      }
    }
    out[key] = list.filter((w) => !easy.includes(w) || kept.includes(w));
    if (target && target.hard_minutes > 0 && ["lighter", "taper", "race_week"].includes(target.week_kind) && !out[key].some((w) => !isNote(w) && isRide(w) && hasHardSet(w.description))) {
      const host = kept.filter((w) => Number(w.duration_minutes) >= 50 && (!raceDate || !w.date || daysApart(String(w.date).slice(0, 10), raceDate) >= 2)).sort((x, y) => Number(y.duration_minutes) - Number(x.duration_minutes))[0];
      if (host) {
        host.description = sharpSteps(Number(host.duration_minutes));
        host.title = "Short sharp efforts";
        const totals = itemTotals(host);
        host.duration_minutes = totals?.minutes || host.duration_minutes;
        host.tss = totals?.tss || host.tss;
      }
    }
  }
  return out;
}

// CLI
import { readFileSync } from "node:fs";
var USAGE = `Montis race plans (Run: marathon, half, 10k; Ride: crit, road, tt, cx, fondo, gravel)
  node race_plan.mjs rules
  node race_plan.mjs detect '<raceJSON>'
  node race_plan.mjs run-baseline '<activitiesJSON>' [YYYY-MM-DD]
  node race_plan.mjs ride-baseline '<activitiesJSON>' [YYYY-MM-DD]
  node race_plan.mjs run-pace marathon|half|10k [thresholdKmh]
  node race_plan.mjs run-weeks '<runInputJSON>' ['<baseWeeksJSON>']
  node race_plan.mjs ride-weeks '<rideInputJSON>' ['<baseWeeksJSON>']
  node race_plan.mjs run-prompt '<runInputJSON>' [PACE|HR|POWER]
  node race_plan.mjs ride-prompt '<rideInputJSON>'
  node race_plan.mjs run-reconcile '<weeksJSON>' '<targetsJSON>' [PACE|HR|POWER] ['<bRaceDatesJSON>'] [raceDate]
  node race_plan.mjs ride-reconcile '<weeksJSON>' '<targetsJSON>' ['<bRaceDatesJSON>'] [raceDate]
A JSON argument can be @path to read it from a file, or - to read it from stdin.`;
function arg(value, fallback = void 0) {
  if (value === void 0 || value === "") return fallback;
  const text = value === "-" ? readFileSync(0, "utf8") : value.startsWith("@") ? readFileSync(value.slice(1), "utf8") : value;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
function main(argv) {
  const [cmd, a, b, c, d, e] = argv;
  const out = (value) => process.stdout.write((typeof value === "string" ? value : JSON.stringify(value, null, 2)) + "\n");
  switch (cmd) {
    case "rules":
      return out({ run: { ...RUN_RACE, rules: RUN_RACE_RULES }, ride: { ...RIDE_RACE, rules: RIDE_RACE_RULES } });
    case "detect": {
      const race = arg(a, {});
      const event = rideEventOf(race);
      return out({ run_distance: raceDistanceOf(race), ride_event: event, ride_event_hours: event && event !== "other" ? rideEventHours(race, event) : null });
    }
    case "run-baseline":
      return out(runBaselineFromActivities(activitiesOf(arg(a, [])), b ? /* @__PURE__ */ new Date(`${b}T12:00:00`) : /* @__PURE__ */ new Date()));
    case "ride-baseline":
      return out(rideBaselineFromActivities(activitiesOf(arg(a, [])), b ? /* @__PURE__ */ new Date(`${b}T12:00:00`) : /* @__PURE__ */ new Date()));
    case "run-pace":
      return out({ pace_percent: racePacePercent(a, b ? Number(b) : null) });
    case "run-weeks":
      return out(runRaceWeekTargets(arg(a), arg(b)));
    case "ride-weeks":
      return out(rideRaceWeekTargets(arg(a), arg(b)));
    case "run-prompt": {
      const input = arg(a);
      return out(runStepSyntax(b || "PACE", input) + "\n" + runRacePromptRules(input));
    }
    case "ride-prompt":
      return out(rideRacePromptRules(arg(a)));
    case "run-reconcile":
      return out(reconcileRunRaceWeeks(arg(a), arg(b), c || "PACE", arg(d, []), e || ""));
    case "ride-reconcile":
      return out(reconcileRideRaceWeeks(arg(a), arg(b), arg(c, []), d || ""));
    default:
      return out(USAGE);
  }
}
var self = String(process.argv[1] || "").replace(/\\/g, "/").split("/").pop();
if (self && import.meta.url.endsWith(self)) main(process.argv.slice(2));
export {
  RIDE_RACE,
  RIDE_RACE_RULES,
  RUN_RACE,
  RUN_RACE_RULES,
  activitiesOf,
  raceDistanceOf,
  racePacePercent,
  reconcileRideRaceWeeks,
  reconcileRunRaceWeeks,
  rideBaselineFromActivities,
  rideEventHours,
  rideEventOf,
  rideRacePromptRules,
  rideRaceWeekTargets,
  runBaselineFromActivities,
  runMetricOf,
  runRacePromptRules,
  runRaceWeekTargets,
  runStepSyntax
};
