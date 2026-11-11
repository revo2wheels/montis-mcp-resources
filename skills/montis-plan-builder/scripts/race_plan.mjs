// entry.ts
import { readFileSync } from "node:fs";

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
function settleRestNotes(items) {
  const isNote = (w) => String(w?.category || "").toUpperCase() === "NOTE";
  const dayOf = (w) => String(w?.date || w?.scheduled_date || w?.start_date_local || "").slice(0, 10);
  const trainingDays = new Set(items.filter((w) => !isNote(w) && Number(w?.duration_minutes) > 0).map(dayOf));
  return items.filter((w) => !(isNote(w) && dayOf(w) && trainingDays.has(dayOf(w)))).map((w) => isNote(w) ? { ...w, duration_minutes: 0, tss: 0 } : w);
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

// src/lib/crossTraining.ts
var CROSS_TRAINING_TILES = [
  { key: "ride", label: "Ride", types: ["Ride", "VirtualRide"] },
  { key: "run", label: "Run", types: ["Run", "VirtualRun"] },
  { key: "swim", label: "Swim", types: ["Swim"] },
  { key: "skierg", label: "SkiErg", types: ["VirtualSki"] },
  { key: "nordic", label: "Nordic ski", types: ["NordicSki", "RollerSki"] },
  { key: "hike", label: "Hike", types: ["Hike", "Walk"] }
];
var KNOWN_TYPES = new Set(CROSS_TRAINING_TILES.flatMap((t) => t.types.map((x) => x.toLowerCase())));
function crossEasySteps(minutes) {
  const edge = minutes >= 60 ? 10 : 5;
  const main2 = Math.max(5, Math.round(minutes) - 2 * edge);
  return `- Warmup ${edge}m Z1
- ${main2}m Z2
- Cooldown ${edge}m Z1`;
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
  // 5K (parkrun): the 10K rule with the race's own distance (Clive, 2026-11-11: "5k 10k is ok")
  "5k": { label: "5K", raceType: "run_5k", km: 5, growth: 1.06, ratioByStartKm: [[Infinity, 1.4]], growthLowBase: 1.08, maxRatioLowBase: 1.8, floorKm: 25, lighter: 0.88, taper: [0.9, 0.75, 0.3], longMaxKm: 16, longMaxMinutes: 100, longTaper: [0.75, 0.5], paceFromWeeksOut: 6, paceShare: [0.06, 0.1], quality: 2, minWeeks: 4 },
  "10k": { label: "10K", raceType: "run_10k", km: 10, growth: 1.06, ratioByStartKm: [[Infinity, 1.4]], growthLowBase: 1.08, maxRatioLowBase: 1.8, floorKm: 25, lighter: 0.88, taper: [0.9, 0.75, 0.3], longMaxKm: 16, longMaxMinutes: 100, longTaper: [0.75, 0.5], paceFromWeeksOut: 6, paceShare: [0.06, 0.1], quality: 2, minWeeks: 4 },
  // Road and runnable-trail ultras, built on the marathon rules. The long run stops at 3 h 30 (3 h for 50 km): Popov &
  // Sovenko 2024 (20 experienced 100 km runners, 20 weeks: long efforts of at most 3.5 h beat up to 6 h), Jornet's published
  // 100-mile builds on runs of 3 to 4 h, Macmillan's 100 km plan at 3 h. No race-pace minutes: an ultra's race pace is easy
  // running, and the quality is a steady-state and a VO2 or tempo session (Koop 2016). The taper is the marathon's;
  // the sources disagree, so it stays a convention
  "50k": { label: "50 km", raceType: "run_50k", km: 50, growth: 1.05, ratioByStartKm: [[45, 2], [60, 1.75], [80, 1.6], [100, 1.5], [Infinity, 1.3]], growthLowBase: 1.07, maxRatioLowBase: 3, floorKm: 55, lighter: 0.8, taper: [0.75, 0.35], longMaxKm: 32, longMaxMinutes: 180, longTaper: [0.6], paceFromWeeksOut: 0, paceShare: [0, 0], quality: 2, minWeeks: 8 },
  "100k": { label: "100 km", raceType: "run_100k", km: 100, growth: 1.05, ratioByStartKm: [[45, 2], [60, 1.75], [80, 1.6], [100, 1.5], [Infinity, 1.3]], growthLowBase: 1.07, maxRatioLowBase: 3, floorKm: 55, lighter: 0.8, taper: [0.75, 0.55, 0.25], longMaxKm: 40, longMaxMinutes: 210, longTaper: [0.7, 0.4], paceFromWeeksOut: 0, paceShare: [0, 0], quality: 2, minWeeks: 8 }
};
var isUltraDistance = (distance) => distance === "50k" || distance === "100k";
var RUN_RACE = {
  lighterEvery: 4,
  // Real runners' hours rise a little slower than their load
  hoursPower: 0.9,
  longUp: 1.1,
  longLighter: 0.75,
  longMaxShare: 0.55,
  bRace: { before: 0.9, week: 0.75, after: 0.7 },
  // Race season, as Ride (Clive, 2026-11-11): three or more races inside the plan; the load held at the start, the last week at
  // 80%; the long run the day after a race of up to 10 km, none after a longer one
  seasonMinRaces: 3,
  seasonFinal: 0.8,
  seasonShortRaceKm: 10,
  seasonTrainingFloor: 0.4,
  lookbackDays: 28,
  // A start for someone with no Run activities, about 24 km a week as first-time plans use. Shown as such, and editable
  noHistory: { tss: 150, hours: 2.5, longestKm: 8, speedKmh: 10 }
};
var runSeasonOn = (input) => input.season === true && (input.b_race_weeks || []).length >= RUN_RACE.seasonMinRaces - 1;
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
    if (km >= 4.5 && km <= 5.5) return "5k";
    if (km >= 9.5 && km <= 10.5) return "10k";
    if (km >= 48 && km <= 56) return "50k";
    if (km >= 95 && km <= 105) return "100k";
    return "other";
  }
  const name = String(race?.name || race?.title || "");
  if (/\b(half|semi|demi|halb|mezza|media|medio)\b|halbmarathon|halve/i.test(name)) return "half";
  if (/marat[oó]n|marathon/i.test(name)) return "marathon";
  if (/parkrun|\b5\s?(k|km)\b/i.test(name)) return "5k";
  if (/\b10\s?(k|km)\b/i.test(name)) return "10k";
  if (/\b50\s?(k|km)\b/i.test(name)) return "50k";
  if (/\b100\s?(k|km)\b/i.test(name)) return "100k";
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
  if (distance === "5k") return 106;
  if (distance === "50k") return 85;
  if (distance === "100k") return 80;
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
  const seasonWeeks = (input.b_race_weeks || []).filter((w) => w >= 1 && w <= N);
  const season = runSeasonOn(input);
  const targetWeek = baseWeeks?.find((b) => b.startStr && b.endStr && input.race_date && input.race_date >= b.startStr && input.race_date <= b.endStr)?.index ?? N;
  const longTop = Math.min(R.longMaxKm, R.longMaxMinutes / 60 * v);
  let longBest = Math.max(1, Number(input.longest_km) || G.noHistory.longestKm);
  const out = [];
  for (let w = 1; w <= N; w++) {
    const weeksOut = N - w;
    let kind = "build";
    let tss;
    if (season) {
      kind = w === targetWeek ? "race_week" : seasonWeeks.includes(w) ? "season" : "build";
      const held = w === targetWeek ? S * G.seasonFinal : S;
      tss = kind === "build" ? held : Math.max(held * G.seasonTrainingFloor, held - (Number(input.race_tss) || 0));
    } else if (w > peakWeek) {
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
    if (season) longKm = kind === "race_week" ? 0 : kind === "season" ? R.km <= G.seasonShortRaceKm ? Math.min(longTop, longBest) : 0 : Math.min(longTop, longBest);
    else if (w > peakWeek) longKm = w === N ? 0 : Math.min(longTop, longBest) * R.longTaper[w - peakWeek - 1];
    else if (kind === "b_race") longKm = 0;
    else if (kind === "b_recovery") longKm = longBest * 0.5;
    else if (kind === "lighter" || w === peakWeek - 1) longKm = longBest * G.longLighter;
    else {
      longKm = Math.min(longTop, longBest * G.longUp);
      longBest = Math.max(longBest, longKm);
    }
    longKm = Math.min(longKm, hours * v * G.longMaxShare);
    const paceOn = !season && weeksOut <= R.paceFromWeeksOut && weeksOut >= 2 && (kind === "build" || kind === "peak" || weeksOut === 2);
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
      training_frequency: Math.max(1, (w === N ? Math.min(days, 4, lastDays) : days) - (season && kind !== "build" ? 1 : 0)),
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
  const pace = metric === "HR" ? { marathon: 93, half: 98, "10k": 102, "50k": 88, "100k": 85 }[input.distance] ?? 93 : Number(input.pace_percent) || racePacePercent(input.distance);
  const jog = metric === "HR" ? "Z1 HR" : `65${p}`;
  return `INTERVALS.ICU WORKOUT STEP SYNTAX (MANDATORY):
1. EVERY STEP MUST START WITH "- " AND HOLD A TIME AND A TARGET:
   Times are written like 40m, 1h30m or 90s, never in words such as "40 minutes". A session with no such step lines is wrong.
2. STRICTLY NO CALCULATED VALUES IN PARENTHESES, such as "(160bpm)" or "(4:30/km)".
3. REPEAT BLOCKS USE A HEADER LINE WITHOUT A HYPHEN, WITH ONE BLANK LINE BEFORE AND AFTER. Repeats cannot be nested.
4. TARGETS: warm-up, cool-down and recovery running are Z1${z}. Easy running is Z2${z}. Threshold is 100${p}. ${label} race pace is ${pace}${p}.
   Recovery between reps is an easy jog, ${jog}, never 50%.
5. NOTES UNDER THE WORKOUT: a line that is not a step (fuelling, how to run it) goes at the end of the description, after ONE blank line below the last step, never directly under a step: Intervals.icu reads a line right under a step as part of that step and takes its numbers as targets.

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
function runRacePromptRules(input, metric = "PACE") {
  const R = rulesOf(input.distance);
  const dates = (input.b_race_dates || []).join(", ");
  const raceShare = Number(input.race_tss) > 0 ? ` The race (about ${Math.round(Number(input.race_tss))} TSS) is on the calendar, not in your answer, and sits on top of the week: target_tss, target_hours and training_frequency are the training alone, without the race.` : "";
  const p = pctWord(metric);
  const days = Math.max(2, Math.min(7, Number(input.days) || 4));
  const seasonOn = runSeasonOn(input);
  const seasonQuality = input.distance === "5k" || input.distance === "10k" ? `a VO2 session: 5 to 6 x 3 minutes at 110${p} with 2 minutes easy between, or 8 x 1 minute at 115${p}` : isUltraDistance(input.distance) ? `a steady state: 2 x 20 minutes at 88${p} with 5 minutes easy between` : `a threshold session: 2 x 15 to 20 minutes at 95 to 100${p} with 3 minutes easy between`;
  const bRule = !dates ? "" : seasonOn ? `
8. RACE SEASON: ${dates} are races on the calendar, and each is its week's race: never write a race as a workout. In a race-season week ("week_kind": "season") write exactly one quality session midweek, ${seasonQuality}; strides the day before the race (30 minutes easy with 4 x 20 seconds fast); the long run of long_run_minutes the day after the race or on a free weekend day and never the day before a race; everything else easy. The week's load holds at target_tss: a season is for racing, not building.${raceShare} training_frequency is the number of training sessions to write that week, already one fewer in a week with a race; the openers or strides the day before a race are one of them; never more, never fewer. Every other day except a race day is a rest day: one rest note and nothing else on it. With 4 or more training sessions, never two rest days in a row. The week's entries sum to target_tss, never to starting_tss.` : `
8. B RACES: ${dates} ${input.b_race_dates && input.b_race_dates.length > 1 ? "are races" : "is a race"} on the calendar. Never write a race as a workout, and write nothing hard in the 3 days before one or the 2 days after it.${raceShare}`;
  if (isUltraDistance(input.distance)) {
    const weeks = Math.max(R.minWeeks, Math.round(Number(input.weeks) || 0));
    const half = Math.ceil(weeks / 2);
    return `
RUN ${R.label.toUpperCase()} PLAN (these rules outrank the load rules above where they differ):
Every week in 'WEEKS TO GENERATE' carries week_kind and long_run_minutes. The code has set these from the athlete's own Run history. Follow them.
1. LONG RUN: when long_run_minutes is above 0, write one long run of exactly that length on the weekend, easy throughout. Never make it longer, and never move the week's spare minutes into it.
2. OTHER RUNS: spread the week's other minutes evenly over the other sessions. Every session is a Run. Keep to training_frequency sessions.
3. QUALITY: in a week of kind build or peak, two quality sessions on separate days. Session A, every such week: STEADY STATE, two reps of 30 minutes at 88${p} with 5 minutes of easy jogging between, and these two lines in the text: "Effort 7 of 10, below threshold throughout." and "HR cap: end the rep if heart rate goes over 90% of LTHR." Session B in weeks 1 to ${half}: VO2, 5 to 6 reps of 3 minutes at 110${p} with 2 minutes of easy jogging between, text "Effort 10 of 10." Session B from week ${half + 1}: TEMPO, 3 reps of 12 minutes at 96${p} with 6 minutes of easy jogging between, text "Effort 8 of 10: short sentences, not a conversation." Never write race pace; the race is run at an easy effort. In a lighter week, b_race or b_recovery week: easy running with strides only. In a taper week keep session A at half its reps.
4. EASY RUNS: easy running is Z2${zoneWord(metric)}, never above 80${p}. At least 75% of the week is easy.
5. HARD DAYS: always one easy run or rest day between quality sessions and the long run.
6. PROGRESS: never copy a week. Each loading week must differ from the same week of the block before it, in reps or rep length.
7. RACE WEEK: the race itself is on the calendar and is never written as a workout.${bRule}
`;
  }
  return `
RUN ${R.label.toUpperCase()} PLAN (these rules outrank the load rules above where they differ):
Every week in 'WEEKS TO GENERATE' carries week_kind, long_run_minutes and race_pace_minutes. The code has set these from the athlete's own Run history. Follow them.
1. LONG RUN: when long_run_minutes is above 0, write one long run of exactly that length on the weekend, easy throughout unless rule 3 puts race pace in it. Never make it longer, and never move the week's spare minutes into it.
2. OTHER RUNS: spread the week's other minutes evenly over the other sessions. Every session is a Run. Keep to training_frequency sessions.
3. RACE PACE: when race_pace_minutes is above 0, one session holds that many minutes at race pace, as one block or as reps, in a mid-week run${R.quality === 1 ? " or inside the long run" : ""}. Otherwise write no race pace.
4. QUALITY: in a week of kind build or peak, ${R.quality === 1 ? "one quality session" : "up to two quality sessions, with at least 5 training days"}: threshold or speed before race pace begins, and race pace once it does. In a lighter week, b_race or b_recovery week: easy running with strides only. In a taper week keep one short quality session and the same number of runs.${seasonOn ? " In a race-season week the one quality session is the one of rule 8." : ""}
5. HARD DAYS: always one easy run or rest day between quality sessions and the long run. At least 75% of the week is easy.
6. PROGRESS: never copy a week. Each loading week must differ from the same week of the block before it, in reps, rep length or race-pace time.
7. RACE WEEK: the race itself is on the calendar and is never written as a workout.${bRule}
`;
}
function reconcileRunRaceWeeks(weeks, targets, metric, bRaceDates = [], raceDate = "", distance, crossSports = []) {
  const out = {};
  const isNote = (w) => String(w?.category || "").toUpperCase() === "NOTE";
  const isCross = (w) => crossSports.some((t) => t.toLowerCase() === String(w?.type || "").trim().toLowerCase());
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
      if (!/run/i.test(String(w?.type || "Run"))) {
        if (isCross(w) && !parseSteps(String(w?.description || "")).length && Number(w?.duration_minutes) > 0) {
          const description2 = crossEasySteps(Number(w.duration_minutes));
          const totals = itemTotals({ ...w, description: description2 });
          return { ...w, description: description2, duration_minutes: totals?.minutes || Number(w.duration_minutes), tss: totals?.tss || w.tss };
        }
        return parseSteps(String(w?.description || "")).length || /weight|strength|yoga|core|mobility/i.test(String(w?.type || "")) ? w : { ...w, category: "NOTE", duration_minutes: 0, tss: 0 };
      }
      const stated = Number(w.duration_minutes) || 0;
      const text = String(w.description || "").split("\n").filter((line) => !/^\s*-.*\b(0[ms]|\d+ms)\b/.test(line)).join("\n");
      const description = parseSteps(sanitizeWorkoutDescription(text, w.type)).length ? text : easySteps(stated, metric);
      const minutes2 = itemTotals({ ...w, description })?.minutes || stated;
      return { ...w, description, duration_minutes: minutes2, tss: stated > 0 ? Math.round((Number(w.tss) || 0) * minutes2 / stated) : w.tss };
    });
    const runs = list.filter((w) => !isNote(w) && Number(w.duration_minutes) > 0);
    const longestOf = (from) => from.reduce((best, w) => Number(w.duration_minutes) > Number(best?.duration_minutes || 0) ? w : best, null);
    const runsOnly = runs.filter((w) => /run/i.test(String(w.type || "Run")));
    const long = target && target.long_run_minutes > 0 ? longestOf(runsOnly.filter((w) => /\blong\b/i.test(String(w.title || "")))) || longestOf(runsOnly) : null;
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
    out[key] = settleRestNotes(list.filter((w) => !easy.includes(w) || kept.includes(w)));
    if (isUltraDistance(distance)) {
      for (const w of out[key]) if (!isNote(w) && Number(w.duration_minutes) > 120 && !/carbohydrate|\bfuel/i.test(String(w.description || ""))) w.description = `${String(w.description || "").replace(/\s+$/, "")}

Fuel: 60 to 90 g of carbohydrate an hour from the first hour, as on race day. Practise what you will carry.`;
    }
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
  // XC mountain bike: the cyclocross rule with the XCO race's own length and speed (UCI 80 to 100 min; 82 to 96 min and 14.4 km/h in
  // the race studies, Næss 2021, Granier 2018), a 3 h long ride for the longer race, and its sessions from the XCO evidence: surges of
  // 3 to 10 s at 130 to 140% MAP, 15 to 20 a lap (Protzen 2026 review), 4 to 6 min VO2 intervals beating sprints for race time
  // (Inoue 2016), a fast start in every race study. Weekly targets come out the same as cyclocross (Clive, 2026-11-10: yes to the mock)
  xc: { label: "XC mountain bike", raceType: "xc_mtb", eventHours: 1.5, speedKmh: 15, growth: 1.04, maxRatio: 1.4, taper: [0.7, 0.45], longTop: 3, longShare: 0, quality: 2, focus: "one VO2 session (4 to 6 x 3 to 5 minutes at 110 to 120%, or 30/15s) and one race session of repeated 5 to 30 second efforts at 130 to 200% with short recoveries, opened with a 2 to 3 minute fast start, with technical skills where possible", tempoShare: 0.08, hardPerHour: 3, minWeeks: 4 },
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
  // A race on the calendar with no planned load counts an estimate (Clive, 2026-11-11): the race's heart rate as a share of
  // max HR from the race studies, turned into an intensity factor through the athlete's own LTHR and max HR (race HR / LTHR),
  // TSS = hours x IF^2 x 100. With no HR in the profile, LTHR is taken as 90% of max HR. XC mountain bike 90% (Impellizzeri
  // 2002; Granier 2018 91%), cyclocross 94% (Carmichael 2017, cat 2/3, 40 min), time trial 80% (Padilla 2000, TTs over 30
  // min), criterium 85% (no criterium HR study: Padilla's short TTs and Nakagata 2019's amateur 4 h circuit race at 86%),
  // road race 78% (between Nakagata 2019 at 4 h and Neumayr 2002 at 10 h), gran fondo 77% (Neumayr 2002, Ötztaler, 14
  // amateurs), gravel 79% (proxy: Wirnitzer 2008, amateur MTB marathon stages; no gravel study exists)
  raceHrShare: { xc: 0.9, cx: 0.94, tt: 0.8, crit: 0.85, road: 0.78, fondo: 0.77, gravel: 0.79 },
  lthrShareOfMax: 0.9,
  // Race season: three or more B races inside the plan; the last week at 80%; the long ride (up to 2 h 30) only after a race of up to 1 h 30
  seasonMinRaces: 3,
  seasonFinal: 0.8,
  seasonLongTop: 2.5,
  seasonShortRaceHours: 1.5,
  // A season week's training target is the held load less the race, never under this share of it
  seasonTrainingFloor: 0.4,
  lookbackDays: 28
};
var TRAINING_MODELS = ["theme", "polarised", "pyramidal", "ronnestad", "singles"];
var trainingModelOf = (value) => TRAINING_MODELS.includes(value) ? value : "theme";
var SUB_THRESHOLD_ANCHOR = `Each sub-threshold session's work steps are 82 to 92% of FTP (an athlete with LT1 fields keeps the personalised Z2 rule on the endurance steps, as always). Write the heart-rate cap in the description: "HR cap: about 90% of LTHR (LT1 HR + 5 to 8 bpm when LT1 is known); end the interval if HR drifts over it." Put it at the end of the description, after one blank line below the last step.`;
var TRAINING_MODEL_PRESETS = {
  Ride: {
    theme: { snippets: ["Easy days easy"], strength: false, rules: "" },
    polarised: { snippets: ["Easy days easy"], strength: false, rules: `TRAINING MODEL: POLARISED. Every loading week holds exactly two hard sessions on non-consecutive days: one VO2 session (4 to 6 x 3 to 5 minutes at 110 to 120% with equal easy recoveries, or 2 to 3 sets of 13 x 30/15) and one threshold session (2 x 12 to 20 minutes at 95 to 100%, or the race's own shape in a race plan). A recovery week holds one shorter hard session. About 80% of each loading week's work time is easy (Z1 to Z2, under 75%), 8 to 17% at 76 to 105% (the threshold session and tempo blocks in the long ride) and the rest above 105%. This rule sets the sessions whatever the periodisation theme says: a Base theme shapes the load, not the hard sessions. Never two hard days in a row.` },
    pyramidal: {
      tempoShare: 0.22,
      hardPerHour: (event) => Math.min(event, 2.4),
      focus: "two or three controlled sub-threshold sessions (4 x 10 to 15, 6 x 12 or 2 x 30 minutes at 82 to 92% with 2 to 3 minutes easy between), the week's hard_minutes as a few short efforts of 30 seconds to 3 minutes above 105% inside one of them, in the event's own shape",
      snippets: ["Easy days easy", "Sub-threshold intervals"],
      strength: false,
      rules: `TRAINING MODEL: PYRAMIDAL / SUB-THRESHOLD (Norwegian style). Every loading week holds exactly two sub-threshold sessions, titled "Sub-threshold ...": 4 x 10 to 15, 6 x 12 or 2 x 30 minutes at 82 to 92% with 2 to 3 minutes easy between, on non-consecutive days; a recovery week holds one shorter one. About 70 to 75% of each loading week's work time is easy (Z1 to Z2, under 75%), 20 to 25% is that sub-threshold work, and 5% or less is above threshold. ${SUB_THRESHOLD_ANCHOR} The long ride stays easy, with no tempo blocks. Every session's "description" is its step lines (as in the step syntax), with the HR cap sentence as the last line after them, never instead of them.`
    },
    ronnestad: {
      tempoShare: 0.17,
      hardPerHour: (event) => Math.max(event, 2.5),
      focus: "one durability session (60 to 75 minutes at 75 to 85%, then 3 x 5 minutes at 105 to 110% or 13 x 30/15) and one VO2 session of 30/15s (3 sets of 13 x 30 seconds at 120% / 15 seconds at 50%, each set opening with 1.5 minutes at 120%, 3 minutes easy between sets)",
      snippets: ["R\xF8nnestad VO2", "Durability", "Fuelling", "VO2 Max Strength", "Easy days easy"],
      strength: true,
      rules: `TRAINING MODEL: R\xD8NNESTAD PRE-FATIGUED + STRENGTH (HRTLND). Each loading week holds one durability session (60 to 75 minutes at 75 to 85% on the turbo, or a 2 to 3 hour endurance ride outdoors, then straight into 3 x 5 minutes at 105 to 110% or 13 x 30/15) and one VO2 session of 30/15s with a fast start, as the plan rules describe; about 70% of the week's work time is easy, 15 to 20% is the pre-load at 75 to 85%, and the rest is above 105%. Two heavy strength sessions a week (type WeightTraining), never within 2 days before the VO2 session and 3 hours apart from any ride on the same day. Rides over 2 hours and durability sessions carry the fuelling line (90 to 100 g of carbohydrate an hour).`
    }
  },
  // Norwegian singles: the community guide at norwegiansingles.run (updated 30 September 2026), from Copeland's 2025 book.
  // The guide's own numbers: three sub-threshold sessions (about 10-, 6- and 3-minute reps, 90-120 / 60-90 / 60 s easy),
  // 10 min warm-up and 7-10 min cool-down, reps 20-25% of the week, below LT2, easy runs under about 70% of max HR, a
  // long easy run of about 1.7 easy runs, no VO2 block, no strides by default. Pace sets the reps and LTHR is only the
  // ceiling, so the reps are pace for every runner (power is optional in the guide); heart rate only without a threshold
  // pace. Ours: the pace bands are the Montis Library's Norwegian sessions, and a recovery week keeps the three sessions
  // with fewer reps. Under 6 days a week the Worker asks for two sessions (singlesFewDaysRule).
  Run: {
    theme: { snippets: [], strength: false, rules: "" },
    polarised: { snippets: [], strength: false, rules: `TRAINING MODEL: POLARISED. Every loading week holds exactly two hard runs on non-consecutive days: one VO2 session (5 x 3 minutes or 6 x 800 m at 3K to 5K pace with equal easy jogs) and one threshold session (2 x 15 to 20 minutes or 5 x 6 minutes at threshold pace). A recovery week holds one shorter hard run. About 80% of each loading week's running time is easy (under the first threshold), 8 to 17% at and just under threshold pace, the rest faster. This rule sets the sessions whatever the periodisation theme says: a Base theme shapes the load, not the hard runs. Never two hard days in a row.` },
    singles: {
      snippets: ["Norwegian singles", "Easy runs easy"],
      strength: false,
      rules: `TRAINING MODEL: NORWEGIAN SINGLES (sub-threshold running). Every loading week holds exactly three sub-threshold runs, titled "Sub-threshold ...", on non-consecutive days with an easy or rest day between: one of long reps of about 10 minutes with 90 to 120 seconds easy between, one of medium reps of about 6 minutes with 60 to 90 seconds easy between, and one of short reps of about 3 minutes with 60 seconds easy between (for example Tuesday long, Thursday medium, Saturday short). Each opens with about 10 minutes easy and ends with 7 to 10 minutes easy jogging; the breaks are walking or very slow jogging. The reps alone are 20 to 25% of each loading week's time and stay below the second threshold, never above it: long reps the slowest, short reps the quickest. Write every rep in pace, whatever the athlete's usual run target (heart rate or power): about 92 to 95% of threshold pace for long reps, 94 to 97.5% for medium and 96 to 100.5% for short ("Pace" after the %). Only an athlete with no threshold pace in priority_3_prescription writes the reps by heart rate, kept under LTHR. Write at the end of each sub-threshold run's description, after one blank line below the last step: "Stay below LTHR: early reps finish about 10 to 15 beats under it." Every other run is easy, under about 70% of max HR, with one longer easy run of about 1.7 times an ordinary easy run of that week (higher-volume examples reach about 95 to 105 minutes), never longer. Never lengthen the long run or the sub-threshold runs to fill the week's minutes: when the athlete's days cannot hold the week's minutes within these limits, write the week shorter. Each session's duration_minutes is the sum of its steps. No VO2max or faster work, no strides, no tempo in the long run. A recovery week keeps the three sessions with fewer reps.`
    }
  }
};
var trainingModelPreset = (model, sport = "Ride") => TRAINING_MODEL_PRESETS[sport][model] || TRAINING_MODEL_PRESETS[sport].theme;
function compressedPeakingGate(model, weeks) {
  if (model !== "ronnestad") return { ok: false, reason: "model" };
  if (!(weeks >= 8)) return { ok: false, reason: "weeks" };
  return { ok: true, reason: null };
}
var EASY_TOP_PCT2 = 75;
var MIN_RIDE_MINUTES = 45;
var round12 = (n) => Math.round(n * 10) / 10;
var toFive2 = (n) => Math.round(n / 5) * 5;
var eventRules = (event) => RIDE_RACE_RULES[event] || RIDE_RACE_RULES.road;
var rulesOf2 = (event, model) => {
  const R = eventRules(event);
  const P = trainingModelPreset(trainingModelOf(model));
  if (!P.tempoShare && !P.hardPerHour && !P.focus) return R;
  return { ...R, tempoShare: P.tempoShare ?? R.tempoShare, hardPerHour: P.hardPerHour ? P.hardPerHour(R.hardPerHour) : R.hardPerHour, focus: P.focus ?? R.focus };
};
function rideEventOf(race) {
  const name = String(race?.name || race?.title || "");
  if (/cyclo-?cross|\bcx\b|\bveldrit\b/i.test(name)) return "cx";
  if (/\bxcm\b|marathon\s?mtb|mtb\s?marathon|mountain\s?-?bike\s?marathon/i.test(name)) return "gravel";
  if (/\bxco\b|\bxcc\b|\bxc\b|\bmtb\b|mountain\s?-?bike/i.test(name)) return "xc";
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
  const intensity = (a) => {
    const v = Number(a?.icu_intensity);
    return !Number.isFinite(v) ? 0 : v <= 2 ? v * 100 : v;
  };
  return {
    tss: Math.round(load / weeks),
    hours: round12(seconds / 3600 / weeks),
    longestHours: round12(Math.max(...rides.map((a) => Number(a.moving_time) || 0)) / 3600),
    rides: rides.length,
    hardRides: rides.filter((a) => intensity(a) >= 85).length
  };
}
function rideLongTop(event, eventHours) {
  const R = rulesOf2(event);
  return R.longShare > 0 ? Math.min(R.longTop, Math.max(2, R.longShare * (Number(eventHours) || R.eventHours))) : R.longTop;
}
function rideRaceIntensity(event, hr) {
  const share = RIDE_RACE.raceHrShare[event];
  if (!share) return null;
  const lthr = Number(hr?.lthr), maxHr = Number(hr?.maxHr);
  const IF = lthr > 0 && maxHr > 0 && lthr <= maxHr ? share * maxHr / lthr : share / RIDE_RACE.lthrShareOfMax;
  return Math.round(IF * 1e3) / 1e3;
}
function rideRaceTssEstimate(event, hours, hr) {
  return rideRaceEstimateDetail(event, hours, hr)?.tss ?? null;
}
function rideRaceEstimateDetail(event, hours, hr) {
  const share = RIDE_RACE.raceHrShare[event];
  const IF = rideRaceIntensity(event, hr);
  if (!share || IF == null || !(Number(hours) > 0)) return null;
  const lthr = Number(hr?.lthr), maxHr = Number(hr?.maxHr);
  const anchored = lthr > 0 && maxHr > 0 && lthr <= maxHr;
  return { share, IF, hours: Number(hours), tss: Math.round(Number(hours) * IF * IF * 100), raceHr: anchored ? Math.round(share * maxHr) : null, lthr: anchored ? lthr : null, maxHr: anchored ? maxHr : null, fallback: !anchored };
}
var rideSeasonOn = (input) => input.season === true && (input.b_race_weeks || []).length >= RIDE_RACE.seasonMinRaces - 1;
var xcStrengthOn = (input) => input.event === "xc" && input.strength === true && trainingModelOf(input.model) !== "ronnestad";
function rideRaceWeekTargets(input, baseWeeks) {
  const G = RIDE_RACE;
  const R = rulesOf2(input.event, input.model);
  const N = Math.max(R.minWeeks, Math.round(Number(input.weeks) || 0));
  const S = Math.max(50, Number(input.start_tss) || 0);
  const H = Math.max(1, Number(input.start_hours) || 0);
  const days = Math.max(2, Math.min(7, Number(input.days) || 4));
  const lastDays = Math.round(Number(input.last_week_days) || 7);
  const peakWeek = N - R.taper.length;
  const ratio = Math.min(R.maxRatio, Math.pow(R.growth, peakWeek - 1));
  const peak = S * ratio;
  const bWeeks = (input.b_race_weeks || []).filter((w) => w >= 1 && w <= peakWeek);
  const seasonWeeks = (input.b_race_weeks || []).filter((w) => w >= 1 && w <= N);
  const season = rideSeasonOn(input);
  const targetWeek = baseWeeks?.find((b) => b.startStr && b.endStr && input.race_date && input.race_date >= b.startStr && input.race_date <= b.endStr)?.index ?? N;
  const longTop = rideLongTop(input.event, input.event_hours);
  const firstLighter = (e) => {
    for (let w = 3; w < peakWeek; w++) if ((peakWeek - w) % e === e - 1) return w;
    return peakWeek;
  };
  const every = firstLighter(G.lighterEvery) - 1 >= 4 ? 3 : G.lighterEvery;
  let longBest = Math.max(1, Number(input.longest_hours) || H * 0.35);
  const out = [];
  for (let w = 1; w <= N; w++) {
    let kind = "build";
    let tss;
    if (season) {
      kind = w === targetWeek ? "race_week" : seasonWeeks.includes(w) ? "season" : "build";
      const held = w === targetWeek ? S * G.seasonFinal : S;
      tss = kind === "build" ? held : Math.max(held * G.seasonTrainingFloor, held - (Number(input.race_tss) || 0));
    } else if (w > peakWeek) {
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
      else if (w >= 3 && (peakWeek - w) % every === every - 1) {
        tss *= G.lighter;
        kind = "lighter";
      }
    }
    const hours = H * Math.pow(tss / S, G.hoursPower);
    let longH;
    if (season) longH = kind === "race_week" ? 0 : kind === "season" ? Number(input.event_hours) <= G.seasonShortRaceHours ? Math.min(G.seasonLongTop, longBest) : 0 : Math.min(longTop, longBest);
    else if (w > peakWeek) longH = w === N ? 0 : Math.min(longTop, longBest) * (G.longTaper[w - peakWeek - 1] ?? G.longTaper[G.longTaper.length - 1]);
    else if (kind === "b_race") longH = 0;
    else if (kind === "b_recovery") longH = longBest * 0.5;
    else if (kind === "lighter") longH = longBest * G.longLighter;
    else {
      longH = Math.min(longTop, longBest * G.longUp);
      longBest = Math.max(longBest, longH);
    }
    longH = Math.min(longH, hours * G.longMaxShare);
    const quality = kind === "build" || kind === "peak" ? R.quality : kind === "b_race" ? 0 : 1;
    const loading = (kind === "build" || kind === "peak") && !season;
    const tempo = loading ? toFive2(hours * 60 * R.tempoShare) : kind === "lighter" || kind === "taper" || kind === "b_recovery" || kind === "season" ? toFive2(hours * 60 * R.tempoShare * 0.5) : 0;
    const hard = loading ? Math.round(hours * R.hardPerHour) : kind === "season" ? Math.round(hours * R.hardPerHour * 0.5) : kind === "lighter" || kind === "taper" || kind === "race_week" ? G.sharpMinutes : 0;
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
      training_frequency: Math.max(1, (w === N ? Math.min(days, 4, lastDays) : days) - (season && kind !== "build" ? 1 : 0)),
      ceiling: true,
      week_kind: kind,
      long_ride_minutes: toFive2(longH * 60),
      quality_sessions: quality,
      tempo_minutes: tempo,
      hard_minutes: hard,
      // In a race season about one every 10 days (two weeks in three), never in the last week
      strength_sessions: xcStrengthOn(input) && (season ? w !== targetWeek && w % 3 !== 0 : loading) ? 1 : 0
    });
  }
  return out;
}
function rideRacePromptRules(input) {
  const R = rulesOf2(input.event, input.model);
  const modelRules = trainingModelPreset(trainingModelOf(input.model)).rules;
  const long = R.longShare > 0;
  const dates = (input.b_race_dates || []).join(", ");
  const seasonOn = rideSeasonOn(input);
  const raceShare = Number(input.race_tss) > 0 ? ` The race (about ${Math.round(Number(input.race_tss))} TSS) is on the calendar, not in your answer, and sits on top of the week: target_tss, target_hours and training_frequency are the training alone, without the race.` : "";
  const bRule = !dates ? "" : seasonOn ? `
9. RACE SEASON: ${dates} are races on the calendar, and each is its week's race session: never write a race as a workout. In a race-season week write exactly one hard session, a VO2 session midweek (2 to 3 sets of 13 x 30/15, or 4 x 4 minutes at 110 to 120%), openers the day before the race (RIDE-OPEN-001 Race Openers from the library: 45 minutes easy with 3 x 1 minute at 120% and 3 short sprints), the long ride of long_ride_minutes the day after the race or on a free weekend day and never the day before a race, and everything else easy Z2. The week's load holds at target_tss: a season is for racing, not building.${raceShare}` : `
9. B RACES: ${dates} ${input.b_race_dates && input.b_race_dates.length > 1 ? "are races" : "is a race"} on the calendar. Never write a race as a workout, and write nothing hard in the 2 days before one or the day after it.${raceShare}`;
  const extra = long ? "\n8. LONG EVENT: the long ride practises fuelling (60 to 90 g of carbohydrate an hour)." : "";
  return `
RIDE ${R.label.toUpperCase()} PLAN (these rules outrank the load rules above where they differ):
Every week in 'WEEKS TO GENERATE' carries week_kind, long_ride_minutes, quality_sessions, tempo_minutes, hard_minutes, strength_sessions and race_date (the race in that week, or null). The code has set these. Follow them.
DAYS, REST, STRENGTH AND RACE LOAD (where any other rule differs, these sentences stand):
a. training_frequency in each week is the number of rides to write that week${dates ? ", already one fewer in a week with a race" : ""}. Write exactly that many: the hard sessions of rule 2, the long ride when long_ride_minutes is above 0${dates ? ", the openers on the day before race_date (race_date minus one day, never on race_date itself)" : ""}, and easy rides for the rest.${dates ? " Openers are one of the rides." : ""} Never more, never fewer.
b. Every other day of the week${dates ? ", except a race day," : ""} is a rest day: one note ("category": "NOTE", "type": "Other", "title": "Rest day", 0 minutes, 0 tss) and nothing else on it. With 4 or more rides, never two rest days in a row.${dates ? `
c. race_date is the race, already on the calendar: write nothing dated race_date, not a ride and not a note. target_tss, target_hours and training_frequency are the training alone; the race's load is on top of them and already left out. The week's entries sum to target_tss (within 3%) and target_duration_minutes (within 5%), never to starting_tss.` : ""}${xcStrengthOn(input) ? `
d. In a week whose strength_sessions is 1, write one heavy whole-body strength session ("type": "WeightTraining", 40 to 50 minutes: squat, deadlift, hip hinge, trunk; sets x reps at RPE, never a weight) as the second entry on the date of an easy ride: never alone on a day, never on a rest day, a race day, the long-ride day or a hard-session day; never the day before a hard session or the long ride; dated race_date minus 3 days or earlier (race_date minus 1 and race_date minus 2 are out). Place the hard session and the easy ride so that such a day exists: the hard session on race_date minus 4, the easy ride with the strength session on race_date minus 3, rest notes on race_date minus 5 and race_date minus 2, the openers on race_date minus 1, the long ride on race_date plus 1. The strength session is not one of the training_frequency rides; its minutes and tss count toward the week's targets. In a week whose strength_sessions is 0, write none.` : ""}
e. ${dates ? "The race and the hard sessions are the week's hard days" : "The hard sessions are the week's hard days"}; never two hard days in a row.${dates ? " The long ride is on race_date plus 1 (or the free weekend day when that is a day off), never on race_date minus 1." : ""}
1. LONG RIDE: when long_ride_minutes is above 0, write one long ride of exactly that length on the weekend, ${trainingModelOf(input.model) === "pyramidal" ? "Z2 (56 to 75%) throughout: the week's tempo_minutes go into the sub-threshold sessions, never the long ride" : "Z2 (56 to 75%) apart from the tempo blocks of rule 3"}. Never make it longer, and never move the week's spare minutes into it.
2. HARD SESSIONS: write exactly quality_sessions hard sessions that week. In a build or peak week: ${R.focus}. In a lighter, taper or race week the one hard session is short and sharp: RIDE-SHARP-001 Race Week Sharpener from the library (3 x 3 minutes at 105 to 110% with 3 minutes easy between; never VO2 Intro), in race week two or three days before the race. Openers are extra to it.${seasonOn ? ' In a race-season week ("week_kind": "season") the one hard session is the VO2 session of rule 9.' : ""}
3. TEMPO AND HARD MINUTES: tempo_minutes is the week's work time at 76 to 105% and hard_minutes its work time above 105%, counting work steps only (not warm-ups, recoveries, cool-downs or openers). Write those amounts, within 5 minutes: the hard minutes in the hard sessions, the tempo minutes in the hard sessions and as blocks of 10 to 20 minutes in the long ride's second half.
   Everything else is Z2 (60 to 75%) or Z1 recovery. Never two hard days in a row: an easy ride or rest day between the hard sessions and the long ride.
4. RIDES: every ride session is "type": "Ride". A rest day is a note (category NOTE), never a workout.
   STEPS: every step line starts with "- " and holds a time written like 40m, 1h30m or 90s, never in words such as "40 minutes", and a % target. Repeats use a header line such as "4x" with a blank line before and after. A session with no such step lines is wrong.
5. PROGRESS: never copy a week. Each loading week must differ from the same week of the block before it, in reps, rep length or target.
6. RACE WEEK: the race itself is on the calendar and is never written as a workout. Openers the day before: RIDE-OPEN-001 Race Openers from the library (45 minutes).
7. TAPER: in a taper week keep the same number of rides, shorter, with the one short hard session.${extra}${bRule}${modelRules ? `
10. ${modelRules}` : ""}${input.peaking === "compressed" ? `
11. COMPRESSED PEAKING: the last 11 days before the race are written by the code (6 daily 30/15 sessions, then a 5-day step taper, R\xF8nnestad 2019). For those days write only easy Z2 rides of 45 to 60 minutes, no hard session, no strength from 10 days out. The code replaces them.` : ""}
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
function compressedPeakingDays(raceDate) {
  const day = (n) => {
    const d = /* @__PURE__ */ new Date(raceDate + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const set = "- 1m30s 120%\n\n13x\n- 30s 120%\n- 15s 50%\n\n- 3m 50%";
  const hit = `- Warmup 15m 55%

${set}

${set}

${set}

- Cooldown 10m 50%
Ride the three sets at the highest power you can hold across all three (R\xF8nnestad 2019). Fuel: 90 to 100 g of carbohydrate an hour.`;
  const out = /* @__PURE__ */ new Map();
  const item = (title, description, minutes, tss, category = "WORKOUT") => ({ title, description, duration_minutes: minutes, tss, type: category === "NOTE" ? "Other" : "Ride", category });
  for (let n = 10; n >= 5; n--) out.set(day(n), item(`Compressed peaking: 30/15s, day ${11 - n} of 6`, hit, 64, 95));
  out.set(day(4), item("Easy ride", "- 60m 62%\nThe HIT block is done: easy only from here to the race.", 60, 40));
  out.set(day(3), item("Rest day", "Complete rest (R\xF8nnestad 2019: the second day after the block).", 0, 0, "NOTE"));
  out.set(day(2), item("Easy spin", "- 30m 60%", 30, 18));
  out.set(day(1), item("Openers", "- Warmup 20m 60%\n\n2x\n- 5m 85%\n- 3m 50%\n\n- 1m 100%\n- 2m 50%\n- 1m 110%\n- 2m 50%\n- 1m 120%\n- Cooldown 5m 50%", 50, 45));
  return out;
}
function durabilitySteps() {
  return "- Warmup 10m 55%\n- 60m 78%\n\n3x\n- 5m 108%\n- 3m 50%\n\n- Cooldown 10m 50%";
}
var HR_CAP_LINE = "HR cap: about 90% of LTHR (LT1 HR + 5 to 8 bpm when LT1 is known); end the interval if HR drifts over it.";
function aboveSeconds(description) {
  let s = 0;
  for (const step of parseSteps(description)) if ((step.pct ?? 0) > 105) s += step.seconds * (step.inRepeat ? step.repeats : 1);
  return s;
}
function subThresholdSeconds(description) {
  let s = 0;
  for (const step of parseSteps(description)) {
    const pct = step.pct ?? 0;
    if (pct >= 82 && pct <= 95) s += step.seconds * (step.inRepeat ? step.repeats : 1);
  }
  return s;
}
function isDurability(description) {
  let pre = 0, hard = 0;
  for (const step of parseSteps(description)) {
    const seconds = step.seconds * (step.inRepeat ? step.repeats : 1);
    const pct = step.pct ?? 0;
    if (pct >= 65 && pct <= 85) pre += seconds;
    else if (pct >= 95) hard += seconds;
  }
  return pre >= 45 * 60 && hard >= 10 * 60;
}
function shortReps(description) {
  let n = 0;
  for (const step of parseSteps(description)) if ((step.pct ?? 0) > 105 && step.seconds <= 45) n += step.inRepeat ? step.repeats : 1;
  return n;
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
function reconcileRideRaceWeeks(weeks, targets, bRaceDates = [], raceDate = "", model, peaking, crossSports = [], offDates = []) {
  const preset = trainingModelOf(model);
  const peakingDays = peaking === "compressed" && preset === "ronnestad" && raceDate ? compressedPeakingDays(raceDate) : null;
  const out = {};
  const isNote = (w) => String(w?.category || "").toUpperCase() === "NOTE";
  const isCross = (w) => crossSports.some((t) => t.toLowerCase() === String(w?.type || "").trim().toLowerCase());
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
      if (!isRide(w)) {
        if (isCross(w) && !parseSteps(String(w?.description || "")).length && Number(w?.duration_minutes) > 0) {
          const description2 = crossEasySteps(Number(w.duration_minutes));
          const totals2 = itemTotals({ ...w, description: description2 });
          return { ...w, description: description2, duration_minutes: totals2?.minutes || Number(w.duration_minutes), tss: totals2?.tss || w.tss };
        }
        return parseSteps(String(w?.description || "")).some((st) => Number(st?.seconds) > 0) || /weight|strength|yoga|core|mobility/i.test(String(w?.type || "")) ? w : { ...w, category: "NOTE", duration_minutes: 0, tss: 0 };
      }
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
    const crossMinutes = list.filter((w) => !isNote(w) && isCross(w)).reduce((sum, w) => sum + Number(w.duration_minutes), 0);
    const longestOf = (from) => from.reduce((best, w) => Number(w.duration_minutes) > Number(best?.duration_minutes || 0) ? w : best, null);
    if (preset === "ronnestad" && target && (target.week_kind === "build" || target.week_kind === "peak")) {
      const vo2 = rides.filter((w) => shortReps(w.description) >= 20);
      if (!rides.some((w) => isDurability(w.description))) {
        const isVo2 = (w) => vo2.includes(w) || aboveSeconds(w.description) >= 6 * 60;
        const vo2Count = rides.filter(isVo2).length;
        const host = rides.filter((w) => !isVo2(w) && hasHardSet(w.description)).sort((x, y) => Number(y.duration_minutes) - Number(x.duration_minutes))[0] || (vo2Count >= 2 ? rides.filter(isVo2).sort((x, y) => Number(x.duration_minutes) - Number(y.duration_minutes))[0] : null) || rides.filter((w) => !isVo2(w) && w !== longestOf(rides) && Number(w.duration_minutes) >= 60).sort((x, y) => Number(y.duration_minutes) - Number(x.duration_minutes))[0];
        if (host) {
          host.description = durabilitySteps();
          host.title = "Durability: 60 min at 78% then 3 x 5 min";
          const totals = itemTotals(host);
          host.duration_minutes = totals?.minutes || host.duration_minutes;
          host.tss = totals?.tss || host.tss;
        }
      }
    }
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
    const others = rides.reduce((sum, w) => sum + (easy.includes(w) ? 0 : Number(w.duration_minutes)), 0) + crossMinutes;
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
      const total = rides.filter((w) => !easy.includes(w) || kept.includes(w)).reduce((sum, w) => sum + Number(w.duration_minutes), 0) + crossMinutes;
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
    out[key] = settleRestNotes(list.filter((w) => !easy.includes(w) || kept.includes(w)));
    const peakingWeek = !!peakingDays && out[key].some((w) => peakingDays.has(String(w?.date || "").slice(0, 10)));
    if (peakingWeek) {
      for (const w of out[key]) if (!isNote(w) && isRide(w) && !peakingDays.has(String(w.date || "").slice(0, 10)) && Number(w.duration_minutes) > 90) {
        const fitted = fitToMinutes(w.description, 90) || easySteps2(90);
        w.description = fitted;
        w.title = /easy|endurance|z2|recovery/i.test(String(w.title || "")) ? w.title : "Easy ride";
        const totals = itemTotals(w);
        w.duration_minutes = totals?.minutes || 90;
        w.tss = totals?.tss || w.tss;
      }
    }
    if (!peakingWeek && target && target.hard_minutes > 0 && ["lighter", "taper", "race_week"].includes(target.week_kind) && !out[key].some((w) => !isNote(w) && isRide(w) && hasHardSet(w.description))) {
      const host = kept.filter((w) => Number(w.duration_minutes) >= 50 && (!raceDate || !w.date || daysApart(String(w.date).slice(0, 10), raceDate) >= 2)).sort((x, y) => Number(y.duration_minutes) - Number(x.duration_minutes))[0];
      if (host) {
        host.description = sharpSteps(Number(host.duration_minutes));
        host.title = "Short sharp efforts";
        const totals = itemTotals(host);
        host.duration_minutes = totals?.minutes || host.duration_minutes;
        host.tss = totals?.tss || host.tss;
      }
    }
    if (peakingDays) {
      const inWindow = (w) => peakingDays.has(String(w?.date || "").slice(0, 10));
      const kept2 = out[key].filter((w) => !inWindow(w) && !(isNote(w) && inWindow(w)));
      const written = out[key].filter((w) => inWindow(w)).map((w) => String(w.date).slice(0, 10));
      const days = [...peakingDays.entries()].filter(([date]) => written.includes(date) || target && target.startStr && target.endStr && date >= target.startStr && date <= target.endStr);
      for (const [date, item] of days) kept2.push({ ...item, date, category: item.category || "WORKOUT", type: item.type || "Ride" });
      out[key] = settleRestNotes(kept2.sort((x, y) => String(x.date || "").localeCompare(String(y.date || ""))));
    }
    const weekRides = out[key].filter((w) => !isNote(w) && isRide(w) && Number(w.duration_minutes) > 0);
    const loading = !!target && (target.week_kind === "build" || target.week_kind === "peak");
    if (preset === "ronnestad" && loading) {
      for (const w of weekRides) if ((Number(w.duration_minutes) > 120 || isDurability(w.description)) && !/carboh|\bfuel/i.test(String(w.description || ""))) w.description = `${String(w.description || "").trimEnd()}

Fuel: 90 to 100 g of carbohydrate an hour.`;
    }
    if (preset === "pyramidal" && loading) {
      const sub = weekRides.filter((w) => subThresholdSeconds(w.description) >= 20 * 60).sort((x, y) => subThresholdSeconds(y.description) - subThresholdSeconds(x.description));
      for (const w of sub) if (!/HR cap|LTHR/i.test(String(w.description || ""))) w.description = `${String(w.description || "").trimEnd()}

${HR_CAP_LINE}`;
      const weeksOut = targets.length - target.index;
      const above = weekRides.reduce((s, w) => s + aboveSeconds(w.description), 0);
      if (sub[0] && weeksOut <= 6 && target.hard_minutes >= 6 && above < target.hard_minutes * 60 * 0.5) {
        const reps = Math.max(3, Math.min(8, Math.round(target.hard_minutes / 2)));
        const efforts = `
${reps}x
- 2m 112%
- 2m 50%
`;
        const lines = String(sub[0].description || "").split("\n");
        const cool = lines.findIndex((l) => /^\s*-\s*cool/i.test(l));
        sub[0].description = cool >= 0 ? [...lines.slice(0, cool), efforts, ...lines.slice(cool)].join("\n") : `${lines.join("\n").trimEnd()}
${efforts}`;
        sub[0].title = /short efforts/i.test(String(sub[0].title || "")) ? sub[0].title : `${sub[0].title || "Sub-threshold"} + short efforts`;
        const totals = itemTotals(sub[0]);
        sub[0].duration_minutes = totals?.minutes || sub[0].duration_minutes;
        sub[0].tss = totals?.tss || sub[0].tss;
      }
    }
  }
  const addDay = (iso, n) => new Date((/* @__PURE__ */ new Date(iso + "T12:00:00Z")).getTime() + n * 864e5).toISOString().slice(0, 10);
  const dayOfItem = (w) => String(w?.date || w?.scheduled_date || w?.start_date_local || "").slice(0, 10);
  const isStrength = (w) => /weight|strength/i.test(String(w?.type || ""));
  for (const target of targets) {
    if (!(Number(target.strength_sessions) > 0)) continue;
    const key = String(target.index);
    const start = target.startStr, end = target.endStr;
    if (!start || !end || !out[key]) continue;
    const items = out[key];
    const race = [...bRaceDates, raceDate].find((d) => d && d >= start && d <= end) || "";
    const rides = items.filter((w) => !isNote(w) && isRide(w) && Number(w.duration_minutes) > 0);
    if (!rides.length) continue;
    const longRide = rides.reduce((b, w) => Number(w.duration_minutes) > Number(b.duration_minutes) ? w : b, rides[0]);
    const longDay = dayOfItem(longRide);
    const hardDays = new Set(rides.filter((w) => w !== longRide && hasHardSet(String(w.description || ""))).map(dayOfItem));
    const tooLate = (d) => !!race && daysApart(d, race) >= 0 && daysApart(d, race) <= 2;
    const bad = (d) => offDates.includes(d) || d === race || d === longDay || hardDays.has(d) || hardDays.has(addDay(d, 1)) || addDay(d, 1) === longDay || tooLate(d);
    const easyRides = rides.filter((w) => w !== longRide && !hardDays.has(dayOfItem(w)) && !/opener|activation|shake|prime/i.test(String(w.title || "")));
    const strength = items.find(isStrength);
    const current = strength ? dayOfItem(strength) : "";
    if (current && !bad(current) && easyRides.some((w) => dayOfItem(w) === current)) continue;
    let day = easyRides.map(dayOfItem).filter((d) => !bad(d)).sort().pop() || "";
    if (!day && easyRides.length) {
      const occupied = new Set(rides.map(dayOfItem));
      const free = [];
      for (let d = start; d <= end; d = addDay(d, 1)) if (!occupied.has(d) && !bad(d)) free.push(d);
      const want = race ? addDay(race, -3) : "";
      const to = free.includes(want) ? want : free.sort().pop() || "";
      if (to) {
        easyRides[easyRides.length - 1].date = to;
        out[key] = items.filter((w) => !(isNote(w) && dayOfItem(w) === to));
        day = to;
      }
    }
    if (!day) continue;
    if (strength) strength.date = day;
    else out[key].push({ title: "Whole-body XC strength", type: "WeightTraining", description: "- Squat 4x5 @ RPE 8\n- Deadlift 3x5 @ RPE 8\n- Hip hinge 3x8 @ RPE 7\n- Trunk 3x45s", duration_minutes: 45, tss: 30, date: day });
  }
  for (const target of targets) {
    const key = String(target.index);
    const start = target.startStr, end = target.endStr;
    if (!start || !end || !out[key]) continue;
    const workoutDays = new Set(out[key].filter((w) => String(w?.category || "").toUpperCase() !== "NOTE").map(dayOfItem));
    out[key] = out[key].filter((w) => !(String(w?.category || "").toUpperCase() === "NOTE" && /rest|day off/i.test(String(w?.title || "")) && workoutDays.has(dayOfItem(w))));
    const taken = new Set(out[key].map(dayOfItem));
    for (let d = start; d <= end; d = addDay(d, 1)) {
      if (taken.has(d) || bRaceDates.includes(d) || d === raceDate || offDates.includes(d)) continue;
      out[key].push({ title: "Rest day", type: "Other", category: "NOTE", description: "Rest day", duration_minutes: 0, tss: 0, date: d });
    }
    out[key].sort((a, b) => dayOfItem(a).localeCompare(dayOfItem(b)));
  }
  return out;
}

// src/lib/skiRacePlan.ts
var SKI_RACE_RULES = {
  // growth 4%, maxRatio 1.4: extrapolated, Ride crit/road. lowBase 3 h: observed, P15 survey mean 3.0 h for 10 km; up to 1.6: convention.
  // taper 2 weeks at 90/70%: observed elite, S01 (−4% then −15%), S02 (91% then 75%). longTop 1 h 30: observed, S02 average LIT 2.0 h; the cap is convention.
  // minWeeks 4: extrapolated, Ride crit/road
  "10k": { label: "10 km", raceType: "ski_10k", km: 10, eventHours: 0.6, speedKmh: 17, growth: 1.04, maxRatio: 1.4, lowBaseHours: 3, lowBaseRatio: 1.6, taper: [0.9, 0.7], longTop: 1.5, longShare: 0, quality: 2, raceEffort: null, doublePoling: false, minWeeks: 4 },
  // As 10 km; lowBase as 10 km (the survey has no 15 km figure). longTop 2 h: observed, S02 LIT sessions 90 to 150 min most common
  "15k": { label: "15 km", raceType: "ski_15k", km: 15, eventHours: 0.9, speedKmh: 17, growth: 1.04, maxRatio: 1.4, lowBaseHours: 3, lowBaseRatio: 1.6, taper: [0.9, 0.7], longTop: 2, longShare: 0, quality: 2, raceEffort: null, doublePoling: false, minWeeks: 4 },
  // growth 5%: extrapolated, Ride gran fondo. maxRatio 1.5: extrapolated, Ride road. lowBase 3.5 h: observed, P15 survey mean 3.7 h for 30 km; up to 1.8: convention.
  // taper 85/65%: convention, between the elite taper and Ride 70/45. longTop 2 h 30: observed, P4/P5/P7 2 to 3 h, S02 sessions of 150 min or more 1.6 to 1.8 a week.
  // minWeeks 4: extrapolated, Ride road
  "30k": { label: "30 km", raceType: "ski_30k", km: 30, eventHours: 1.8, speedKmh: 17, growth: 1.05, maxRatio: 1.5, lowBaseHours: 3.5, lowBaseRatio: 1.8, taper: [0.85, 0.65], longTop: 2.5, longShare: 0, quality: 2, raceEffort: null, doublePoling: false, minWeeks: 4 },
  // growth 5%: observed, P1 rises about 4.2% a week compound over 12 weeks. maxRatio 1.6: observed, P1 ×1.64, P7 ProSport ×1.7. lowBase 5 h: observed, P15 survey
  // 4.1 to 4.7 h, S20 cohort about 6 h, P6 5 to 7 h for a 4 to 5 h finish; up to 2.0: convention. Peak 3 weeks out: observed plans, P1 3-week taper, P2 "2 to 3 weeks".
  // taper 80/60/40%: convention, P6 −30 to 40% over 10 days, P1 about 45% of its biggest week. longTop 3 h: observed plans, P1 3 h, P4 3 h, P8 N2 3 h.
  // raceEffort 15 to 30 min from 8 weeks out: observed, S04 progressive sessions, P6 15 to 20 min race pace in the long ski, P1 3 x 15 min.
  // doublePoling block: trial, S17 (+4% late-race double poling after 6 weeks of 2 sessions a week), S18; observed P1, P8. minWeeks 6: extrapolated, Ride gran fondo.
  // eventHours 2.9: observed, S24 Engadin 42 km men 2:54
  marathon: { label: "42 to 50 km", raceType: "ski_marathon", km: 45, eventHours: 2.9, speedKmh: 15, growth: 1.05, maxRatio: 1.6, lowBaseHours: 5, lowBaseRatio: 2, taper: [0.8, 0.6, 0.4], longTop: 3, longShare: 0, quality: 2, raceEffort: [15, 30], doublePoling: true, minWeeks: 6 },
  // growth 5%, maxRatio 1.7: extrapolated, Ride gravel (silent in ski research). lowBase 5 h: observed, P15 90 km finishers average 4.7 h a week, S20 about 6 h.
  // Peak 3 weeks out and taper 80/60/40%: convention, as 42 to 50 km (P1). longTop 60% of the expected finish time, up to 4 h: observed, P8 N3 3.5 to 4 h,
  // P6 4 to 5 h, elite 3 to 5 h double poling (S04); the 60% share is extrapolated from Ride gravel. raceEffort 30 to 60 min in double poling from 8 weeks out:
  // observed, S04 (1 h MIT + 2 h LIT + 30 to 40 min HIT). doublePoling block as 42 to 50 km. minWeeks 8: extrapolated, Ride gravel.
  // eventHours 5.6 (90 km at 16 km/h): observed, S24 Vasaloppet modal finish men 5 to 6 h
  long: { label: "90 km", raceType: "ski_long", km: 90, eventHours: 5.6, speedKmh: 16, growth: 1.05, maxRatio: 1.7, lowBaseHours: 5, lowBaseRatio: 2, taper: [0.8, 0.6, 0.4], longTop: 4, longShare: 0.6, quality: 2, raceEffort: [30, 60], doublePoling: true, minWeeks: 8 }
};
var SKI_RACE = {
  // Race season, as Ride (Clive, 2026-11-11): three or more races inside the plan; the load held at the start, the last week at 80%;
  // the long session the day after a race of up to 1 h 30, none after a longer one
  seasonMinRaces: 3,
  seasonFinal: 0.8,
  seasonShortRaceHours: 1.5,
  seasonTrainingFloor: 0.4,
  // Lighter week every 4th at 70%: convention from Ride; observed range S04 "every 3 to 4 weeks", P1 every 4th at 45 to 55%
  lighterEvery: 4,
  lighter: 0.7,
  // Hours follow load at this power, the long session's weekly rise and its share in a lighter week, and its ceiling as a share of the week: as Ride
  hoursPower: 0.9,
  longUp: 1.12,
  longLighter: 0.7,
  longMaxShare: 0.6,
  longTaper: [0.6, 0.45],
  // Hard sessions kept in a lighter week (as Ride), and in a taper or race week (observed elite: S01 HIT 2 to 3 a week in peaking, 10 of 11 within 48 h; S02 Table 5)
  lighterQuality: 1,
  taperQuality: 2,
  // Strength: 2 a week in loading weeks, 1 in the last 4 weeks (trial S14, S15, S16; observed S01 2 to 3 a week in preparation then 1, S04 2 then 1, P1/P5/P6/P8 1 to 2)
  strengthLoading: 2,
  strengthLastWeeks: 4,
  strengthLate: 1,
  // The double-poling endurance block: 2 sessions a week in the 6 weeks before the taper (trial S17: 6 weeks, 2 a week)
  doublePolingWeeks: 6,
  doublePolingSessions: 2,
  // Race-effort work starts this many weeks out (observed: S04, P6, P1)
  raceEffortFromWeeksOut: 8,
  bRace: { before: 0.9, week: 0.75, after: 0.8 },
  // The baseline window, as Ride's
  lookbackDays: 28
};
var skiSeasonOn = (input) => input.season === true && (input.b_race_weeks || []).length >= SKI_RACE.seasonMinRaces - 1;
var EASY_TOP_PCT3 = 75;
var MIN_SESSION_MINUTES = 45;
var round13 = (n) => Math.round(n * 10) / 10;
var toFive3 = (n) => Math.round(n / 5) * 5;
var rulesOf3 = (distance) => SKI_RACE_RULES[distance] || SKI_RACE_RULES.marathon;
var SKI_TYPE = /^(NordicSki|RollerSki|VirtualSki|AlpineSki)$/i;
function skiDistanceOf(race) {
  const name = String(race?.name || race?.title || "");
  if (/vasaloppet|vasalopp|marcialonga|tartu|\böppet sp[åa]r\b/i.test(name)) return "long";
  if (/birkebeiner|birken|birkie|engadin|k[öo]nig[- ]?ludwig|finlandia|jizersk|dolomitenlauf|holmenkollen/i.test(name)) return "marathon";
  const km = Number(race?.distance || race?.distance_target || 0) / 1e3;
  if (!(km > 0)) return null;
  if (km >= 9 && km <= 11) return "10k";
  if (km >= 13 && km <= 17) return "15k";
  if (km >= 25 && km <= 35) return "30k";
  if (km >= 40 && km <= 56) return "marathon";
  if (km >= 60 && km <= 100) return "long";
  return null;
}
function skiEventHours(race, distance) {
  const seconds = Number(race?.moving_time || 0);
  if (seconds > 0) return round13(seconds / 3600);
  const metres = Number(race?.distance || race?.distance_target || 0);
  if (metres > 0) return round13(metres / 1e3 / (distance ? rulesOf3(distance).speedKmh : 16));
  return distance ? rulesOf3(distance).eventHours : null;
}
function skiBaselineFromActivities(activities, today = /* @__PURE__ */ new Date()) {
  const from = today.getTime() - SKI_RACE.lookbackDays * 864e5;
  const seen = /* @__PURE__ */ new Set();
  const sessions = (Array.isArray(activities) ? activities : []).filter((a) => {
    const when = new Date(String(a?.start_date_local || "")).getTime();
    if (!SKI_TYPE.test(String(a?.type || "").trim()) || !(Number(a?.moving_time) > 0) || !(when >= from && when <= today.getTime())) return false;
    const key = `${a.start_date_local}|${Math.round(Number(a.distance) || 0)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!sessions.length) return null;
  const weeks = SKI_RACE.lookbackDays / 7;
  const seconds = sessions.reduce((s, a) => s + Number(a.moving_time), 0);
  const load = sessions.reduce((s, a) => s + (Number(a.icu_training_load) || 0), 0);
  if (!(load > 0)) return null;
  return {
    tss: Math.round(load / weeks),
    hours: round13(seconds / 3600 / weeks),
    longestHours: round13(Math.max(...sessions.map((a) => Number(a.moving_time) || 0)) / 3600),
    sessions: sessions.length
  };
}
function skiLongTop(distance, eventHours) {
  const R = rulesOf3(distance);
  return R.longShare > 0 ? Math.min(R.longTop, Math.max(2, R.longShare * (Number(eventHours) || R.eventHours))) : R.longTop;
}
function skiRaceWeekTargets(input, baseWeeks) {
  const G = SKI_RACE;
  const R = rulesOf3(input.distance);
  const N = Math.max(R.minWeeks, Math.round(Number(input.weeks) || 0));
  const S = Math.max(50, Number(input.start_tss) || 0);
  const H = Math.max(1, Number(input.start_hours) || 0);
  const days = Math.max(2, Math.min(7, Number(input.days) || 4));
  const lastDays = Math.round(Number(input.last_week_days) || 7);
  const strengthOn = input.strength !== false;
  const doublePolingOn = input.double_poling !== false && R.doublePoling;
  const peakWeek = N - R.taper.length;
  const normal = Math.min(R.maxRatio, Math.pow(R.growth, peakWeek - 1));
  const needed = Math.pow(R.lowBaseHours / H, 1 / G.hoursPower);
  const ratio = H < R.lowBaseHours && needed > normal ? Math.max(normal, Math.min(needed, R.lowBaseRatio, Math.pow(R.growth, peakWeek - 1))) : normal;
  const peak = S * ratio;
  const bWeeks = (input.b_race_weeks || []).filter((w) => w >= 1 && w <= peakWeek);
  const seasonWeeks = (input.b_race_weeks || []).filter((w) => w >= 1 && w <= N);
  const season = skiSeasonOn(input);
  const targetWeek = baseWeeks?.find((b) => b.startStr && b.endStr && input.race_date && input.race_date >= b.startStr && input.race_date <= b.endStr)?.index ?? N;
  const longTop = skiLongTop(input.distance, input.event_hours);
  const firstLighter = (e) => {
    for (let w = 3; w < peakWeek; w++) if ((peakWeek - w) % e === e - 1) return w;
    return peakWeek;
  };
  const every = firstLighter(G.lighterEvery) - 1 >= 4 ? 3 : G.lighterEvery;
  let longBest = Math.max(1, Number(input.longest_hours) || H * 0.35);
  const out = [];
  for (let w = 1; w <= N; w++) {
    let kind = "build";
    let tss;
    if (season) {
      kind = w === targetWeek ? "race_week" : seasonWeeks.includes(w) ? "season" : "build";
      const held = w === targetWeek ? S * G.seasonFinal : S;
      tss = kind === "build" ? held : Math.max(held * G.seasonTrainingFloor, held - (Number(input.race_tss) || 0));
    } else if (w > peakWeek) {
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
      else if (w >= 3 && (peakWeek - w) % every === every - 1) {
        tss *= G.lighter;
        kind = "lighter";
      }
    }
    const hours = H * Math.pow(tss / S, G.hoursPower);
    let longH;
    if (season) longH = kind === "race_week" ? 0 : kind === "season" ? Number(input.event_hours) <= G.seasonShortRaceHours ? Math.min(longTop, longBest) : 0 : Math.min(longTop, longBest);
    else if (w > peakWeek) longH = w === N ? 0 : Math.min(longTop, longBest) * (G.longTaper[w - peakWeek - 1] ?? G.longTaper[G.longTaper.length - 1]);
    else if (kind === "b_race") longH = 0;
    else if (kind === "b_recovery") longH = longBest * 0.5;
    else if (kind === "lighter") longH = longBest * G.longLighter;
    else {
      longH = Math.min(longTop, longBest * G.longUp);
      longBest = Math.max(longBest, longH);
    }
    longH = Math.min(longH, hours * G.longMaxShare);
    const loading = (kind === "build" || kind === "peak") && !season;
    const quality = loading ? R.quality : kind === "b_race" ? 0 : kind === "season" || kind === "build" ? 1 : kind === "lighter" || kind === "b_recovery" ? G.lighterQuality : G.taperQuality;
    const weeksOut = N - w;
    let raceEffort = 0;
    if (R.raceEffort && loading && weeksOut <= G.raceEffortFromWeeksOut && longH > 0) {
      const firstWeek = Math.max(1, N - G.raceEffortFromWeeksOut);
      const share2 = peakWeek > firstWeek ? (w - firstWeek) / (peakWeek - firstWeek) : 1;
      raceEffort = toFive3(R.raceEffort[0] + (R.raceEffort[1] - R.raceEffort[0]) * Math.max(0, Math.min(1, share2)));
    }
    const strength = !strengthOn ? 0 : weeksOut < G.strengthLastWeeks ? G.strengthLate : loading ? G.strengthLoading : kind === "b_race" ? 0 : G.strengthLate;
    const doublePoling = doublePolingOn && !season && w <= peakWeek && w > peakWeek - G.doublePolingWeeks && kind !== "b_race" ? G.doublePolingSessions : 0;
    const base = baseWeeks?.find((b) => b.index === w) || baseWeeks?.[w - 1] || {};
    const share = w === N && lastDays >= 1 && lastDays < 7 ? lastDays / 7 : 1;
    const weekHours = round13(hours * share);
    out.push({
      index: w,
      startStr: base.startStr,
      endStr: base.endStr,
      startLabel: base.startLabel,
      endLabel: base.endLabel,
      phase: loading ? "load" : "recovery",
      target_tss: Math.round(tss * share),
      target_hours: weekHours,
      target_duration_minutes: Math.round(weekHours * 60),
      training_frequency: Math.max(1, (w === N ? Math.min(days, 4, lastDays) : days) - (season && kind !== "build" ? 1 : 0)),
      ceiling: true,
      week_kind: kind,
      long_session_minutes: toFive3(longH * 60),
      quality_sessions: quality,
      race_effort_minutes: raceEffort,
      strength_sessions: strength,
      double_poling_sessions: doublePoling
    });
  }
  return out;
}
function skiRacePromptRules(input) {
  const R = rulesOf3(input.distance);
  const model = trainingModelOf(input.model);
  const dates = (input.b_race_dates || []).join(", ");
  const raceShare = Number(input.race_tss) > 0 ? ` The race (about ${Math.round(Number(input.race_tss))} TSS) is on the calendar, not in your answer, and sits on top of the week: target_tss, target_hours and training_frequency are the training alone, without the race.` : "";
  const long = input.distance === "long";
  const days = Math.max(2, Math.min(7, Number(input.days) || 4));
  const seasonOn = skiSeasonOn(input);
  const bRule = !dates ? `
12. TUNE-UP RACES: the plan never adds a race; a B race already on the calendar is the tune-up.` : seasonOn ? `
12. RACE SEASON: ${dates} are races on the calendar, and each is its week's race: never write a race as a workout, never add a race. In a race-season week ("week_kind": "season") write exactly one hard session midweek, the high-intensity session of rule 2 (5 x 4 to 5 minutes at Z4 to Z5 HR); openers the day before the race (SKI-OPEN-001 Ski Openers from the library: 40 minutes easy with 3 x 1 minute at Z4 HR); the long session of long_session_minutes the day after the race or on a free weekend day and never the day before a race; everything else easy. The week's load holds at target_tss: a season is for racing, not building.${raceShare} training_frequency is the number of training sessions to write that week, already one fewer in a week with a race; the openers or strides the day before a race are one of them; never more, never fewer. Every other day except a race day is a rest day: one rest note and nothing else on it (a strength session of rule 6 may share an easy day; never alone on a rest day). With 4 or more training sessions, never two rest days in a row. The week's entries sum to target_tss, never to starting_tss.` : `
12. B RACES: ${dates} ${input.b_race_dates && input.b_race_dates.length > 1 ? "are races" : "is a race"} on the calendar, the plan's tune-up races. Never write a race as a workout, never add a race, and write nothing hard in the 2 days before one or the day after it.${raceShare}`;
  const threshold = long ? "one moderate-intensity session: 4 to 6 x 8 to 15 minutes or 3 x 15 minutes at 82 to 87% of max HR (Z3 HR), or 1 hour continuous double poling at that intensity, in double poling or classic on varied terrain" : "one moderate-intensity session: 4 to 6 x 8 to 15 minutes or 3 x 15 minutes at 82 to 87% of max HR (Z3 HR), in double poling or classic on varied terrain";
  const raceEffort = R.raceEffort ? `
9. RACE EFFORT: when race_effort_minutes is above 0, the long session holds that many minutes at race effort${long ? " in double poling" : ""} (write them as Z3 HR steps${long ? ", 2 or 3 blocks" : ", one block in its second half"}); it is still the week's long session, not a third hard session.` : "";
  const doublePoling = R.doublePoling ? `
10. DOUBLE POLING BLOCK: when double_poling_sessions is above 0, write that many double-poling muscular-endurance sessions that week (B\xF8rve 2017: 4 sets of 30 double-poling strokes against resistance, uphill on roller skis, on a SkiErg or with a pulley, 20 to 30 minutes inside or after an easy session, title "Double poling endurance ..."); when it is 0, none.` : "";
  const modelLine = model === "pyramidal" ? `
11. TRAINING MODEL: PYRAMIDAL (Torvik 2021: elite long-distance skiers at 88.7 / 6.4 / 4.8). Of the two hard sessions the moderate-intensity session is the main one and comes first in the week; the high-intensity session stays; the easy share stays at 85% or more.` : model === "ronnestad" ? `
11. TRAINING MODEL: R\xD8NNESTAD. The high-intensity session opens each interval fast (the first minute harder, then settle; R\xF8nnestad 2020, skiers), and the strength sessions are heavy (3 to 5 x 4 to 6 reps). Nothing else changes.` : "";
  return `
NORDIC SKI ${R.label.toUpperCase()} PLAN (these rules outrank the load rules above where they differ):
Every week in 'WEEKS TO GENERATE' carries week_kind, long_session_minutes, quality_sessions, race_effort_minutes, strength_sessions and double_poling_sessions. The code has set these. Follow them.
1. LONG SESSION: when long_session_minutes is above 0, write one long ski of exactly that length on the weekend, easy (Z2 HR, under 82% of max HR) apart from the race-effort block of rule 9. Never make it longer, and never move the week's spare minutes into it.
2. HARD SESSIONS: write exactly quality_sessions hard sessions that week. In a build or peak week: ${threshold}, and one high-intensity session: 5 x 4 to 5 minutes at 87 to 95% of max HR (Z4 to Z5 HR) with 2 to 3 minutes easy between, uphill with poles when there is no snow. In a lighter week the one hard session is a short high-intensity session: 4 x 3 minutes at Z4 HR.${seasonOn ? " In a race-season week the one hard session is the one of rule 12." : ""} In a taper or race week the two hard sessions are short (4 x 3 minutes at Z4 HR, or 3 x 6 minutes at Z3 HR), in race week the last of them 2 to 3 days before the race. Openers are extra to them.
3. EASY: at least 85% of the week's time is easy, under 82% of max HR. Never two hard days in a row: an easy session or rest day between the hard sessions and the long session.
4. SPRINTS: once a week, 6 to 10 x 10 to 20 seconds maximal with full recovery inside one easy session (write them as "- 15s Z7 HR" steps in a repeat), never in the long session or a hard session.
5. SESSIONS: keep to training_frequency ski sessions, strength extra to them. Every ski session is "type": "NordicSki" on snow, "RollerSki" on roller skis or "VirtualSki" on the SkiErg. When the athlete's directives or the season say there is no snow, write roller-ski sessions, the intensity sessions as running with poles uphill ("type": "Run", "with poles" in the title), and easy volume only as cycling ("type": "Ride"). A rest day is a note (category NOTE), never a workout.
   STEPS: every step line starts with "- " and holds a time written like 40m, 1h30m or 90s, never in words such as "40 minutes", and a heart-rate target as a zone ("Z2 HR", "Z3 HR", "Z4 HR"). Repeats use a header line such as "5x" with a blank line before and after. Write the % of max HR of each intensity in the description's last line. A session with no such step lines is wrong.
6. STRENGTH: write exactly strength_sessions sessions of whole-body ski strength that week ("type": "WeightTraining", 40 to 50 minutes: upper-body pull such as pull-downs and pull-overs, trunk, legs; sets x reps at RPE, never a weight), on a day with an easy session or a rest day, never the day before the high-intensity session; when it is 0, none.
7. PROGRESS: never copy a week. Each loading week must differ from the same week of the block before it, in reps, rep length or terrain.
8. RACE WEEK: the race itself is on the calendar and is never written as a workout. Openers the day before are fine: SKI-OPEN-001 Ski Openers from the library (40 minutes easy with 3 x 1 minute at Z4 HR).${raceEffort}${doublePoling}${modelLine}${bRule}
`;
}
function easySteps3(minutes) {
  const edges = minutes >= 60 ? [10, 10] : [5, 5];
  const main2 = Math.max(5, Math.round(minutes) - edges[0] - edges[1]);
  return `- Warmup ${edges[0]}m Z1 HR
- ${main2}m Z2 HR
- Cooldown ${edges[1]}m Z1 HR`;
}
var isSki = (w) => /ski/i.test(String(w?.type || "NordicSki"));
var isEndurance = (w) => /ski|run|ride/i.test(String(w?.type || "NordicSki"));
function sharpSteps2(minutes) {
  const rest = Math.max(5, Math.round(minutes) - 15 - 24 - 10);
  return `- Warmup 15m Z1 HR

4x
- 3m Z4 HR
- 3m Z1 HR

- ${rest}m Z2 HR
- Cooldown 10m Z1 HR`;
}
function hasSkiHardSet(description) {
  let s = 0;
  for (const step of parseSteps(description)) if ((step.pct ?? 0) >= 82 && step.seconds > 20) s += step.seconds * (step.inRepeat ? step.repeats : 1);
  return s >= 12 * 60;
}
var daysApart2 = (from, to) => Math.round(((/* @__PURE__ */ new Date(to + "T12:00:00Z")).getTime() - (/* @__PURE__ */ new Date(from + "T12:00:00Z")).getTime()) / 864e5);
function reconcileSkiRaceWeeks(weeks, targets, bRaceDates = [], raceDate = "", crossSports = []) {
  const out = {};
  const isNote = (w) => String(w?.category || "").toUpperCase() === "NOTE";
  const isCross = (w) => crossSports.some((t) => t.toLowerCase() === String(w?.type || "").trim().toLowerCase());
  const isEnd = (w) => isEndurance(w) || isCross(w);
  for (const key of Object.keys(weeks || {})) {
    const target = targets.find((t) => t.index === Number(key));
    const list = (Array.isArray(weeks[key]) ? weeks[key] : []).filter((w) => {
      const date = String(w?.date || "").slice(0, 10);
      if (isNote(w)) return true;
      if (raceDate && date === raceDate) return false;
      if (/opener|activation|shake|prime/i.test(String(w?.title || ""))) return true;
      return !(bRaceDates.includes(date) && /\brace\b|loppet|lauf|marathon|rennet/i.test(`${w?.title || ""} ${w?.description || ""}`));
    }).map((w) => {
      if (isNote(w)) return w;
      if (!isEnd(w)) return parseSteps(String(w?.description || "")).length || /weight|strength|yoga|core|mobility/i.test(String(w?.type || "")) ? w : { ...w, category: "NOTE", duration_minutes: 0, tss: 0 };
      const stated = Number(w.duration_minutes) || 0;
      if (!(stated > 0) && !parseSteps(String(w.description || "")).length) return { ...w, category: "NOTE", duration_minutes: 0, tss: 0 };
      if (isCross(w) && !isEndurance(w) && !parseSteps(String(w.description || "")).length) {
        const description2 = crossEasySteps(stated);
        const totals2 = itemTotals({ ...w, description: description2 });
        return { ...w, description: description2, duration_minutes: totals2?.minutes || stated, tss: totals2?.tss || w.tss };
      }
      const text = String(w.description || "").split("\n").filter((line) => !/^\s*-.*\b(0[ms]|\d+ms)\b/.test(line)).join("\n");
      const readable = parseSteps(sanitizeWorkoutDescription(text, w.type)).length > 0;
      const description = readable ? text : easySteps3(stated);
      const totals = itemTotals({ ...w, description });
      const hardTitle = /interval|threshold|vo2|tempo|race|sprint|hill|effort|max|double poling|poling/i.test(String(w.title || ""));
      return { ...w, ...readable || !hardTitle ? {} : { title: "Easy ski" }, description, duration_minutes: totals?.minutes || stated, tss: totals?.tss || w.tss };
    });
    const sessions = list.filter((w) => !isNote(w) && isSki(w) && Number(w.duration_minutes) > 0);
    const longestOf = (from) => from.reduce((best, w) => Number(w.duration_minutes) > Number(best?.duration_minutes || 0) ? w : best, null);
    const long = target && target.long_session_minutes > 0 ? longestOf(sessions.filter((w) => /\blong\b/i.test(String(w.title || "")))) || longestOf(sessions) : null;
    if (long && target && Math.abs(Number(long.duration_minutes) - target.long_session_minutes) > Math.max(5, target.long_session_minutes * 0.05)) {
      const fitted = fitToMinutes(long.description, target.long_session_minutes);
      if (fitted) {
        long.description = fitted;
        const totals = itemTotals(long);
        long.duration_minutes = totals?.minutes || target.long_session_minutes;
        long.tss = totals?.tss || long.tss;
      }
    }
    const easy = sessions.filter((w) => w !== long && parseSteps(w.description).every((step) => step.pct === null || step.pct <= EASY_TOP_PCT3 || step.seconds <= 20));
    const easyTotal = easy.reduce((sum, w) => sum + Number(w.duration_minutes), 0);
    const others = list.filter((w) => !isNote(w) && isEnd(w) && !easy.includes(w)).reduce((sum, w) => sum + Number(w.duration_minutes), 0);
    const room = target && target.week_kind !== "b_race" ? Math.max(MIN_SESSION_MINUTES, target.target_duration_minutes - others) : easyTotal;
    const longMinutes = long ? Number(long.duration_minutes) : Infinity;
    const minutes = Math.min(easyTotal, room, longMinutes * easy.length);
    let kept = easy;
    if (easy.length && easyTotal - minutes > Math.max(15, minutes * 0.1)) {
      kept = [...easy].sort((x, y) => Number(y.duration_minutes) - Number(x.duration_minutes));
      while (kept.length > 1 && minutes / kept.length < MIN_SESSION_MINUTES) kept = kept.slice(0, -1);
      const each = toFive3(minutes / kept.length);
      kept.forEach((w) => {
        w.description = fitToMinutes(w.description, each) || easySteps3(each);
        const totals = itemTotals(w);
        w.duration_minutes = totals?.minutes || each;
        w.tss = totals?.tss || w.tss;
      });
    }
    if (target && target.week_kind !== "b_race" && kept.length) {
      const total = list.filter((w) => !isNote(w) && isEnd(w) && (!easy.includes(w) || kept.includes(w))).reduce((sum, w) => sum + Number(w.duration_minutes), 0);
      const short = target.target_duration_minutes - total;
      if (short > target.target_duration_minutes * 0.15) {
        const cap = Number.isFinite(longMinutes) ? longMinutes : 90;
        kept.forEach((w) => {
          const each = Math.min(cap, toFive3(Number(w.duration_minutes) + short / kept.length));
          const fitted = each > Number(w.duration_minutes) ? fitToMinutes(w.description, each) : null;
          if (!fitted) return;
          w.description = fitted;
          const totals = itemTotals(w);
          w.duration_minutes = totals?.minutes || each;
          w.tss = totals?.tss || w.tss;
        });
      }
    }
    out[key] = settleRestNotes(list.filter((w) => !easy.includes(w) || kept.includes(w)));
    if (target && target.quality_sessions > 0 && ["lighter", "taper", "race_week"].includes(target.week_kind)) {
      const have = out[key].filter((w) => !isNote(w) && isEndurance(w) && hasSkiHardSet(w.description)).length;
      const hosts = kept.filter((w) => w !== long && Number(w.duration_minutes) >= 50 && (!raceDate || !w.date || daysApart2(String(w.date).slice(0, 10), raceDate) >= 2)).sort((x, y) => Number(y.duration_minutes) - Number(x.duration_minutes)).slice(0, Math.max(0, target.quality_sessions - have));
      for (const host of hosts) {
        host.description = sharpSteps2(Number(host.duration_minutes));
        host.title = "Short hard efforts";
        const totals = itemTotals(host);
        host.duration_minutes = totals?.minutes || host.duration_minutes;
        host.tss = totals?.tss || host.tss;
      }
    }
  }
  return out;
}

// src/lib/rowRacePlan.ts
var ROW_RACE_RULES = {
  // 8 to 12 weeks, at least 6: observed P03 (12), P06; trial R11 (8 weeks), R13 (3-week blocks, the second adds little). growth 5%: extrapolated from the Run rule
  // (P01 rises 6 to 13% a week inside its blocks, observed; R23 a 100% jump worsens the 2k in 6 days, trial, upper bound only). maxRatio 1.3: convention
  // (elites hold volume flat, R16; juniors swap modes rather than add hours, R04). Peak 2 weeks out, taper 70 / 45%: extrapolated, Ride short events (R32
  // non-rowing; R34 the one 5-day rowing taper, 1.8% gain). quality 2 under 8 h, 3 from 12 h: trial R11 (2 HIIT a week), R13 (3 a week on 12 to 16 h), R35.
  // Race-pace reps from week 1: observed P03, P04. racePaceMinutes 12 to 16: the short-rep sessions (6 x 500, 4 x 1000, 8 x 500; P03, P04, P08, P09).
  // Longest 60 min or 10 km: observed P03, P06. Distribution about 85 / 10 / 5 pyramidal: observed R04, R05, R15, R16, R30. Anchor best 2k: observed P03, P08, P09
  "2k": { label: "2 km", raceType: "row_2k", km: 2, defaultWeeks: [8, 12], minWeeks: 6, growth: 1.05, maxRatio: 1.3, taper: [0.7, 0.45], quality: [2, 3], taperQuality: 2, raceWeekQuality: 1, racePaceFromShare: 0, racePaceMinutes: [12, 16], longTopMinutes: 60, longTopKm: 10, longTaper: [0.6, 0.45], anchor: "2k", distribution: "about 85 / 10 / 5" },
  // 12 weeks, at least 6: observed P05 (12). growth, maxRatio, peak and taper as 2 km (extrapolated). quality 2: observed P05 (2 interval sessions + 1 long piece),
  // P08. 5k-pace long intervals from week 1: observed P05, P08. racePaceMinutes 16 to 32: 2 x 2 km to 4 x 2000 / 5 x 1500 (P05, P08). Longest 60 min / 10 km:
  // observed P05, P09. Distribution about 80 / 15 / 5: convention (pyramidal, R07, R17). Anchor best 5k: observed P05, P01. No head-race study exists
  head: { label: "Head race 5\u20137 km", raceType: "row_head", km: 6, defaultWeeks: [12, 12], minWeeks: 6, growth: 1.05, maxRatio: 1.3, taper: [0.7, 0.45], quality: [2, 2], taperQuality: 2, raceWeekQuality: 1, racePaceFromShare: 0, racePaceMinutes: [16, 32], longTopMinutes: 60, longTopKm: 10, longTaper: [0.6, 0.45], anchor: "5k", distribution: "about 80 / 15 / 5" },
  // 10 weeks, at least 8: observed P02 (10). growth 5%: extrapolated. maxRatio 1.5: observed P02 (26 to 30 km distance sessions plus more timed work). Peak 2 weeks
  // out: as 2 km (extrapolated); taper 75 / 55%: the first two shares of the marathon taper (observed P01), the third needs a third week. quality 1 then 2 from
  // race-pace work: observed P02 (one timed session, two from week 4). Race pace from week 7 of 10: observed P02. racePaceMinutes 40 to 50: 2 x 20 min, 50 min
  // (P02). Longest 16 km = 76% of the distance, one week before the race: observed P02 (14, 16, race), so the long row keeps its length in the taper week.
  // Distribution about 85 / 15 / 0, nothing above AT: observed P01, P02. Anchor best 5k, HMP from it: observed P02
  half: { label: "Half marathon", raceType: "row_half", km: 21.1, defaultWeeks: [10, 10], minWeeks: 8, growth: 1.05, maxRatio: 1.5, taper: [0.75, 0.55], quality: [1, 2], taperQuality: 1, raceWeekQuality: 1, racePaceFromShare: 0.6, racePaceMinutes: [40, 50], longTopMinutes: 0, longTopKm: 16, longTaper: [1], anchor: "5k", distribution: "about 85 / 15 / 0" },
  // 12 to 16 weeks, at least 8: observed P07 (12 + 2 taper), P01 (16). growth 5%: observed P01 +6 to 13% inside blocks, extrapolated. maxRatio 1.8: observed
  // P01 (30 to 54 km a week). Peak 3 weeks out: observed P01 (long row peaks in week 12 of 16), P06 4 weeks, P07 2 weeks. Taper 75 / 55 / 35%: observed P01
  // (89 / 74 / 44, then race week about 20%), P07 2 weeks, P06 4 weeks with short hard pieces. quality 1 then 2 from race-pace work: observed P01 (one AT or MP
  // session a week), P02; nothing above AT (P01, P02, P07). Marathon pace from week 10 of 16: observed P01 (P02 week 7 of 10). racePaceMinutes 40 to 75:
  // 2 x 20, 50 min, 3 x 25 (P01, P07). Longest 75 to 80% of the distance (34 km), 4 weeks out: observed P01 (34 km = 81%), P10 (30 km = 71%); P06 disagrees
  // (never an ultra-long piece). Long row in the taper 80 / 65%: observed P01 (28, 22 of 34). Distribution about 85 / 15 / 0: observed P01, P07. Anchor best 5k;
  // marathon pace about 65% of 2k watts: observed P07 (four record rows at 63 to 68%)
  marathon: { label: "Marathon", raceType: "row_marathon", km: 42.2, defaultWeeks: [12, 16], minWeeks: 8, growth: 1.05, maxRatio: 1.8, taper: [0.75, 0.55, 0.35], quality: [1, 2], taperQuality: 1, raceWeekQuality: 1, racePaceFromShare: 9 / 16, racePaceMinutes: [40, 75], longTopMinutes: 0, longTopKm: 34, longTaper: [0.8, 0.65], anchor: "5k", distribution: "about 85 / 15 / 0" }
};
var ROW_RACE = {
  // Race season, as Ride (Clive, 2026-11-11): three or more races inside the plan; the load held at the start, the last week at 80%;
  // the long row the day after a 2 km or head race, none after a longer one
  seasonMinRaces: 3,
  seasonFinal: 0.8,
  seasonTrainingFloor: 0.4,
  // Lighter week every 4th at 70%: observed P01 (weeks 4 and 8 at −30%), P07 light / medium / hard / light
  lighterEvery: 4,
  lighter: 0.7,
  // Hours follow load at this power, the long row's weekly rise, its share in a lighter week and its ceiling as a share of the week: as Ride and ski
  hoursPower: 0.9,
  longUp: 1.12,
  longLighter: 0.7,
  longMaxShare: 0.6,
  // Hard sessions kept in a lighter week (as Ride and ski)
  lighterQuality: 1,
  // The 2 km hard-session count by hours a week: 2 under 8 h, 3 from 12 h, 2 between (trial R11, R13; R35)
  qualityHighFrom: 12,
  // Strength: 2 a week in loading weeks, 1 in the taper (observed R05 1.3 to 1.6 a week in elites, R30 2 a week in two of three masters champions; review R24;
  // trial R25, R26); 1 in a lighter week (as ski). Whole-body rowing strength: squat, deadlift, bench pull, trunk
  strengthLoading: 2,
  strengthLate: 1,
  // A low base: under this many rowing sessions a week or this many km a week → this many easy base weeks first, UT2 / UT1, no hard sessions (observed P06
  // "less than 6 weeks and not training: do not go ahead", P08 beginner plan, P11 40,000 m a week before a marathon)
  lowBaseSessions: 3,
  lowBaseKm: 20,
  baseWeeks: 4,
  bRace: { before: 0.9, week: 0.75, after: 0.8 },
  // The baseline window (as Ride) and how far back the best 2k and 5k are looked for
  lookbackDays: 28,
  anchorLookbackDays: 182,
  // Rowing speed when the baseline gives none: 2:24 per 500 m (silent)
  fallbackSpeedKmh: 12.5,
  // Pace bands off the 5k test, seconds per 500 m slower than it: observed P01, P02 (UT2 +18 to 22, UT1 +14 to 18, AT +6 to 10, HMP +8 to 12, MP +10 to 14)
  bands5k: { ut2: [18, 22], ut1: [14, 18], at: [6, 10], hmp: [8, 12], mp: [10, 14] },
  // Off the 2k: 95 to 100% of 2k power is 2k pace to about 2 s per 500 m slower (power ∝ pace⁻³; trial R10, R11, R13); the short reps at 2k pace +3 s
  // (observed P08, P09); marathon pace about 65% of 2k watts = 2k pace × 1.154 (observed P07)
  twoKPowerSlow: 2,
  twoKShortRepSlow: 3,
  mpOf2kWatts: 0.65,
  // The easy edge in seconds per 500 m slower than the 2k when only a 2k is on record (silent, the 5k band carried over by about 8 s)
  easyEdgeOff2k: 20
};
var rowSeasonOn = (input) => input.season === true && (input.b_race_weeks || []).length >= ROW_RACE.seasonMinRaces - 1;
var EASY_TOP_PCT4 = 75;
var MIN_SESSION_MINUTES2 = 30;
var round14 = (n) => Math.round(n * 10) / 10;
var toFive4 = (n) => Math.round(n / 5) * 5;
var rulesOf4 = (race) => ROW_RACE_RULES[race] || ROW_RACE_RULES["2k"];
var ROW_TYPE = /^(Rowing|VirtualRow)$/i;
function rowRaceOf(race) {
  const name = String(race?.name || race?.title || "");
  if (/head of the charles|\bhocr\b|head of the river|\bhorr\b|head race|\bhead\b/i.test(name)) return "head";
  if (/half[\s-]?marathon/i.test(name)) return "half";
  if (/marathon/i.test(name)) return "marathon";
  if (/\b2k\b|\b2000\s?m\b|\b2,000\s?m\b/i.test(name)) return "2k";
  const km = Number(race?.distance || race?.distance_target || 0) / 1e3;
  if (!(km > 0)) return null;
  if (km >= 1.8 && km <= 2.2) return "2k";
  if (km >= 4.5 && km <= 8) return "head";
  if (km >= 20 && km <= 22) return "half";
  if (km >= 40 && km <= 50) return "marathon";
  return null;
}
var rowSessions = (activities, from, to) => {
  const seen = /* @__PURE__ */ new Set();
  return (Array.isArray(activities) ? activities : []).filter((a) => {
    const when = new Date(String(a?.start_date_local || "")).getTime();
    if (!ROW_TYPE.test(String(a?.type || "").trim()) || !(Number(a?.moving_time) > 0) || !(when >= from && when <= to)) return false;
    const key = `${a.start_date_local}|${Math.round(Number(a.distance) || 0)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
function rowBaselineFromActivities(activities, today = /* @__PURE__ */ new Date()) {
  const sessions = rowSessions(activities, today.getTime() - ROW_RACE.lookbackDays * 864e5, today.getTime());
  if (!sessions.length) return null;
  const weeks = ROW_RACE.lookbackDays / 7;
  const seconds = sessions.reduce((s, a) => s + Number(a.moving_time), 0);
  const metres = sessions.reduce((s, a) => s + (Number(a.distance) || 0), 0);
  const load = sessions.reduce((s, a) => s + (Number(a.icu_training_load) || 0), 0);
  if (!(load > 0)) return null;
  return {
    tss: Math.round(load / weeks),
    hours: round14(seconds / 3600 / weeks),
    km: round14(metres / 1e3 / weeks),
    sessions: round14(sessions.length / weeks),
    longestMinutes: toFive4(Math.max(...sessions.map((a) => Number(a.moving_time) || 0)) / 60),
    speedKmh: metres > 0 ? round14(metres / 1e3 / (seconds / 3600)) : ROW_RACE.fallbackSpeedKmh
  };
}
function rowAnchorsFromActivities(activities, today = /* @__PURE__ */ new Date()) {
  const sessions = rowSessions(activities, today.getTime() - ROW_RACE.anchorLookbackDays * 864e5, today.getTime());
  const best = (lo, hi) => {
    let out;
    for (const a of sessions) {
      const metres = Number(a.distance) || 0;
      if (metres < lo || metres > hi) continue;
      const pace = Number(a.moving_time) / metres * 500;
      if (!out || pace < out.seconds_per_500) out = { seconds_per_500: round14(pace), date: String(a.start_date_local || "").slice(0, 10) };
    }
    return out;
  };
  const k2 = best(1950, 2100);
  const k5 = best(4950, 5100);
  return { ...k2 ? { k2 } : {}, ...k5 ? { k5 } : {} };
}
function paceText(secondsPer500) {
  const s = Math.max(0, Number(secondsPer500) || 0);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? "0" : ""}${r.toFixed(1)}`;
}
var stepPace = (secondsPer500) => {
  const s = Math.round(secondsPer500);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}/500m Pace`;
};
function rowLongTop(race, speedKmh) {
  const R = rulesOf4(race);
  const speed = Number(speedKmh) > 0 ? Number(speedKmh) : ROW_RACE.fallbackSpeedKmh;
  const byKm = R.longTopKm > 0 ? R.longTopKm / speed * 60 : Infinity;
  const byMin = R.longTopMinutes > 0 ? R.longTopMinutes : Infinity;
  return Math.min(byKm, byMin);
}
function rowBaseWeeks(race, weeks, lowBase) {
  return lowBase ? Math.max(0, Math.min(ROW_RACE.baseWeeks, weeks - rulesOf4(race).minWeeks)) : 0;
}
function rowQuality(race, startHours, racePaceOn) {
  const R = rulesOf4(race);
  if (race === "2k") return startHours >= ROW_RACE.qualityHighFrom ? R.quality[1] : R.quality[0];
  if (race === "head") return R.quality[0];
  return racePaceOn ? R.quality[1] : R.quality[0];
}
function rowRaceWeekTargets(input, baseWeeks) {
  const G = ROW_RACE;
  const R = rulesOf4(input.race);
  const N = Math.max(R.minWeeks, Math.round(Number(input.weeks) || 0));
  const S = Math.max(50, Number(input.start_tss) || 0);
  const H = Math.max(1, Number(input.start_hours) || 0);
  const days = Math.max(2, Math.min(7, Number(input.days) || 4));
  const lastDays = Math.round(Number(input.last_week_days) || 7);
  const strengthOn = input.strength !== false;
  const speed = Number(input.speed_kmh) > 0 ? Number(input.speed_kmh) : G.fallbackSpeedKmh;
  const base = rowBaseWeeks(input.race, N, input.low_base === true);
  const peakWeek = N - R.taper.length;
  const ratio = Math.min(R.maxRatio, Math.pow(R.growth, peakWeek - 1));
  const peak = S * ratio;
  const bWeeks = (input.b_race_weeks || []).filter((w) => w >= 1 && w <= peakWeek);
  const seasonWeeks = (input.b_race_weeks || []).filter((w) => w >= 1 && w <= N);
  const season = rowSeasonOn(input);
  const targetWeek = baseWeeks?.find((b) => b.startStr && b.endStr && input.race_date && input.race_date >= b.startStr && input.race_date <= b.endStr)?.index ?? N;
  const longTop = rowLongTop(input.race, speed);
  const planWeeks = N - base;
  const racePaceFrom = base + (R.racePaceFromShare > 0 ? Math.round(planWeeks * R.racePaceFromShare) + 1 : 1);
  const isLighter = (w) => w > base && (w - base) % G.lighterEvery === 0 && w < peakWeek;
  const anchorOn = R.anchor === "2k" ? Number(input.anchor_2k) > 0 : Number(input.anchor_5k) > 0;
  const testWeek = anchorOn ? 0 : base + 1;
  let longBest = Math.min(longTop, Math.max(20, Number(input.longest_minutes) || H * 60 * 0.35));
  const out = [];
  for (let w = 1; w <= N; w++) {
    let kind = w <= base ? "base" : "build";
    let tss;
    if (season) {
      kind = w === targetWeek ? "race_week" : seasonWeeks.includes(w) ? "season" : w <= base ? "base" : "build";
      const held = w === targetWeek ? S * G.seasonFinal : S;
      tss = kind === "season" || kind === "race_week" ? Math.max(held * G.seasonTrainingFloor, held - (Number(input.race_tss) || 0)) : held;
    } else if (w > peakWeek) {
      tss = peak * R.taper[w - peakWeek - 1];
      kind = w === N ? "race_week" : "taper";
    } else {
      tss = S * Math.pow(ratio, (w - 1) / Math.max(1, peakWeek - 1));
      if (w === peakWeek) kind = "peak";
      else if (w <= base) kind = "base";
      else if (bWeeks.includes(w)) {
        tss *= G.bRace.week;
        kind = "b_race";
      } else if (bWeeks.includes(w - 1)) {
        tss *= G.bRace.after;
        kind = "b_recovery";
      } else if (bWeeks.includes(w + 1)) tss *= G.bRace.before;
      else if (isLighter(w)) {
        tss *= G.lighter;
        kind = "lighter";
      }
    }
    const hours = H * Math.pow(tss / S, G.hoursPower);
    let longM;
    if (season) longM = kind === "race_week" ? 0 : kind === "season" ? input.race === "2k" || input.race === "head" ? Math.min(longTop, longBest) : 0 : Math.min(longTop, longBest);
    else if (w > peakWeek) longM = w === N ? 0 : Math.min(longTop, longBest) * (R.longTaper[w - peakWeek - 1] ?? R.longTaper[R.longTaper.length - 1]);
    else if (kind === "b_race") longM = 0;
    else if (kind === "b_recovery") longM = longBest * 0.5;
    else if (kind === "lighter") longM = longBest * G.longLighter;
    else {
      longM = Math.min(longTop, longBest * G.longUp);
      longBest = Math.max(longBest, longM);
    }
    longM = Math.min(longM, hours * 60 * G.longMaxShare);
    const loading = (kind === "build" || kind === "peak") && !season;
    const racePaceOn = loading && w >= racePaceFrom;
    const quality = kind === "base" ? 0 : loading ? rowQuality(input.race, H, racePaceOn) : kind === "b_race" ? 0 : kind === "season" || kind === "build" ? 1 : kind === "lighter" || kind === "b_recovery" ? G.lighterQuality : kind === "race_week" ? R.raceWeekQuality : R.taperQuality;
    let racePace = 0;
    if (racePaceOn) {
      const share2 = peakWeek > racePaceFrom ? (w - racePaceFrom) / (peakWeek - racePaceFrom) : 1;
      racePace = Math.round(R.racePaceMinutes[0] + (R.racePaceMinutes[1] - R.racePaceMinutes[0]) * Math.max(0, Math.min(1, share2)));
    }
    const strength = !strengthOn ? 0 : kind === "b_race" ? 0 : loading || kind === "base" ? G.strengthLoading : G.strengthLate;
    const dates = baseWeeks?.find((b) => b.index === w) || baseWeeks?.[w - 1] || {};
    const share = w === N && lastDays >= 1 && lastDays < 7 ? lastDays / 7 : 1;
    const weekHours = round14(hours * share);
    const longMinutes = toFive4(longM);
    out.push({
      index: w,
      startStr: dates.startStr,
      endStr: dates.endStr,
      startLabel: dates.startLabel,
      endLabel: dates.endLabel,
      phase: loading || kind === "base" ? "load" : "recovery",
      target_tss: Math.round(tss * share),
      target_hours: weekHours,
      target_duration_minutes: Math.round(weekHours * 60),
      training_frequency: Math.max(1, (w === N ? Math.min(days, 4, lastDays) : days) - (season && (kind === "season" || kind === "race_week") ? 1 : 0)),
      ceiling: true,
      week_kind: kind,
      long_session_minutes: longMinutes,
      long_session_km: Math.round(longMinutes / 60 * speed * 2) / 2,
      quality_sessions: quality,
      race_pace_minutes: racePace,
      strength_sessions: strength,
      test_session: w === testWeek ? R.anchor : null
    });
  }
  return out;
}
function rowPaceTable(input) {
  const G = ROW_RACE;
  const k2 = Number(input.anchor_2k) > 0 ? Number(input.anchor_2k) : 0;
  const k5 = Number(input.anchor_5k) > 0 ? Number(input.anchor_5k) : 0;
  if (!k2 && !k5) return "";
  const lines = [];
  if (k2) lines.push(`2k pace ${paceText(k2)}/500m${input.anchor_2k_date ? ` (best 2k, ${input.anchor_2k_date})` : ""}: 95 to 100% of 2k power is ${stepPace(k2 + G.twoKPowerSlow)} to ${stepPace(k2)}; short reps at 2k pace +3 s are ${stepPace(k2 + G.twoKShortRepSlow)}`);
  if (k5) {
    const b = G.bands5k;
    lines.push(`5k pace ${paceText(k5)}/500m${input.anchor_5k_date ? ` (best 5k, ${input.anchor_5k_date})` : ""}: AT ${stepPace(k5 + b.at[0])} to ${stepPace(k5 + b.at[1])}; UT1 ${stepPace(k5 + b.ut1[0])} to ${stepPace(k5 + b.ut1[1])}; UT2 ${stepPace(k5 + b.ut2[0])} to ${stepPace(k5 + b.ut2[1])}; 10k pace about ${stepPace(k5 + 7)} to ${stepPace(k5 + 8)}`);
    if (input.race === "half") lines.push(`Half-marathon pace (HMP) ${stepPace(k5 + b.hmp[0])} to ${stepPace(k5 + b.hmp[1])}`);
  }
  if (input.race === "marathon") {
    if (k2) lines.push(`Marathon pace (MP) about 65% of 2k watts: ${stepPace(k2 * Math.pow(1 / G.mpOf2kWatts, 1 / 3))}`);
    else if (k5) lines.push(`Marathon pace (MP) ${stepPace(k5 + G.bands5k.mp[0])} to ${stepPace(k5 + G.bands5k.mp[1])} (no 2k on record for the 65%-of-2k-watts figure)`);
  }
  return lines.join("\n   ");
}
function rowRacePromptRules(input) {
  const R = rulesOf4(input.race);
  const model = trainingModelOf(input.model);
  const dates = (input.b_race_dates || []).join(", ");
  const raceShare = Number(input.race_tss) > 0 ? ` The race (about ${Math.round(Number(input.race_tss))} TSS) is on the calendar, not in your answer, and sits on top of the week: target_tss, target_hours and training_frequency are the training alone, without the race.` : "";
  const paces = rowPaceTable(input);
  const days = Math.max(2, Math.min(7, Number(input.days) || 4));
  const seasonOn = rowSeasonOn(input);
  const seasonHard = input.race === "2k" ? "the VO2max session (8 x 2.5 minutes at 95 to 100% of 2k power with 2.5 minutes easy between, or 4 to 6 x 4 minutes with 2 minutes easy)" : input.race === "head" ? "the threshold session (3 x 10 to 15 minutes at AT with 4 minutes easy between)" : "the AT session (3 x 10 to 15 minutes at AT, or 4 x 8 to 10 minutes)";
  const bRule = !dates ? `
12. TUNE-UP RACES: the plan never adds a race; a B race already on the calendar is the tune-up.` : seasonOn ? `
12. RACE SEASON: ${dates} are races on the calendar, and each is its week's race: never write a race as a workout, never add a race. In a race-season week ("week_kind": "season") write exactly one hard session midweek, ${seasonHard}; openers the day before the race (ROW-OPEN-001 Row Openers from the library: 30 minutes easy with 4 x 20 seconds at race pace); the long row of long_session_minutes the day after the race or on a free weekend day and never the day before a race; everything else easy (UT2, UT1). The week's load holds at target_tss: a season is for racing, not building.${raceShare} training_frequency is the number of training sessions to write that week, already one fewer in a week with a race; the openers or strides the day before a race are one of them; never more, never fewer. Every other day except a race day is a rest day: one rest note and nothing else on it (a strength session of rule 6 may share an easy day; never alone on a rest day). With 4 or more training sessions, never two rest days in a row. The week's entries sum to target_tss, never to starting_tss.` : `
12. B RACES: ${dates} ${input.b_race_dates && input.b_race_dates.length > 1 ? "are races" : "is a race"} on the calendar, the plan's tune-up races. Never write a race as a workout, never add a race, and write nothing hard in the 2 days before one or the day after it.${raceShare}`;
  const anchorOn = R.anchor === "2k" ? Number(input.anchor_2k) > 0 : Number(input.anchor_5k) > 0;
  const shape = input.race === "2k" ? "one VO2max session: 8 x 2.5 minutes at 95 to 100% of 2k power with 2.5 minutes easy between (or until HR is back to 70% of max), or 4 to 6 x 4 minutes with 2 minutes easy; and one short-rep session at race pace: 6 x 500 m with 2 minutes rest, 4 x 1000 m with 3 to 5 minutes rest, or 8 x 500 m every 3:30 at 2k pace +3 s; a third hard session (quality_sessions 3) is a second VO2max session" : input.race === "head" ? "one threshold session: 3 x 10 to 15 minutes at AT with 4 minutes easy between; and one long-interval session at 5k pace: 2 x 2 km with 4 minutes rest, 2 x 3 km with 4 minutes rest, 4 x 2000 m with 5 minutes rest, or 5 x 1500 m with 5 minutes rest" : input.race === "half" ? "an AT session (3 x 10 to 15 minutes at AT, or 4 x 8 minutes) and, when race_pace_minutes is above 0, the race-pace session: 2 x 20 minutes at half-marathon pace, or 60 to 90 minutes alternating 10k pace and half-marathon pace; nothing faster than AT in this plan" : "an AT session (3 x 10 to 15 minutes at AT, or 4 x 8 to 10 minutes) and, when race_pace_minutes is above 0, the race-pace session: 2 x 20 minutes at marathon pace, 50 minutes at marathon pace, 60 to 90 minutes alternating 10k pace, marathon pace and half-marathon pace, or 3 x 25 minutes at marathon pace; nothing faster than AT in this plan";
  const racePaceLine = input.race === "2k" ? "race_pace_minutes is the work time of the short-rep session at 2k pace (the reps together, rests apart)" : input.race === "head" ? "race_pace_minutes is the work time of the 5k-pace long intervals (the reps together, rests apart)" : `race_pace_minutes is the time at ${input.race === "half" ? "half-marathon" : "marathon"} pace in the race-pace session; when it is 0 that week has no race-pace session`;
  const targets = anchorOn || paces ? `PACES: write every rowing target as an absolute pace per 500 m, "- 4m ${stepPace(Number(input.anchor_5k) > 0 ? Number(input.anchor_5k) + 8 : Number(input.anchor_2k) + 10)}" style (mm:ss/500m Pace), from this table and nothing else; it replaces the threshold_pace rule above. Easy rowing (UT2, UT1) may be written as HR zones instead ("- 40m Z2 HR"). Never write stroke-rate targets in a step; the rate goes in the description's first line.
   ${paces}` : `PACES: there is no ${R.anchor} on record, so test_session names the test the plan opens with (week ${rowBaseWeeks(input.race, Number(input.weeks) || R.minWeeks, input.low_base === true) + 1}): write "${R.anchor === "2k" ? "2k test" : "5k test"}" as that week's first hard session: a warm-up, then the ${R.anchor === "2k" ? "2,000 m" : "5,000 m"} flat out written as a time step ("- ${R.anchor === "2k" ? "7m" : "20m"} Z5 HR") with the distance in the title and the description's first line, then a cool-down. Write every other hard step as an HR zone ("- 10m Z4 HR" for AT, "- 4m Z5 HR" for 5k and 2k pace, "- 20m Z3 HR" for marathon or half-marathon pace) and say the pace in words in the description's first line, relative to the test: "at your ${R.anchor} pace +3 s per 500 m", "at your 5k pace +6 to 10 s (AT)". Easy rowing is Z1 or Z2 HR. Never invent a pace in seconds.`;
  const modelLine = model === "pyramidal" ? `
11. TRAINING MODEL: PYRAMIDAL, as elite and masters rowers train (Treff 2017 found polarised no better than pyramidal in rowers). Intensity distribution of rowing time ${R.distribution} (easy / moderate / hard); the AT or race-pace session is the main one and comes first in the week.` : model === "ronnestad" ? `
11. TRAINING MODEL: R\xD8NNESTAD. The hard sessions open each interval fast (the first 30 seconds harder, then settle), and the strength sessions are heavy (3 to 5 x 4 to 6 reps). Nothing else changes.` : `
11. TRAINING MODEL: POLARISED. The hard sessions stay as rule 2 says; everything else is easy (UT2, Z1 to Z2 HR); the easy share stays at 85% or more.`;
  return `
ROWING ${R.label.toUpperCase()} PLAN (these rules outrank the load rules above where they differ):
Every week in 'WEEKS TO GENERATE' carries week_kind, long_session_minutes, long_session_km, quality_sessions, race_pace_minutes, strength_sessions and test_session. The code has set these. Follow them.
1. LONG ROW: when long_session_minutes is above 0, write one long row of exactly that length (about long_session_km) on the weekend, easy (UT2, Z2 HR)${input.race === "2k" || input.race === "head" ? "" : "; from race-pace work on, the race-pace session of rule 2 may be this row when it is the 60 to 90 minute alternating piece"}. Never make it longer, and never move the week's spare minutes into it.
2. HARD SESSIONS: write exactly quality_sessions hard sessions that week. In a build or peak week: ${shape}. ${racePaceLine}. In a base week (week_kind "base") there are none: UT2 and UT1 only.${seasonOn ? " In a race-season week the one hard session is the one of rule 12." : ""} In a lighter week the one hard session is short (${input.race === "2k" || input.race === "head" ? "4 x 500 m at race pace, or 2 x 8 minutes at AT" : "2 x 10 minutes at AT"}). In a taper or race week the hard sessions are short race-pace pieces (${input.race === "2k" ? "4 x 500 m at 2k pace, 6 x 1 minute" : input.race === "head" ? "2 x 1000 m at 5k pace, 3 x 5 minutes at AT" : "3 x 5 minutes at race pace, 2 x 10 minutes at AT"}), in race week the last of them 2 to 3 days before the race. Openers are extra to them.
3. EASY: the rest of the week's rowing is UT2 or UT1 (Z1 to Z2 HR), ${R.distribution} of rowing time easy / moderate / hard. Never two hard days in a row: an easy row or a rest day between the hard sessions and the long row.
4. SESSIONS: keep to training_frequency rowing sessions, strength extra to them. Every rowing session is "type": "VirtualRow" (the erg) or "Rowing" (on the water) as the athlete's directives say; erg and water are one load. A rest day is a note (category NOTE), never a workout.
   STEPS: every step line starts with "- " and holds a time written like 40m, 1h30m or 90s, never in words such as "40 minutes" and never a distance as the step (a 500 m rep is written as its time, "- 1m50s", with "500 m" in the first line of the description). Repeats use a header line such as "6x" with a blank line before and after. A session with no such step lines is wrong.
5. ${targets}
6. STRENGTH: write exactly strength_sessions sessions of whole-body rowing strength that week ("type": "WeightTraining", 40 to 50 minutes: squat, deadlift, bench pull, trunk; sets x reps at RPE, never a weight), on a day with an easy row or a rest day, never the day before a hard session; when it is 0, none.
7. PROGRESS: never copy a week. Each loading week must differ from the same week of the block before it, in reps, rep length or pace.
8. RACE WEEK: the race itself is on the calendar and is never written as a workout. Openers the day before are fine: ROW-OPEN-001 Row Openers from the library (30 minutes easy with 4 x 20 seconds at race pace).
9. TEST: when test_session is not null, that week's first hard session is the ${R.anchor} test of rule 5; it counts as one of its quality_sessions.
10. WATER AND ERG: the sessions are the same on either; on the water, write the stroke rate in the first line (UT2 18 to 20, AT 24 to 28, race pace 28 to 34) and keep the erg's structure.${modelLine}${bRule}
`;
}
function easySteps4(minutes) {
  const edges = minutes >= 60 ? [10, 10] : [5, 5];
  const main2 = Math.max(5, Math.round(minutes) - edges[0] - edges[1]);
  return `- Warmup ${edges[0]}m Z1 HR
- ${main2}m Z2 HR
- Cooldown ${edges[1]}m Z1 HR`;
}
var isRow = (w) => /row/i.test(String(w?.type || "VirtualRow"));
function sharpSteps3(minutes) {
  const rest = Math.max(5, Math.round(minutes) - 10 - 24 - 5);
  return `- Warmup 10m Z1 HR

4x
- 3m Z4 HR
- 3m Z1 HR

- ${rest}m Z2 HR
- Cooldown 5m Z1 HR`;
}
function stepPaceSeconds(line) {
  const m = /(\d{1,2}):(\d{2})(?:\.\d)?\s*\/\s*500\s*m/i.exec(String(line || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function rowHardEdge(input) {
  const k5 = Number(input?.anchor_5k) > 0 ? Number(input.anchor_5k) : 0;
  const k2 = Number(input?.anchor_2k) > 0 ? Number(input.anchor_2k) : 0;
  if (k5) return k5 + ROW_RACE.bands5k.at[1];
  if (k2) return k2 + ROW_RACE.easyEdgeOff2k - 2;
  return null;
}
function rowEasyEdge(input) {
  const k5 = Number(input?.anchor_5k) > 0 ? Number(input.anchor_5k) : 0;
  const k2 = Number(input?.anchor_2k) > 0 ? Number(input.anchor_2k) : 0;
  if (k5) return k5 + ROW_RACE.bands5k.ut1[0];
  if (k2) return k2 + ROW_RACE.easyEdgeOff2k;
  return null;
}
var stepLines = (description) => String(description || "").split("\n");
function hasRowHardSet(description, input) {
  const edge = rowHardEdge(input);
  const lines = stepLines(description);
  let s = 0;
  for (const step of parseSteps(description)) {
    const pace = stepPaceSeconds(lines[step.line]);
    const hard = pace !== null ? edge !== null && pace <= edge : (step.pct ?? 0) >= 82;
    if (hard && step.seconds > 20) s += step.seconds * (step.inRepeat ? step.repeats : 1);
  }
  return s >= 12 * 60;
}
function isEasyRow(description, input) {
  const edge = rowEasyEdge(input);
  const lines = stepLines(description);
  return parseSteps(description).every((step) => {
    const pace = stepPaceSeconds(lines[step.line]);
    if (pace !== null) return edge === null || pace >= edge;
    return step.pct === null || step.pct <= EASY_TOP_PCT4 || step.seconds <= 20;
  });
}
var daysApart3 = (from, to) => Math.round(((/* @__PURE__ */ new Date(to + "T12:00:00Z")).getTime() - (/* @__PURE__ */ new Date(from + "T12:00:00Z")).getTime()) / 864e5);
function reconcileRowRaceWeeks(weeks, targets, bRaceDates = [], raceDate = "", input, crossSports = []) {
  const out = {};
  const isNote = (w) => String(w?.category || "").toUpperCase() === "NOTE";
  const isCross = (w) => crossSports.some((t) => t.toLowerCase() === String(w?.type || "").trim().toLowerCase());
  for (const key of Object.keys(weeks || {})) {
    const target = targets.find((t) => t.index === Number(key));
    const list = (Array.isArray(weeks[key]) ? weeks[key] : []).filter((w) => {
      const date = String(w?.date || "").slice(0, 10);
      if (isNote(w)) return true;
      if (raceDate && date === raceDate) return false;
      if (/opener|activation|shake|prime/i.test(String(w?.title || ""))) return true;
      return !(bRaceDates.includes(date) && /\brace\b|regatta|head of|marathon|\b2k\b|2000/i.test(`${w?.title || ""} ${w?.description || ""}`));
    }).map((w) => {
      if (isNote(w)) return w;
      if (!isRow(w)) {
        if (isCross(w) && !parseSteps(String(w?.description || "")).length && Number(w?.duration_minutes) > 0) {
          const description2 = crossEasySteps(Number(w.duration_minutes));
          const totals2 = itemTotals({ ...w, description: description2 });
          return { ...w, description: description2, duration_minutes: totals2?.minutes || Number(w.duration_minutes), tss: totals2?.tss || w.tss };
        }
        return parseSteps(String(w?.description || "")).length || /weight|strength|yoga|core|mobility/i.test(String(w?.type || "")) ? w : { ...w, category: "NOTE", duration_minutes: 0, tss: 0 };
      }
      const stated = Number(w.duration_minutes) || 0;
      if (!(stated > 0) && !parseSteps(String(w.description || "")).length) return { ...w, category: "NOTE", duration_minutes: 0, tss: 0 };
      const text = String(w.description || "").split("\n").filter((line) => !/^\s*-.*\b(0[ms]|\d+ms)\b/.test(line)).join("\n");
      const readable = parseSteps(sanitizeWorkoutDescription(text, w.type)).length > 0;
      const description = readable ? text : easySteps4(stated);
      const totals = itemTotals({ ...w, description });
      const hardTitle = /interval|threshold|vo2|tempo|race|sprint|effort|max|test|\bat\b|pace/i.test(String(w.title || ""));
      return { ...w, ...readable || !hardTitle ? {} : { title: "Easy row" }, description, duration_minutes: totals?.minutes || stated, tss: totals?.tss || w.tss };
    });
    const sessions = list.filter((w) => !isNote(w) && isRow(w) && Number(w.duration_minutes) > 0);
    const crossMinutes = list.filter((w) => !isNote(w) && isCross(w)).reduce((sum, w) => sum + Number(w.duration_minutes), 0);
    const longestOf = (from) => from.reduce((best, w) => Number(w.duration_minutes) > Number(best?.duration_minutes || 0) ? w : best, null);
    const long = target && target.long_session_minutes > 0 ? longestOf(sessions.filter((w) => /\blong\b/i.test(String(w.title || "")))) || longestOf(sessions) : null;
    if (long && target && Math.abs(Number(long.duration_minutes) - target.long_session_minutes) > Math.max(5, target.long_session_minutes * 0.05)) {
      const fitted = fitToMinutes(long.description, target.long_session_minutes);
      if (fitted) {
        long.description = fitted;
        const totals = itemTotals(long);
        long.duration_minutes = totals?.minutes || target.long_session_minutes;
        long.tss = totals?.tss || long.tss;
      }
    }
    const easy = sessions.filter((w) => w !== long && isEasyRow(w.description, input));
    const easyTotal = easy.reduce((sum, w) => sum + Number(w.duration_minutes), 0);
    const others = list.filter((w) => !isNote(w) && isRow(w) && !easy.includes(w)).reduce((sum, w) => sum + Number(w.duration_minutes), 0) + crossMinutes;
    const room = target && target.week_kind !== "b_race" ? Math.max(MIN_SESSION_MINUTES2, target.target_duration_minutes - others) : easyTotal;
    const longMinutes = long ? Number(long.duration_minutes) : Infinity;
    const minutes = Math.min(easyTotal, room, longMinutes * easy.length);
    let kept = easy;
    if (easy.length && easyTotal - minutes > Math.max(15, minutes * 0.1)) {
      kept = [...easy].sort((x, y) => Number(y.duration_minutes) - Number(x.duration_minutes));
      while (kept.length > 1 && minutes / kept.length < MIN_SESSION_MINUTES2) kept = kept.slice(0, -1);
      const each = toFive4(minutes / kept.length);
      kept.forEach((w) => {
        w.description = fitToMinutes(w.description, each) || easySteps4(each);
        const totals = itemTotals(w);
        w.duration_minutes = totals?.minutes || each;
        w.tss = totals?.tss || w.tss;
      });
    }
    if (target && target.week_kind !== "b_race" && kept.length) {
      const total = list.filter((w) => !isNote(w) && isRow(w) && (!easy.includes(w) || kept.includes(w))).reduce((sum, w) => sum + Number(w.duration_minutes), 0) + crossMinutes;
      const short = target.target_duration_minutes - total;
      if (short > target.target_duration_minutes * 0.15) {
        const cap = Number.isFinite(longMinutes) ? longMinutes : 90;
        kept.forEach((w) => {
          const each = Math.min(cap, toFive4(Number(w.duration_minutes) + short / kept.length));
          const fitted = each > Number(w.duration_minutes) ? fitToMinutes(w.description, each) : null;
          if (!fitted) return;
          w.description = fitted;
          const totals = itemTotals(w);
          w.duration_minutes = totals?.minutes || each;
          w.tss = totals?.tss || w.tss;
        });
      }
    }
    out[key] = settleRestNotes(list.filter((w) => !easy.includes(w) || kept.includes(w)));
    if (target && target.quality_sessions > 0 && ["lighter", "taper", "race_week"].includes(target.week_kind)) {
      const have = out[key].filter((w) => !isNote(w) && isRow(w) && hasRowHardSet(w.description, input)).length;
      const hosts = kept.filter((w) => w !== long && Number(w.duration_minutes) >= 40 && (!raceDate || !w.date || daysApart3(String(w.date).slice(0, 10), raceDate) >= 2)).sort((x, y) => Number(y.duration_minutes) - Number(x.duration_minutes)).slice(0, Math.max(0, target.quality_sessions - have));
      for (const host of hosts) {
        host.description = sharpSteps3(Number(host.duration_minutes));
        host.title = "Short hard pieces";
        const totals = itemTotals(host);
        host.duration_minutes = totals?.minutes || host.duration_minutes;
        host.tss = totals?.tss || host.tss;
      }
    }
  }
  return out;
}

// src/lib/triRacePlan.ts
var TRI_SPORTS = ["swim", "ride", "run"];
var TRI_RACE_RULES = {
  // growth 4%, maxRatio 1.4: extrapolated, Ride crit/TT (P7, P10 barely rise). lowBase 4 h up to 1.6: observed plans P7 L0 4 to 6.5 h, Brownlee 4 to 5 h; the floor is convention.
  // Peak 2 weeks out, taper 75/45%: extrapolated Ride short events / Run half; Mujika T08 8 to 14 days. defaultShare 30/40/30: convention (P6 25/35/25 + strength).
  // sessions 2/2/2 + brick: observed P9 2 bike 3 run, P7 L0 6 workouts; convention. longRide 1 h 30, longRun 60 min, longSwim 1,500 m: convention (P9 60 to 90 min and 45 to 60 min).
  // brick 15 to 20 min run off a ride from week 1: observed plans P9, P12; T22 1.7 to 2.3 bike-run a week. easyShare 80%: observed T03 80/11/9, elite T01 82/7/11. minWeeks 6: convention
  sprint: { label: "Sprint", raceType: "triathlon_sprint", duathlon: false, km: { swim: 0.75, ride: 20, run: 5 }, growth: 1.04, maxRatio: [[0, 1.4]], lowBaseHours: 4, lowBaseRatio: 1.6, taper: [0.75, 0.45], defaultShare: { swim: 0.3, ride: 0.4, run: 0.3 }, sessions: { swim: 2, ride: 2, run: 2 }, sessionsHighVolume: null, longRideTop: 1.5, longRideSplitShare: 0, longRunTop: 60, longSwimTop: 1500, brickRun: [15, 20], brickRunLate: null, brickSession: null, brickTwoLateWeeks: 0, racePaceRideShare: null, racePaceFromWeeksOut: 0, racePaceRun: null, racePaceBrickWeeksOut: 0, thresholdFromWeeksOut: 0, easyShare: 0.8, model: "polarised", minWeeks: 6 },
  // growth 4%, maxRatio 1.4: extrapolated (P10 6 to 8 h flat; T23 about 6 h flat for 5 weeks). lowBase 6 h up to 1.8: observed P10 6 to 8 h, P7 L0 4 to 7.5 h, T23 6.2 h, T24 short-course 8.5 h; convention.
  // Peak 2 weeks out: observed elite T01 (races every 2 to 4 weeks), extrapolated for amateurs. taper 75/45%: observed elite T01 about 0.6/0.6/0.4, T22 taper about 0.7 of competition hours; convention for the shares.
  // defaultShare 28/42/30: observed T23 27/43/27, T22 about 29/43/28, elite T26 30/45/25. sessions 3/3/3: observed T22 3.1/3.4/3.6, T23 2.2/3/2.7, T29 3/3/3.
  // longRide 2 h 30: convention (T23 longest 3:18 the only measurement). longRun 90 min / 16 km: extrapolated Run 10K rule. longSwim 2,500 m: convention (P5 novice 2,500 to 4,000 m).
  // brick 20 to 30 min off a ride from week 1, 2 a week in the last 8 weeks, at race intensity in the last 6: observed T22 1.7 to 2.3, elite T01 about 2 near VT2, T26 at threshold; T32 race intensity; no trial shows a gain. minWeeks 8: convention
  olympic: { label: "Olympic", raceType: "triathlon_olympic", duathlon: false, km: { swim: 1.5, ride: 40, run: 10 }, growth: 1.04, maxRatio: [[0, 1.4]], lowBaseHours: 6, lowBaseRatio: 1.8, taper: [0.75, 0.45], defaultShare: { swim: 0.28, ride: 0.42, run: 0.3 }, sessions: { swim: 3, ride: 3, run: 3 }, sessionsHighVolume: null, longRideTop: 2.5, longRideSplitShare: 0, longRunTop: 90, longSwimTop: 2500, brickRun: [20, 30], brickRunLate: null, brickSession: null, brickTwoLateWeeks: 8, racePaceRideShare: null, racePaceFromWeeksOut: 0, racePaceRun: null, racePaceBrickWeeksOut: 6, thresholdFromWeeksOut: 0, easyShare: 0.8, model: "polarised", minWeeks: 8 },
  // growth 5%: observed P2 x1.75 and P3 x1.6 over 16 weeks (3 to 3.5% a week), extrapolated to 5% as Ride fondo. maxRatio 1.6 from 8 h, 1.8 below: observed plans x1.6 to 1.75, T24 specific phase +21%.
  // lowBase 8 h up to 2.0: observed P7 L0 4 to 10 h, P8 base 7 to 12 h, T24 long-course 10.3 h, T03 about 13 h, T18 13.9 h; convention. Peak 3 weeks out: observed plans P2/P3 (peak weeks 17 to 18 of 20), T03 3-week taper.
  // taper 70/40%: extrapolated Ride fondo; observed P2/P3 about 0.75 then 0.3, T18 58% average cut, T08 41 to 60%. defaultShare 22/48/30: observed P3 20/54/26 at peak, T03 load 28/38/34 (about 23/48/29 of hours, calculated).
  // sessions 3/3/3, 4/4/4 from 14 h: observed P2, P3; T03 2.2/2.6/3.4 with a 4-run cap. longRide 4 h or 80% of the expected bike split: observed P2 3:30, P3 4:45, Laursen T09 4 to 6 h; the 80% is extrapolated from Ride fondo.
  // longRun 1 h 50 / 18 km: observed P2 1:50, P3 2:30. longSwim 3,000 m: observed P2 swim TT 2,050 to 2,150 yd, P5 3,000 to 4,000 m.
  // brick 1 a week, 1 h ride + 15 to 30 min run, longest 2 h 15: observed P2/P3, T03 almost every week. Threshold in all three sports from 15 weeks out, race-pace ride segments in the long ride from 8 weeks out: observed P2/P3.
  // easyShare 80%: observed T03. model pyramidal: observed 68/28/4 in long-course athletes (T02, T05, T06). minWeeks 12: convention (plans 16 to 20)
  half: { label: "70.3", raceType: "triathlon_half", duathlon: false, km: { swim: 1.9, ride: 90, run: 21.1 }, growth: 1.05, maxRatio: [[8, 1.6], [0, 1.8]], lowBaseHours: 8, lowBaseRatio: 2, taper: [0.7, 0.4], defaultShare: { swim: 0.22, ride: 0.48, run: 0.3 }, sessions: { swim: 3, ride: 3, run: 3 }, sessionsHighVolume: { from: 14, sessions: { swim: 4, ride: 4, run: 4 } }, longRideTop: 4, longRideSplitShare: 0.8, longRunTop: 110, longSwimTop: 3e3, brickRun: [15, 30], brickRunLate: null, brickSession: [75, 135], brickTwoLateWeeks: 0, racePaceRideShare: [0.2, 0.35], racePaceFromWeeksOut: 8, racePaceRun: null, racePaceBrickWeeksOut: 0, thresholdFromWeeksOut: 15, easyShare: 0.8, model: "pyramidal", minWeeks: 12 },
  // growth 5%: observed T02 load x1.57 to week 11 (4.6% a week), P1 about 6% from a 6 h start; extrapolated Run marathon. maxRatio 1.6 from 10 h, 2.0 from 6 to 10 h, 2.6 below: observed T02 x1.57, T01 x1.8, P1 x2.6; the steps extrapolated from the marathon's ratioByStartKm.
  // lowBase 10 h up to 2.5: observed T11 13.9 ± 5 h (n = 184; hours did not predict time, r = −0.09), T02 12.9 h, P13 mid-pack 12.5 h, P14 8 to 12 h; convention. Peak 3 weeks out: observed plans P1 week 17 of 20, P4; real athletes peaked 6 to 8 weeks out (T02).
  // taper 75/55/30%: observed T02 last three weeks 0.76/0.56/0.20 of peak, P1 about 0.7/0.5/0.15; extrapolated Run marathon 75/55/25; T08 41 to 60% cut, T28 exponential beats step.
  // defaultShare 20/50/30: observed T11 18/51/31 of hours, P7 20/51/30, P13 16/48/28, P1 20/50/30 at peak. sessions 3/3/3: observed P1, P6, P5 novice 2/3/3, P7.
  // longRide 6 h or 80% of the expected bike split: observed P4 5 to 6 h, P1 100 mi, P5 3 to 7 h by level; T16 longest ride predicts; extrapolated Ride fondo. longRun 3 h / 29 km: observed P4 2.5 to 3 h cap 3 h, P1 18 mi, P5 1.5 to 3 h.
  // longSwim 4,000 m: observed P1 4,000 m weeks 17 to 19, P5 3,500 to 4,500 m. brick 10 to 20 min run after the long ride from week 1, 30 to 45 in the last 8 weeks: observed P1 (from week 7), P4 15 min after each long ride, P5 45 to 60 min.
  // Long ride mostly at race intensity from 12 weeks out (55 to 67% of it): convention P4 Friel, P5 Laursen; the long run's race-effort segment 20 to 30 min: P4. easyShare 70%, pyramidal: observed T02 68/28/4, T05 68% zone 1, T06 69/25/6. minWeeks 12: P11
  ironman: { label: "Ironman", raceType: "triathlon_ironman", duathlon: false, km: { swim: 3.8, ride: 180, run: 42.2 }, growth: 1.05, maxRatio: [[10, 1.6], [6, 2], [0, 2.6]], lowBaseHours: 10, lowBaseRatio: 2.5, taper: [0.75, 0.55, 0.3], defaultShare: { swim: 0.2, ride: 0.5, run: 0.3 }, sessions: { swim: 3, ride: 3, run: 3 }, sessionsHighVolume: null, longRideTop: 6, longRideSplitShare: 0.8, longRunTop: 180, longSwimTop: 4e3, brickRun: [10, 20], brickRunLate: [30, 45], brickSession: null, brickTwoLateWeeks: 0, racePaceRideShare: [0.55, 0.67], racePaceFromWeeksOut: 12, racePaceRun: [20, 30], racePaceBrickWeeksOut: 0, thresholdFromWeeksOut: 0, easyShare: 0.7, model: "pyramidal", minWeeks: 12 },
  // Every duathlon figure is convention: no duathlon training study exists (T37 gives race time shares only, P12 one plan without hours). growth 4%, maxRatio 1.4, peak 2 weeks out, taper 75/45%: extrapolated from sprint tri.
  // lowBase 3.5 h up to 1.6: observed listings 2.5 to 5.5 h. defaultShare ride 45 / run 55: T37 short-course time shares 57% bike / 40% run, the run has two legs. sessions 3 rides / 3 runs + 1 run-ride-run brick: observed P12.
  // longRide 1 h 30, longRun 45 to 60 min: extrapolated from sprint tri. brick run-ride-run 50 to 75 minutes a week from week 1: observed P12. minWeeks 6
  du_sprint: { label: "Duathlon sprint", raceType: "duathlon_sprint", duathlon: true, km: { swim: 0, ride: 20, run: 7.5 }, growth: 1.04, maxRatio: [[0, 1.4]], lowBaseHours: 3.5, lowBaseRatio: 1.6, taper: [0.75, 0.45], defaultShare: { swim: 0, ride: 0.45, run: 0.55 }, sessions: { swim: 0, ride: 3, run: 3 }, sessionsHighVolume: null, longRideTop: 1.5, longRideSplitShare: 0, longRunTop: 60, longSwimTop: 0, brickRun: [10, 15], brickRunLate: null, brickSession: [50, 75], brickTwoLateWeeks: 0, racePaceRideShare: null, racePaceFromWeeksOut: 0, racePaceRun: null, racePaceBrickWeeksOut: 0, thresholdFromWeeksOut: 0, easyShare: 0.8, model: "polarised", minWeeks: 6 },
  // As duathlon sprint, extrapolated from Olympic: lowBase 5 h up to 1.8 (P12 gives no hours), defaultShare 50/50 (T37), longRide 2 h, longRun 75 to 90 min / 14 km, brick 60 to 90 minutes, minWeeks 8
  du_standard: { label: "Duathlon standard", raceType: "duathlon_standard", duathlon: true, km: { swim: 0, ride: 40, run: 15 }, growth: 1.04, maxRatio: [[0, 1.4]], lowBaseHours: 5, lowBaseRatio: 1.8, taper: [0.75, 0.45], defaultShare: { swim: 0, ride: 0.5, run: 0.5 }, sessions: { swim: 0, ride: 3, run: 3 }, sessionsHighVolume: null, longRideTop: 2, longRideSplitShare: 0, longRunTop: 90, longSwimTop: 0, brickRun: [15, 20], brickRunLate: null, brickSession: [60, 90], brickTwoLateWeeks: 0, racePaceRideShare: null, racePaceFromWeeksOut: 0, racePaceRun: null, racePaceBrickWeeksOut: 0, thresholdFromWeeksOut: 0, easyShare: 0.8, model: "polarised", minWeeks: 8 }
};
var TRI_RACE = {
  // Lighter week every 4th at 80%: observed T02 3:1, plans P1 to P3 weeks 4, 8, 12, 16; the 80% is convention from Run
  lighterEvery: 4,
  lighter: 0.8,
  // Hours follow load at this power, the long sessions' weekly rise and their share in a lighter week: as Ride and ski
  hoursPower: 0.9,
  longUp: 1.12,
  longLighter: 0.7,
  // The long run never above this share of the week's run time: extrapolated from the Run rule
  longRunMaxShare: 0.55,
  // The long ride never above this share of the week's ride time (convention, as the ski long session's share of the week)
  longRideMaxShare: 0.75,
  // The long sessions in the taper weeks, as a share of the longest built (the last taper week is race week, with none)
  longTaper: [0.65, 0.45, 0.35],
  // Hard sessions: one per sport in every week but a B race week; in the taper and race week one short quality session per sport (trial T28/T29: intensity kept; T08)
  qualityPerSport: 1,
  // Strength: 2 a week in the build, 1 a week in the last 4 weeks (trial T35 Millet 2002; observed T01, T03, T24 75% do 2 a week)
  strengthLoading: 2,
  strengthLastWeeks: 4,
  strengthLate: 1,
  // Bricks: 2 a week in the last 8 weeks where the rules say so (Olympic); the brick's run grows from the first figure to the second at the peak
  brickLateWeeks: 8,
  // The expected bike split when the race has a planned time: this share of it (observed T12: bike 349 of 691 min, 50.5%; T04 race shares 12/53/35). Without a planned time there is no split and the plain cap applies (Clive, 2026-11-06)
  bikeSplitShare: 0.5,
  bRace: { before: 0.9, week: 0.75, after: 0.8 },
  // The baseline window and what makes a sport count: at least a session a week and 10% of the hours
  lookbackDays: 28,
  sportMinSessionsPerWeek: 1,
  sportMinShare: 0.1
};
function triSportOfType(type, duathlon = false) {
  const t = String(type || "").trim();
  if (!duathlon && /^(Swim|OpenWaterSwim)$/i.test(t)) return "swim";
  if (/^(Ride|VirtualRide|GravelRide|MountainBikeRide)$/i.test(t)) return "ride";
  if (/^(Run|VirtualRun|TrailRun)$/i.test(t)) return "run";
  return null;
}
var round15 = (n) => Math.round(n * 10) / 10;
var toFive5 = (n) => Math.round(n / 5) * 5;
var toHundred = (n) => Math.round(n / 100) * 100;
var rulesOf5 = (race) => TRI_RACE_RULES[race] || TRI_RACE_RULES.olympic;
function triRaceOf(race, duathlon = false) {
  const name = String(race?.name || race?.title || "");
  const du = duathlon || /duathlon|powerman/i.test(name);
  if (du) {
    if (/sprint/i.test(name)) return "du_sprint";
    if (/standard|olympic|classic|\bod\b/i.test(name)) return "du_standard";
    return null;
  }
  if (/ironman|\bim\b|226|140\.6/i.test(name) && !/70\.3|half|middle|113|70,3/i.test(name)) return "ironman";
  if (/70\.3|70,3|\bhalf\b|middle|challenge half|\b113\b/i.test(name)) return "half";
  if (/olympic|standard|\bod\b|51\.5/i.test(name)) return "olympic";
  if (/sprint/i.test(name)) return "sprint";
  const km = Number(race?.distance || race?.distance_target || 0) / 1e3;
  if (!(km > 0)) return null;
  if (km >= 50 && km <= 53) return "olympic";
  if (km >= 110 && km <= 116) return "half";
  if (km >= 220 && km <= 230) return "ironman";
  return null;
}
function triLongRideTop(event, bikeSplitHours) {
  const R = rulesOf5(event);
  return R.longRideSplitShare > 0 && bikeSplitHours > 0 ? Math.min(R.longRideTop, round15(R.longRideSplitShare * bikeSplitHours)) : R.longRideTop;
}
function triBaselineFromActivities(activities, today = /* @__PURE__ */ new Date(), duathlon = false) {
  const from = today.getTime() - TRI_RACE.lookbackDays * 864e5;
  const weeks = TRI_RACE.lookbackDays / 7;
  const seen = /* @__PURE__ */ new Set();
  const bySport = { swim: [], ride: [], run: [] };
  for (const a of Array.isArray(activities) ? activities : []) {
    const sport = triSportOfType(a?.type, duathlon);
    const when = new Date(String(a?.start_date_local || "")).getTime();
    if (!sport || !(Number(a?.moving_time) > 0) || !(when >= from && when <= today.getTime())) continue;
    const key = `${a.start_date_local}|${Math.round(Number(a.distance) || 0)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bySport[sport].push(a);
  }
  const all = [...bySport.swim, ...bySport.ride, ...bySport.run];
  if (!all.length) return null;
  const totalSeconds = all.reduce((s, a) => s + Number(a.moving_time), 0);
  const sports = {};
  for (const sport of TRI_SPORTS) {
    const list = bySport[sport];
    const seconds = list.reduce((s, a) => s + Number(a.moving_time), 0);
    const tooLittle = list.length < TRI_RACE.sportMinSessionsPerWeek * weeks || seconds < TRI_RACE.sportMinShare * totalSeconds;
    sports[sport] = {
      hours: round15(seconds / 3600 / weeks),
      tss: Math.round(list.reduce((s, a) => s + (Number(a.icu_training_load) || 0), 0) / weeks),
      sessions: round15(list.length / weeks),
      longestHours: list.length ? round15(Math.max(...list.map((a) => Number(a.moving_time) || 0)) / 3600) : 0,
      ...tooLittle && !(duathlon && sport === "swim") ? { assumed: true } : {}
    };
  }
  return { tss: Math.round(all.reduce((s, a) => s + (Number(a.icu_training_load) || 0), 0) / weeks), hours: round15(totalSeconds / 3600 / weeks), sports };
}
function triRaceStart(event, baseline, fallbackHours = 6, fallbackTss) {
  const R = rulesOf5(event);
  const sportsOn = TRI_SPORTS.filter((s) => !(R.duathlon && s === "swim"));
  const sportHours = { swim: 0, ride: 0, run: 0 };
  const longest = { swim: 0, ride: 0, run: 0 };
  const assumed = [];
  if (!baseline) {
    for (const s of sportsOn) {
      sportHours[s] = round15(fallbackHours * R.defaultShare[s]);
      assumed.push(s);
    }
    return { tss: Math.round(fallbackTss ?? fallbackHours * 60), hours: round15(sportsOn.reduce((t, s) => t + sportHours[s], 0)), sportHours, assumed, longest };
  }
  const measured = sportsOn.filter((s) => !baseline.sports[s].assumed);
  const measuredHours = measured.reduce((t, s) => t + baseline.sports[s].hours, 0);
  const measuredTss = measured.reduce((t, s) => t + baseline.sports[s].tss, 0);
  const tssPerHour = measuredHours > 0 && measuredTss > 0 ? measuredTss / measuredHours : 60;
  const missingShare = sportsOn.filter((s) => baseline.sports[s].assumed).reduce((t, s) => t + R.defaultShare[s], 0);
  const total = measuredHours > 0 ? measuredHours : fallbackHours;
  for (const s of sportsOn) {
    const b = baseline.sports[s];
    if (b.assumed) {
      assumed.push(s);
      sportHours[s] = round15(total * R.defaultShare[s]);
    } else {
      sportHours[s] = measuredHours > 0 ? round15(b.hours * (1 - missingShare)) : round15(total * R.defaultShare[s]);
      longest[s] = b.longestHours;
    }
  }
  const hours = round15(sportsOn.reduce((t, s) => t + sportHours[s], 0));
  const tss = Math.round(measuredHours > 0 ? measuredTss : hours * tssPerHour);
  return { tss, hours, sportHours, assumed, longest };
}
function triSharesOf(sportHours) {
  const total = TRI_SPORTS.reduce((t, s) => t + Math.max(0, Number(sportHours[s]) || 0), 0);
  if (!(total > 0)) return { swim: 0, ride: 0.5, run: 0.5 };
  return { swim: Math.max(0, sportHours.swim || 0) / total, ride: Math.max(0, sportHours.ride || 0) / total, run: Math.max(0, sportHours.run || 0) / total };
}
function triMaxRatio(event, startHours) {
  const steps = rulesOf5(event).maxRatio;
  return (steps.find(([from]) => startHours >= from) || steps[steps.length - 1])[1];
}
function triRaceWeekTargets(input, baseWeeks) {
  const G = TRI_RACE;
  const R = rulesOf5(input.race);
  const N = Math.max(R.minWeeks, Math.round(Number(input.weeks) || 0));
  const S = Math.max(50, Number(input.start_tss) || 0);
  const H = Math.max(1, Number(input.start_hours) || 0);
  const days = Math.max(2, Math.min(7, Number(input.days) || 6));
  const lastDays = Math.round(Number(input.last_week_days) || 7);
  const strengthOn = input.strength !== false;
  const shares = triSharesOf(input.sport_hours || R.defaultShare);
  const peakWeek = N - R.taper.length;
  const normal = Math.min(triMaxRatio(input.race, H), Math.pow(R.growth, peakWeek - 1));
  const needed = Math.pow(R.lowBaseHours / H, 1 / G.hoursPower);
  const ratio = H < R.lowBaseHours && needed > normal ? Math.max(normal, Math.min(needed, R.lowBaseRatio, Math.pow(R.growth, peakWeek - 1))) : normal;
  const peak = S * ratio;
  const bWeeks = (input.b_race_weeks || []).filter((w) => w >= 1 && w <= peakWeek);
  const longRideTop = triLongRideTop(input.race, Number(input.bike_split_hours) || 0);
  const longRunTop = R.longRunTop / 60;
  const isLighter = (w) => w % G.lighterEvery === 0 && w < peakWeek;
  const startLongest = input.longest_hours || {};
  let rideBest = Math.max(0.75, Number(startLongest.ride) || H * shares.ride * 0.4);
  let runBest = Math.max(0.5, Number(startLongest.run) || H * shares.run * 0.4);
  const out = [];
  const between = (pair, share) => pair[0] + (pair[1] - pair[0]) * Math.max(0, Math.min(1, share));
  const progress = (w, firstWeek) => peakWeek > firstWeek ? (w - firstWeek) / (peakWeek - firstWeek) : 1;
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
      else if (isLighter(w)) {
        tss *= G.lighter;
        kind = "lighter";
      }
    }
    const hours = H * Math.pow(tss / S, G.hoursPower);
    const loading = kind === "build" || kind === "peak";
    const weeksOut = N - w;
    const taperIndex = w - peakWeek - 1;
    const longOf = (best, top, maxShare, sportHours) => {
      let long;
      let nextBest = best;
      if (w > peakWeek) long = w === N ? 0 : Math.min(top, best) * (G.longTaper[taperIndex] ?? G.longTaper[G.longTaper.length - 1]);
      else if (kind === "b_race") long = 0;
      else if (kind === "b_recovery") long = best * 0.5;
      else if (kind === "lighter") long = best * G.longLighter;
      else {
        long = Math.min(top, best * G.longUp);
        nextBest = Math.max(best, long);
      }
      return { long: Math.min(long, sportHours * maxShare), nextBest };
    };
    const rideH = hours * shares.ride;
    const runH = hours * shares.run;
    const swimH = hours * shares.swim;
    const ride = longOf(rideBest, longRideTop, G.longRideMaxShare, rideH);
    rideBest = ride.nextBest;
    const run = longOf(runBest, longRunTop, G.longRunMaxShare, runH);
    runBest = run.nextBest;
    const swimShare = Math.max(0.6, Math.min(1, tss / peak));
    const longSwim = R.longSwimTop > 0 && w !== N && kind !== "b_race" ? toHundred(R.longSwimTop * (w > peakWeek ? (G.longTaper[taperIndex] ?? 0.45) + 0.1 : swimShare)) : 0;
    const counts = R.sessionsHighVolume && round15(hours) >= R.sessionsHighVolume.from ? R.sessionsHighVolume.sessions : R.sessions;
    const late = weeksOut < G.brickLateWeeks;
    const bricks = kind === "b_race" || w === N ? 0 : R.brickTwoLateWeeks > 0 && weeksOut < R.brickTwoLateWeeks ? 2 : 1;
    const brickRunPair = late && R.brickRunLate ? R.brickRunLate : R.brickRun;
    const brickRun = bricks ? toFive5(between(brickRunPair, w > peakWeek ? 0 : progress(w, late && R.brickRunLate ? Math.max(1, N - G.brickLateWeeks) : 1))) : 0;
    const brickMinutes = bricks && R.brickSession ? toFive5(between(R.brickSession, w > peakWeek ? 0 : progress(w, 1))) : 0;
    const brickRacePace = bricks > 0 && R.racePaceBrickWeeksOut > 0 && weeksOut < R.racePaceBrickWeeksOut;
    const quality = kind === "b_race" ? 0 : G.qualityPerSport;
    const qualityKind = R.thresholdFromWeeksOut > 0 && weeksOut > R.thresholdFromWeeksOut ? "base" : "threshold";
    let racePaceRide = 0;
    let racePaceRun = 0;
    if (loading && R.racePaceFromWeeksOut > 0 && weeksOut <= R.racePaceFromWeeksOut) {
      const firstWeek = Math.max(1, N - R.racePaceFromWeeksOut);
      if (R.racePaceRideShare && ride.long > 0) racePaceRide = toFive5(ride.long * 60 * between(R.racePaceRideShare, progress(w, firstWeek)));
      if (R.racePaceRun && run.long > 0) racePaceRun = Math.min(toFive5(run.long * 60 * 0.5), toFive5(between(R.racePaceRun, progress(w, firstWeek))));
    }
    const strength = !strengthOn ? 0 : weeksOut < G.strengthLastWeeks ? G.strengthLate : loading ? G.strengthLoading : kind === "b_race" ? 0 : G.strengthLate;
    const base = baseWeeks?.find((b) => b.index === w) || baseWeeks?.[w - 1] || {};
    const share = w === N && lastDays >= 1 && lastDays < 7 ? lastDays / 7 : 1;
    const weekHours = round15(hours * share);
    const sessionsOf = (n) => w === N ? Math.max(n > 0 ? 1 : 0, Math.min(n, Math.ceil(n * lastDays / 7))) : n;
    out.push({
      index: w,
      startStr: base.startStr,
      endStr: base.endStr,
      startLabel: base.startLabel,
      endLabel: base.endLabel,
      phase: loading ? "load" : "recovery",
      target_tss: Math.round(tss * share),
      target_hours: weekHours,
      target_duration_minutes: Math.round(weekHours * 60),
      training_frequency: w === N ? Math.max(1, Math.min(days, lastDays)) : days,
      ceiling: true,
      week_kind: kind,
      swim_hours: round15(swimH * share),
      ride_hours: round15(rideH * share),
      run_hours: round15(runH * share),
      swim_sessions: R.duathlon ? 0 : sessionsOf(counts.swim),
      ride_sessions: sessionsOf(counts.ride),
      run_sessions: sessionsOf(counts.run),
      long_ride_minutes: toFive5(ride.long * 60),
      long_run_minutes: toFive5(run.long * 60),
      long_swim_metres: longSwim,
      brick_sessions: bricks,
      brick_run_minutes: brickRun,
      brick_minutes: brickMinutes,
      brick_race_pace: brickRacePace,
      quality_per_sport: quality,
      quality_kind: qualityKind,
      race_pace_ride_minutes: racePaceRide,
      race_pace_run_minutes: racePaceRun,
      strength_sessions: strength
    });
  }
  return out;
}
function triRacePromptRules(input) {
  const R = rulesOf5(input.race);
  const model = trainingModelOf(input.model);
  const dates = (input.b_race_dates || []).join(", ");
  const raceShare = Number(input.race_tss) > 0 ? ` Each race counts about ${Math.round(Number(input.race_tss))} TSS of its week's target_tss (the race is on the calendar, not in your answer); the training sessions you write make up the rest.` : "";
  const du = R.duathlon;
  const sports = du ? "ride and run" : "swim, ride and run";
  const easy = Math.round(R.easyShare * 100);
  const brick = du ? 'the brick is its own session of brick_minutes: run, ride, run (the runs each brick_run_minutes or less, the ride the rest), written as two or three workouts on the same day, "Brick" in each title' : R.brickSession ? 'the brick is its own session of brick_minutes: a ride, then brick_run_minutes of running straight off it, written as two workouts on the same day, "Brick" in both titles' : input.race === "ironman" ? `the brick is brick_run_minutes of easy running straight after the long ride, written as a Run workout on the long ride's day, "Brick" in its title` : `the brick is brick_run_minutes of running straight off one of the week's rides (not the long ride), written as a Run workout on that ride's day, "Brick" in both titles`;
  const racePace = [
    R.racePaceRideShare ? `when race_pace_ride_minutes is above 0, the long ride holds that many minutes at ${input.race === "ironman" ? "Ironman" : "70.3"} race intensity (${input.race === "ironman" ? "70 to 75% of FTP, Z2-Z3" : "80 to 85% of FTP, Z3"}) as ${input.race === "ironman" ? "2 or 3 long blocks" : "2 to 3 blocks of 15 to 20 minutes"}, the rest easy` : "",
    R.racePaceRun ? `when race_pace_run_minutes is above 0, the long run ends with that many minutes at race effort (Z3 Pace or HR)` : "",
    R.racePaceBrickWeeksOut ? `when brick_race_pace is true, the brick's ride and run are at race intensity (Z4), not easy` : ""
  ].filter(Boolean);
  const modelLine = model === "pyramidal" ? `
12. TRAINING MODEL: PYRAMIDAL (what real long-course athletes do: about 68% easy, 28% moderate, 4% hard). Each sport's hard session is a tempo or threshold session (Z3 to Z4), VO2 work only in the brick or as short strides; the easy share stays at ${easy}% or more.` : model === "ronnestad" ? `
12. TRAINING MODEL: R\xD8NNESTAD. Each hard session opens its intervals fast (the first minute harder, then settle), and the strength sessions are heavy (3 to 5 x 4 to 6 reps). Nothing else changes.` : `
12. TRAINING MODEL: POLARISED. Each sport's hard session is threshold or VO2 work (Z4 to Z5); everything else is easy (Z1 to Z2); the easy share stays at ${easy}% or more.`;
  return `
${du ? "DUATHLON" : "TRIATHLON"} ${R.label.toUpperCase()} PLAN (these rules outrank the load rules above where they differ):
Every week in 'WEEKS TO GENERATE' carries week_kind, swim_hours, ride_hours, run_hours, swim_sessions, ride_sessions, run_sessions, long_ride_minutes, long_run_minutes, long_swim_metres, brick_sessions, brick_run_minutes, brick_minutes, brick_race_pace, quality_per_sport, quality_kind, race_pace_ride_minutes, race_pace_run_minutes and strength_sessions. The code has set these. Follow them.
1. HOURS PER SPORT: the week's ${sports} sessions add up to swim_hours, ride_hours and run_hours (each within 10%). A brick's ride counts as ride time and its run as run time. Never move one sport's hours into another.
2. SESSIONS: write exactly swim_sessions "type": "Swim" sessions, ride_sessions "type": "Ride" sessions and run_sessions "type": "Run" sessions (a brick's ride and run count among them); strength is extra. A rest day is a note (category NOTE), never a workout.
3. LONG SESSIONS: when long_ride_minutes is above 0, one ride is the long ride of exactly that length, easy (Z2) apart from rule 7; when long_run_minutes is above 0, one run is the long run of exactly that length, easy apart from rule 7, never on the day before or the day of the long ride unless it is the brick${R.longSwimTop ? `; when long_swim_metres is above 0, one swim is the long swim of that many metres, easy and steady` : ""}. Never make them longer, and never move the week's spare minutes into them.
4. BRICKS: write exactly brick_sessions brick${du ? "s" : "s"} that week; ${brick}. When brick_sessions is 0, none.
5. HARD SESSIONS: write exactly quality_per_sport hard session in each sport that week, on two intensive days (two sports' hard sessions may share a day, morning and afternoon; the third on the other day), never two hard days in a row and never the day before the long ride. quality_kind "threshold": a tempo, threshold or VO2 set (ride 3 x 10 to 12 minutes at 95 to 100% of FTP or 5 x 4 minutes at 110 to 115%; run 3 x 8 to 10 minutes at threshold pace or 5 x 4 minutes at 5K effort${du ? "" : "; swim 10 x 200 or 5 x 400 at threshold pace with 20 to 30 seconds rest"}). quality_kind "base": strides, hills and ${du ? "cadence" : "technique"} work only (6 to 10 x 20 to 30 seconds fast with full recovery inside an easy session). In a lighter, taper or race week the hard session is short (4 x 3 minutes at Z4), in race week 3 to 4 days before the race.
6. EASY: at least ${easy}% of the week's time is easy, Z1 to Z2. Easy means easy in every sport.
7. RACE PACE: ${racePace.length ? racePace.join("; ") : "no race-pace blocks; the hard sessions and the brick carry the intensity"}.${racePace.length ? " The race-pace block stays inside the long session, not a third hard session." : ""}
8. STRENGTH: write exactly strength_sessions sessions of whole-body strength that week ("type": "WeightTraining", 40 to 50 minutes: squat or leg press, hip hinge, single-leg work, trunk, pull; sets x reps at RPE, never a weight), on a day with an easy session or a rest day, never the day before a hard session or the long ride; when it is 0, none.
9. STEPS: every step line starts with "- " and holds a time written like 40m, 1h30m or 90s, never in words such as "40 minutes", and a target: rides in % of FTP or power zones ("- 20m 70%", "- 40m Z2"), runs in pace zones or % Pace ("- 40m Z2 Pace", "- 8m 100% Pace")${du ? "" : `, swims in TIME with pace zones ("- 20m Z2 Pace", "- 4m Z4 Pace" in a repeat), never in metres as the step: the swim's metres go in its title ("Swim 2,500 m: ...") and its sets in words in the description's first line`}. Repeats use a header line such as "5x" with a blank line before and after. A session with no such step lines is wrong.
10. PROGRESS: never copy a week. Each loading week must differ from the same week of the block before it, in reps, rep length or terrain.
11. RACE WEEK: the race itself is on the calendar and is never written as a workout. Short openers the day before are fine: 20 to 30 minutes easy in one or two sports with 3 x 1 minute at Z4.${modelLine}${dates ? `
13. B RACES: ${dates} ${input.b_race_dates && input.b_race_dates.length > 1 ? "are races" : "is a race"} on the calendar, the plan's tune-up races. Never write a race as a workout, never add a race, and write nothing hard in the 2 days before one or the day after it.${raceShare}` : `
13. TUNE-UP RACES: the plan never adds a race; a B race already on the calendar is the tune-up.`}
`;
}
var EASY_TOP_PCT5 = 75;
var MIN_SESSION_MINUTES3 = 30;
function easySteps5(minutes, sport) {
  const z = sport === "ride" ? "" : " Pace";
  const edges = minutes >= 60 ? [10, 10] : [5, 5];
  const main2 = Math.max(5, Math.round(minutes) - edges[0] - edges[1]);
  return `- Warmup ${edges[0]}m Z1${z}
- ${main2}m Z2${z}
- Cooldown ${edges[1]}m Z1${z}`;
}
function sharpSteps4(minutes, sport) {
  const z = sport === "ride" ? "" : " Pace";
  const rest = Math.max(5, Math.round(minutes) - 10 - 24 - 5);
  return `- Warmup 10m Z1${z}

4x
- 3m Z4${z}
- 3m Z1${z}

- ${rest}m Z2${z}
- Cooldown 5m Z1${z}`;
}
var triSportOfItem = (w) => {
  const t = String(w?.type || "");
  if (/swim/i.test(t)) return "swim";
  if (/ride|bike|cycl/i.test(t)) return "ride";
  if (/run/i.test(t)) return "run";
  return null;
};
function hasTriHardSet(description) {
  let s = 0;
  for (const step of parseSteps(description)) if ((step.pct ?? 0) >= 82 && step.seconds > 30) s += step.seconds * (step.inRepeat ? step.repeats : 1);
  return s >= 12 * 60;
}
var daysApart4 = (from, to) => Math.round(((/* @__PURE__ */ new Date(to + "T12:00:00Z")).getTime() - (/* @__PURE__ */ new Date(from + "T12:00:00Z")).getTime()) / 864e5);
function swimMetresToMinutes(description, statedMinutes) {
  const lines = String(description || "").split("\n");
  const metreLine = /^(\s*-\s*(?:[A-Za-z ]+?\s+)?)(\d{2,5})m\b/;
  let repeats = 1;
  let metres = 0;
  const parsed = lines.map((raw) => {
    const text = raw.trim();
    if (!text) {
      repeats = 1;
      return null;
    }
    const header = /^(\d+)x\s*\{?$/i.exec(text);
    if (header) {
      repeats = Math.max(1, Number(header[1]));
      return null;
    }
    const m = metreLine.exec(raw);
    if (!m || Number(m[2]) < 50) return null;
    if (repeats > 1 && /^[-\s]*(cool\s*down|warm\s*up)/i.test(text)) repeats = 1;
    metres += Number(m[2]) * repeats;
    return { m, repeats };
  });
  if (!metres) return description;
  const minutesPerMetre = statedMinutes > 0 ? statedMinutes / metres : 1 / 50;
  return lines.map((raw, i) => {
    const hit = parsed[i];
    if (!hit) return raw;
    const minutes = Math.max(1, Math.round(Number(hit.m[2]) * minutesPerMetre));
    return raw.replace(hit.m[0], hit.m[1] + minutes + "m");
  }).join("\n");
}
function reconcileTriRaceWeeks(weeks, targets, bRaceDates = [], raceDate = "") {
  const out = {};
  const isNote = (w) => String(w?.category || "").toUpperCase() === "NOTE";
  for (const key of Object.keys(weeks || {})) {
    const target = targets.find((t) => t.index === Number(key));
    const list = (Array.isArray(weeks[key]) ? weeks[key] : []).filter((w) => {
      const date = String(w?.date || "").slice(0, 10);
      if (isNote(w)) return true;
      if (raceDate && date === raceDate) return false;
      if (/opener|activation|shake|prime/i.test(String(w?.title || ""))) return true;
      return !(bRaceDates.includes(date) && /\brace\b|triathlon|duathlon|ironman|70\.3/i.test(`${w?.title || ""} ${w?.description || ""}`));
    }).map((w) => {
      if (isNote(w)) return w;
      const sport = triSportOfItem(w);
      if (!sport) return parseSteps(String(w?.description || "")).length || /weight|strength|yoga|core|mobility/i.test(String(w?.type || "")) ? w : { ...w, category: "NOTE", duration_minutes: 0, tss: 0 };
      const stated = Number(w.duration_minutes) || 0;
      if (!(stated > 0) && !parseSteps(String(w.description || "")).length) return { ...w, category: "NOTE", duration_minutes: 0, tss: 0 };
      const raw = sport === "swim" ? swimMetresToMinutes(String(w.description || ""), stated) : String(w.description || "");
      const text = raw.split("\n").filter((line) => !/^\s*-.*\b(0[ms]|\d+ms)\b/.test(line)).join("\n");
      const readable = parseSteps(sanitizeWorkoutDescription(text, w.type)).length > 0;
      const description = readable ? text : easySteps5(stated, sport);
      const totals = itemTotals({ ...w, description });
      const hardTitle = /interval|threshold|vo2|tempo|race|sprint|hill|effort|max|brick/i.test(String(w.title || ""));
      return { ...w, ...readable || !hardTitle ? {} : { title: `Easy ${sport}` }, description, duration_minutes: totals?.minutes || stated, tss: totals?.tss || w.tss };
    });
    const longestOf = (from) => from.reduce((best, w) => Number(w.duration_minutes) > Number(best?.duration_minutes || 0) ? w : best, null);
    const fit = (w, minutes) => {
      const fitted = fitToMinutes(w.description, minutes);
      if (!fitted) return;
      w.description = fitted;
      const totals = itemTotals(w);
      w.duration_minutes = totals?.minutes || minutes;
      w.tss = totals?.tss || w.tss;
    };
    const dropped = /* @__PURE__ */ new Set();
    for (const sport of TRI_SPORTS) {
      const sessions = list.filter((w) => !isNote(w) && triSportOfItem(w) === sport && Number(w.duration_minutes) > 0);
      if (!sessions.length) continue;
      const longMinutes = !target ? 0 : sport === "ride" ? target.long_ride_minutes : sport === "run" ? target.long_run_minutes : 0;
      const long = longMinutes > 0 ? longestOf(sessions.filter((w) => /\blong\b/i.test(String(w.title || "")))) || longestOf(sessions) : null;
      if (long && Math.abs(Number(long.duration_minutes) - longMinutes) > Math.max(5, longMinutes * 0.05)) fit(long, longMinutes);
      const sportMinutes = !target ? 0 : Math.round((sport === "ride" ? target.ride_hours : sport === "run" ? target.run_hours : target.swim_hours) * 60);
      const easy = sessions.filter((w) => w !== long && parseSteps(w.description).every((step) => step.pct === null || step.pct <= EASY_TOP_PCT5 || step.seconds <= 30));
      const easyTotal = easy.reduce((sum, w) => sum + Number(w.duration_minutes), 0);
      const others = sessions.filter((w) => !easy.includes(w)).reduce((sum, w) => sum + Number(w.duration_minutes), 0);
      const room = target && target.week_kind !== "b_race" && sportMinutes > 0 ? Math.max(MIN_SESSION_MINUTES3, sportMinutes - others) : easyTotal;
      const cap = long ? Number(long.duration_minutes) : Infinity;
      const minutes = Math.min(easyTotal, room, cap * easy.length);
      let kept = easy;
      if (easy.length && easyTotal - minutes > Math.max(15, minutes * 0.1)) {
        kept = [...easy].sort((x, y) => Number(y.duration_minutes) - Number(x.duration_minutes));
        while (kept.length > 1 && minutes / kept.length < MIN_SESSION_MINUTES3) kept = kept.slice(0, -1);
        const each = toFive5(minutes / kept.length);
        kept.forEach((w) => {
          w.description = fitToMinutes(w.description, each) || easySteps5(each, sport);
          const totals = itemTotals(w);
          w.duration_minutes = totals?.minutes || each;
          w.tss = totals?.tss || w.tss;
        });
        easy.filter((w) => !kept.includes(w)).forEach((w) => dropped.add(w));
      }
      if (target && target.week_kind !== "b_race" && sportMinutes > 0 && kept.length) {
        const total = sessions.filter((w) => !dropped.has(w)).reduce((sum, w) => sum + Number(w.duration_minutes), 0);
        const short = sportMinutes - total;
        if (short > sportMinutes * 0.15) {
          const top = Number.isFinite(cap) ? cap : 90;
          kept.forEach((w) => {
            const each = Math.min(top, toFive5(Number(w.duration_minutes) + short / kept.length));
            if (each > Number(w.duration_minutes)) fit(w, each);
          });
        }
      }
      if (target && target.quality_per_sport > 0 && ["lighter", "taper", "race_week"].includes(target.week_kind)) {
        const have = sessions.filter((w) => !dropped.has(w) && hasTriHardSet(w.description)).length;
        const hosts = kept.filter((w) => w !== long && Number(w.duration_minutes) >= 40 && (!raceDate || !w.date || daysApart4(String(w.date).slice(0, 10), raceDate) >= 3)).sort((x, y) => Number(y.duration_minutes) - Number(x.duration_minutes)).slice(0, Math.max(0, target.quality_per_sport - have));
        for (const host of hosts) {
          host.description = sharpSteps4(Number(host.duration_minutes), sport);
          host.title = `Short hard efforts (${sport})`;
          const totals = itemTotals(host);
          host.duration_minutes = totals?.minutes || host.duration_minutes;
          host.tss = totals?.tss || host.tss;
        }
      }
    }
    out[key] = settleRestNotes(list.filter((w) => !dropped.has(w)));
  }
  return out;
}

// src/lib/raceLoadEstimate.ts
var RACE_LOAD = {
  lthrShareOfMax: 0.9,
  ski: { "10k": 0.91, "15k": 0.91, "30k": 0.9, marathon: 0.89, long: 0.82 },
  row: { "2k": 0.94, head: 0.93, half: 0.85, marathon: 0.8 },
  // Typical lengths: a 2000 m in about 7 min, a head race about 21 min (Penichet-Tomás 2024), a half marathon about 1 h 30, a marathon about 3 h 10
  rowHours: { "2k": 0.12, head: 0.35, half: 1.5, marathon: 3.2 },
  tri: {
    sprint: { swim: 0.92, ride: 0.94, run: 0.92 },
    olympic: { swim: 0.9, ride: 0.91, run: 0.91 },
    half: { swim: 0.91, ride: 0.85, run: 0.84 },
    ironman: { swim: 0.92, ride: 0.78, run: 0.77 },
    du_sprint: { swim: 0, ride: 0.94, run: 0.94 },
    du_standard: { swim: 0, ride: 0.86, run: 0.93 }
  },
  // Typical leg hours: Olympic from Aoyagi 2021 (26 / 71 / 43 min), 70.3 from Baillot 2015 (47 / 175 / 109 min), Ironman from
  // Barrero 2015 (63 / 417 / 257 min), sprint about 15 / 40 / 25 min, duathlon sprint 5 / 20 / 2.5 km about 21 + 10 min of running and
  // 36 min of riding, duathlon standard from Donaldson 2024 (42 + 21 min of running, 65 min of riding)
  triHours: {
    sprint: { swim: 0.25, ride: 0.67, run: 0.42 },
    olympic: { swim: 0.44, ride: 1.18, run: 0.72 },
    half: { swim: 0.78, ride: 2.92, run: 1.82 },
    ironman: { swim: 1.05, ride: 6.95, run: 4.29 },
    du_sprint: { swim: 0, ride: 0.6, run: 0.52 },
    du_standard: { swim: 0, ride: 1.08, run: 1.05 }
  }
};
var round16 = (n) => Math.round(n * 10) / 10;
var raceLoadGiven = (race) => Number(race?.load ?? race?.icu_training_load ?? race?.tss ?? race?.target_tss ?? race?.planned_load ?? 0) > 0;
function hrIntensity(share, hr) {
  const lthr = Number(hr?.lthr), maxHr = Number(hr?.maxHr);
  const anchored = lthr > 0 && maxHr > 0 && lthr <= maxHr;
  const IF = anchored ? share * maxHr / lthr : share / RACE_LOAD.lthrShareOfMax;
  return { IF: Math.round(IF * 1e3) / 1e3, raceHr: anchored ? Math.round(share * maxHr) : null, lthr: anchored ? lthr : null, fallback: !anchored };
}
function raceLoadSportOf(race, fallback) {
  const name = String(race?.name || race?.title || "");
  if (/triathlon|duathlon|ironman|70\.3|powerman/i.test(name)) return "tri";
  const type = String(race?.type || race?.sport || "");
  if (/ride|bike|cycl/i.test(type)) return "ride";
  if (/run/i.test(type)) return "run";
  if (/ski/i.test(type)) return "ski";
  if (/row/i.test(type)) return "row";
  if (/swim/i.test(type)) return null;
  return fallback ?? null;
}
var hrPart = (label, profile, hours, share, hr) => {
  const i = hrIntensity(share, hr);
  return { label, profile, hours: round16(hours), hrShare: share, pacePct: null, IF: i.IF, raceHr: i.raceHr, lthr: i.lthr, fallback: i.fallback, tss: Math.round(hours * i.IF * i.IF * 100) };
};
function estimateRaceLoad(race, ctx) {
  const sport = raceLoadSportOf(race, ctx.sport);
  if (!sport) return null;
  const seconds = Number(race?.moving_time || 0);
  const ownHours = seconds > 0 ? seconds / 3600 : null;
  const planEvent = ctx.sport === sport ? ctx.event : null;
  if (sport === "ride") {
    const found2 = rideEventOf(race);
    const event2 = found2 && found2 !== "other" ? found2 : planEvent;
    const share = event2 ? RIDE_RACE.raceHrShare[event2] : void 0;
    if (!event2 || !share) return null;
    const hours = ownHours ?? rideEventHours(race, event2) ?? RIDE_RACE_RULES[event2].eventHours;
    const part = hrPart(RIDE_RACE_RULES[event2].label, "ride", hours, share, ctx.anchorsFor("ride"));
    return { sport, event: event2, label: part.label, hours: part.hours, tss: part.tss, parts: [part] };
  }
  if (sport === "run") {
    const found2 = raceDistanceOf(race);
    const distance = found2 && found2 !== "other" ? found2 : planEvent;
    const kmh = Number(ctx.runThresholdKmh);
    if (!distance || !RUN_RACE_RULES[distance]) return null;
    const pct = racePacePercent(distance, kmh > 0 ? kmh : null);
    const IF = pct / 100;
    const hours = ownHours ?? (kmh > 0 ? RUN_RACE_RULES[distance].km / (kmh * IF) : null);
    if (!(Number(hours) > 0)) return null;
    const part = { label: RUN_RACE_RULES[distance].label, profile: "run", hours: round16(hours), hrShare: null, pacePct: pct, IF, raceHr: null, lthr: null, fallback: false, tss: Math.round(hours * IF * IF * 100) };
    return { sport, event: distance, label: part.label, hours: part.hours, tss: part.tss, parts: [part] };
  }
  if (sport === "ski") {
    const found2 = skiDistanceOf(race);
    const distance = found2 && found2 !== "other" ? found2 : planEvent;
    const share = distance ? RACE_LOAD.ski[distance] : void 0;
    if (!distance || !share) return null;
    const hours = ownHours ?? skiEventHours(race, distance);
    if (!(Number(hours) > 0)) return null;
    const labels2 = { "10k": "10 km ski", "15k": "15 km ski", "30k": "30 km ski", marathon: "ski marathon", long: "long-distance ski" };
    const part = hrPart(labels2[distance], "nordic_ski", hours, share, ctx.anchorsFor("nordic_ski"));
    return { sport, event: distance, label: part.label, hours: part.hours, tss: part.tss, parts: [part] };
  }
  if (sport === "row") {
    const found2 = rowRaceOf(race);
    const event2 = found2 && found2 !== "other" ? found2 : planEvent;
    const share = event2 ? RACE_LOAD.row[event2] : void 0;
    if (!event2 || !share) return null;
    const hours = ownHours ?? RACE_LOAD.rowHours[event2];
    const labels2 = { "2k": "2000 m row", head: "head race", half: "half marathon row", marathon: "marathon row" };
    const part = hrPart(labels2[event2], "rowing", hours, share, ctx.anchorsFor("rowing"));
    return { sport, event: event2, label: part.label, hours: part.hours, tss: part.tss, parts: [part] };
  }
  const found = triRaceOf(race);
  const event = found && found !== "other" ? found : planEvent;
  if (!event || !RACE_LOAD.tri[event]) return null;
  const typical = RACE_LOAD.triHours[event];
  const typicalTotal = typical.swim + typical.ride + typical.run;
  const scale = ownHours && typicalTotal > 0 ? ownHours / typicalTotal : 1;
  const legLabel = { swim: "swim", ride: "bike", run: "run" };
  const legProfile = { swim: "swim", ride: "ride", run: "run" };
  const parts = [];
  for (const leg of ["swim", "ride", "run"]) {
    const share = RACE_LOAD.tri[event][leg];
    const hours = typical[leg] * scale;
    if (!share || !(hours > 0)) continue;
    parts.push(hrPart(legLabel[leg], legProfile[leg], hours, share, ctx.anchorsFor(legProfile[leg])));
  }
  if (!parts.length) return null;
  const labels = { sprint: "sprint triathlon", olympic: "Olympic triathlon", half: "70.3", ironman: "Ironman", du_sprint: "sprint duathlon", du_standard: "standard duathlon" };
  return { sport, event, label: labels[event], hours: round16(parts.reduce((a, p) => a + p.hours, 0)), tss: parts.reduce((a, p) => a + p.tss, 0), parts };
}

// entry.ts
var USAGE = `Montis race plans (Run: marathon, half, 10k, 5k, 50k, 100k; Ride: crit, road, tt, cx, xc, fondo, gravel; Nordic ski: 10k, 15k, 30k, marathon, long;
Triathlon: sprint, olympic, half, ironman, du_sprint, du_standard; Rowing: 2k, head, half, marathon)
  node race_plan.mjs rules                                   every sport's constants and rule tables
  node race_plan.mjs models                                  the training models (theme, polarised, pyramidal, ronnestad, singles) and their rules
  node race_plan.mjs detect '<raceJSON>' [duathlon]          what the race is, for every sport (name, distance, moving_time)
  node race_plan.mjs run-baseline '<activitiesJSON>' [YYYY-MM-DD]
  node race_plan.mjs ride-baseline '<activitiesJSON>' [YYYY-MM-DD]
  node race_plan.mjs ski-baseline '<activitiesJSON>' [YYYY-MM-DD]
  node race_plan.mjs row-baseline '<activitiesJSON>' [YYYY-MM-DD]   (also row-anchors: the best 2k and 5k on record)
  node race_plan.mjs tri-baseline '<activitiesJSON>' [YYYY-MM-DD] [duathlon]
  node race_plan.mjs tri-start <event> '<triBaselineJSON>' [fallbackHours] [fallbackTss]
  node race_plan.mjs run-pace marathon|half|10k|5k|50k|100k [thresholdKmh]
  node race_plan.mjs run-weeks|ride-weeks|ski-weeks|row-weeks|tri-weeks '<inputJSON>' ['<baseWeeksJSON>']
  node race_plan.mjs run-prompt '<runInputJSON>' [PACE|HR|POWER]
  node race_plan.mjs ride-prompt|ski-prompt|row-prompt|tri-prompt '<inputJSON>'
  node race_plan.mjs run-reconcile '<weeksJSON>' '<targetsJSON>' [PACE|HR|POWER] ['<bRaceDatesJSON>'] [raceDate] [distance]
  node race_plan.mjs ride-reconcile '<weeksJSON>' '<targetsJSON>' ['<bRaceDatesJSON>'] [raceDate] [model] ['<offDatesJSON>']
  node race_plan.mjs ski-reconcile '<weeksJSON>' '<targetsJSON>' ['<bRaceDatesJSON>'] [raceDate]
  node race_plan.mjs row-reconcile '<weeksJSON>' '<targetsJSON>' ['<bRaceDatesJSON>'] [raceDate] ['<rowInputJSON>']
  node race_plan.mjs tri-reconcile '<weeksJSON>' '<targetsJSON>' ['<bRaceDatesJSON>'] [raceDate]
  node race_plan.mjs race-load '<raceJSON>' '<contextJSON>'    the load a race counts when the calendar gives none
      context: { sport, event, anchors: { ride: { lthr, maxHr }, run: {...}, swim: {...}, nordic_ski: {...}, rowing: {...} }, runThresholdKmh }
A race season (Ride, Run, ski, rowing): three or more races inside the plan; put "season": true and every other race's week and date in
b_race_weeks and b_race_dates of the week input, and race_tss from race-load. A JSON argument can be @path (a file) or - (stdin).`;
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
  const [cmd, a, b, c, d, e, f] = argv;
  const out = (value) => process.stdout.write((typeof value === "string" ? value : JSON.stringify(value, null, 2)) + "\n");
  switch (cmd) {
    case "rules":
      return out({ run: { ...RUN_RACE, rules: RUN_RACE_RULES }, ride: { ...RIDE_RACE, rules: RIDE_RACE_RULES }, ski: { ...SKI_RACE, rules: SKI_RACE_RULES }, row: { ...ROW_RACE, rules: ROW_RACE_RULES }, tri: { ...TRI_RACE, rules: TRI_RACE_RULES }, race_load: RACE_LOAD });
    case "models":
      return out(Object.fromEntries(TRAINING_MODELS.map((m) => [m, trainingModelPreset(m)])));
    case "detect": {
      const race = arg(a, {});
      const duathlon = String(b || "").toLowerCase() === "duathlon";
      const event = rideEventOf(race);
      return out({ sport: raceLoadSportOf(race, null), run_distance: raceDistanceOf(race), ride_event: event, ride_event_hours: event && event !== "other" ? rideEventHours(race, event) : null, ski_distance: skiDistanceOf(race), ski_event_hours: skiEventHours(race, skiDistanceOf(race) && skiDistanceOf(race) !== "other" ? skiDistanceOf(race) : null), row_race: rowRaceOf(race), tri_race: triRaceOf(race, duathlon) });
    }
    case "run-baseline":
      return out(runBaselineFromActivities(activitiesOf(arg(a, [])), b ? /* @__PURE__ */ new Date(`${b}T12:00:00`) : /* @__PURE__ */ new Date()));
    case "ride-baseline":
      return out(rideBaselineFromActivities(activitiesOf(arg(a, [])), b ? /* @__PURE__ */ new Date(`${b}T12:00:00`) : /* @__PURE__ */ new Date()));
    case "ski-baseline":
      return out(skiBaselineFromActivities(activitiesOf(arg(a, [])), b ? /* @__PURE__ */ new Date(`${b}T12:00:00`) : /* @__PURE__ */ new Date()));
    case "row-baseline":
      return out(rowBaselineFromActivities(activitiesOf(arg(a, [])), b ? /* @__PURE__ */ new Date(`${b}T12:00:00`) : /* @__PURE__ */ new Date()));
    case "row-anchors":
      return out(rowAnchorsFromActivities(activitiesOf(arg(a, [])), b ? /* @__PURE__ */ new Date(`${b}T12:00:00`) : /* @__PURE__ */ new Date()));
    case "tri-baseline":
      return out(triBaselineFromActivities(activitiesOf(arg(a, [])), b ? /* @__PURE__ */ new Date(`${b}T12:00:00`) : /* @__PURE__ */ new Date(), String(c || "").toLowerCase() === "duathlon"));
    case "tri-start":
      return out(triRaceStart(a, arg(b, null), c ? Number(c) : 6, d ? Number(d) : void 0));
    case "run-pace":
      return out({ pace_percent: racePacePercent(a, b ? Number(b) : null) });
    case "run-weeks":
      return out(runRaceWeekTargets(arg(a), arg(b)));
    case "ride-weeks":
      return out(rideRaceWeekTargets(arg(a), arg(b)));
    case "ski-weeks":
      return out(skiRaceWeekTargets(arg(a), arg(b)));
    case "row-weeks":
      return out(rowRaceWeekTargets(arg(a), arg(b)));
    case "tri-weeks":
      return out(triRaceWeekTargets(arg(a), arg(b)));
    case "run-prompt": {
      const input = arg(a);
      return out(runStepSyntax(b || "PACE", input) + "\n" + runRacePromptRules(input, b || "PACE"));
    }
    case "ride-prompt":
      return out(rideRacePromptRules(arg(a)));
    case "ski-prompt":
      return out(skiRacePromptRules(arg(a)));
    case "row-prompt":
      return out(rowRacePromptRules(arg(a)));
    case "tri-prompt":
      return out(triRacePromptRules(arg(a)));
    case "run-reconcile":
      return out(reconcileRunRaceWeeks(arg(a), arg(b), c || "PACE", arg(d, []), e || "", f || void 0));
    case "ride-reconcile":
      return out(reconcileRideRaceWeeks(arg(a), arg(b), arg(c, []), d || "", e || void 0, void 0, [], arg(f, [])));
    case "ski-reconcile":
      return out(reconcileSkiRaceWeeks(arg(a), arg(b), arg(c, []), d || ""));
    case "row-reconcile":
      return out(reconcileRowRaceWeeks(arg(a), arg(b), arg(c, []), d || "", arg(e, null)));
    case "tri-reconcile":
      return out(reconcileTriRaceWeeks(arg(a), arg(b), arg(c, []), d || ""));
    case "race-load": {
      const race = arg(a, {});
      const ctx = arg(b, {}) || {};
      const anchors = ctx.anchors || {};
      return out({ given: raceLoadGiven(race), estimate: estimateRaceLoad(race, { sport: ctx.sport ?? null, event: ctx.event ?? null, anchorsFor: (p) => anchors[p] || {}, runThresholdKmh: ctx.runThresholdKmh ?? null }) });
    }
    default:
      return out(USAGE);
  }
}
var self = String(process.argv[1] || "").replace(/\\/g, "/").split("/").pop();
if (self && import.meta.url.endsWith(self)) main(process.argv.slice(2));
export {
  RACE_LOAD,
  RIDE_RACE,
  RIDE_RACE_RULES,
  ROW_RACE,
  ROW_RACE_RULES,
  RUN_RACE,
  RUN_RACE_RULES,
  SKI_RACE,
  SKI_RACE_RULES,
  TRAINING_MODELS,
  TRI_RACE,
  TRI_RACE_RULES,
  activitiesOf,
  compressedPeakingGate,
  estimateRaceLoad,
  hrIntensity,
  raceDistanceOf,
  raceLoadGiven,
  raceLoadSportOf,
  racePacePercent,
  reconcileRideRaceWeeks,
  reconcileRowRaceWeeks,
  reconcileRunRaceWeeks,
  reconcileSkiRaceWeeks,
  reconcileTriRaceWeeks,
  rideBaselineFromActivities,
  rideEventHours,
  rideEventOf,
  rideRaceEstimateDetail,
  rideRacePromptRules,
  rideRaceTssEstimate,
  rideRaceWeekTargets,
  rowAnchorsFromActivities,
  rowBaselineFromActivities,
  rowRaceOf,
  rowRacePromptRules,
  rowRaceWeekTargets,
  runBaselineFromActivities,
  runMetricOf,
  runRacePromptRules,
  runRaceWeekTargets,
  runStepSyntax,
  skiBaselineFromActivities,
  skiDistanceOf,
  skiEventHours,
  skiRacePromptRules,
  skiRaceWeekTargets,
  trainingModelPreset,
  triBaselineFromActivities,
  triRaceOf,
  triRacePromptRules,
  triRaceStart,
  triRaceWeekTargets
};
