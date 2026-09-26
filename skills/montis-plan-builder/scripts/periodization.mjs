/**
 * Montis plan-builder deterministic helpers — verbatim port of the Montis engine
 * functions used by AI Builder v2:
 *   - calculateDeterministicWeekTargets  (weekly TSS/hours ramp, block + recovery)
 *   - harmonizeGeneratedWorkoutsToWeeklyTargets  (±3% weekly reconciliation)
 *   - sanitizeWorkoutDescription  (Intervals.icu DSL cleanup)
 *
 * Dependency-free. Run with Node 18+, or import the functions.
 *
 * CLI:
 *   node periodization.mjs targets '<loadConstraintsJSON>' '<theme>' ['<baseWeeksJSON>']
 *   node periodization.mjs harmonize '<weeksRecordJSON>' '<targetsJSON>'
 *   node periodization.mjs sanitize '<sportType>'   # description on stdin
 */

export function calculateDeterministicWeekTargets(loadConstraints, theme = "MAINTAIN", baseWeeks) {
  const totalWeeks = Math.max(1, Math.min(24, Number(loadConstraints.duration_weeks) || (baseWeeks && baseWeeks.length) || 8));

  let loadingWeeks = 3;
  let recoveryWeeks = 1;
  const cycleStr = String(loadConstraints.block_cycle || "3:1").trim();
  const match = cycleStr.match(/^(\d+)[:/](\d+)$/);
  if (match) {
    loadingWeeks = Math.max(1, parseInt(match[1], 10));
    recoveryWeeks = Math.max(1, parseInt(match[2], 10));
  }
  const cycleLen = loadingWeeks + recoveryWeeks;

  const startTss = Math.max(50, Math.round(Number(loadConstraints.starting_tss) || 350));
  const targetHours = Math.max(1, Math.round((Number(loadConstraints.weekly_target_hours) || 8) * 10) / 10);
  const freq = Math.max(2, Math.min(7, Number(loadConstraints.training_frequency) || 4));

  const w2Growth = Number(loadConstraints.load_progression_limits?.week_2_growth_pct ?? 6);
  const w3Growth = Number(loadConstraints.load_progression_limits?.week_3_growth_pct ?? 6);
  const recoveryReductPct = Math.min(60, Math.max(15, Math.abs(Number(loadConstraints.recovery_week_reduction ?? 40))));

  const upperTheme = String(theme || "").toUpperCase();
  const isMaintain = upperTheme.includes("MAINTAIN") || upperTheme.includes("STABILIZE") || upperTheme.includes("CONSISTENCY");
  const isBuild = upperTheme.includes("BUILD") || upperTheme.includes("PROGRESS");

  const results = [];

  for (let i = 0; i < totalWeeks; i++) {
    const weekIdx = i + 1;
    const cyclePos = i % cycleLen;
    const cycleNum = Math.floor(i / cycleLen);
    const isRecoveryWeek = cyclePos >= loadingWeeks;

    const baseInfo = (baseWeeks && (baseWeeks.find(w => w.index === weekIdx) || baseWeeks[i])) || {};

    let tss = startTss;
    let hours = targetHours;

    if (!isRecoveryWeek) {
      if (isMaintain) {
        if (cyclePos === 0) { tss = startTss; hours = targetHours; }
        else if (cyclePos === 1) { tss = Math.round(startTss * (1 + w2Growth / 100)); hours = targetHours; }
        else if (cyclePos === 2) {
          const w2Tss = Math.round(startTss * (1 + w2Growth / 100));
          tss = Math.round(w2Tss * (1 + w3Growth / 100));
          hours = Math.round((targetHours * 1.03) * 10) / 10;
        } else {
          const prevTss = results[results.length - 1]?.target_tss || startTss;
          tss = Math.round(prevTss * (1 + w3Growth / 100));
          hours = Math.round((targetHours * 1.04) * 10) / 10;
        }
      } else if (isBuild) {
        const blockBaseTss = cycleNum === 0 ? startTss : Math.round(startTss * Math.pow(1.04, cycleNum));
        const blockBaseHours = cycleNum === 0 ? targetHours : Math.round((targetHours * Math.pow(1.03, cycleNum)) * 10) / 10;
        if (cyclePos === 0) { tss = blockBaseTss; hours = blockBaseHours; }
        else if (cyclePos === 1) {
          tss = Math.round(blockBaseTss * (1 + w2Growth / 100));
          hours = Math.round((blockBaseHours * (1 + (w2Growth / 100) * 0.4)) * 10) / 10;
        } else if (cyclePos === 2) {
          const w2Tss = Math.round(blockBaseTss * (1 + w2Growth / 100));
          tss = Math.round(w2Tss * (1 + w3Growth / 100));
          hours = Math.round((blockBaseHours * (1 + ((w2Growth + w3Growth) / 100) * 0.4)) * 10) / 10;
        } else {
          const prevTss = results[results.length - 1]?.target_tss || blockBaseTss;
          tss = Math.round(prevTss * (1 + w3Growth / 100));
          hours = Math.round((blockBaseHours * 1.08) * 10) / 10;
        }
      } else {
        if (cyclePos === 0) { tss = startTss; hours = targetHours; }
        else if (cyclePos === 1) {
          tss = Math.round(startTss * (1 + w2Growth / 100));
          hours = Math.round((targetHours * (1 + (w2Growth / 100) * 0.3)) * 10) / 10;
        } else {
          const prevTss = results[results.length - 1]?.target_tss || startTss;
          tss = Math.round(prevTss * (1 + w3Growth / 100));
          hours = Math.round((targetHours * 1.04) * 10) / 10;
        }
      }
    } else {
      const prevTss = results[results.length - 1]?.target_tss || startTss;
      tss = Math.round(prevTss * (1 - recoveryReductPct / 100));
      hours = Math.round((targetHours * (1 - (recoveryReductPct / 100) * 0.75)) * 10) / 10;
    }

    results.push({
      index: weekIdx,
      startStr: baseInfo.startStr,
      endStr: baseInfo.endStr,
      startLabel: baseInfo.startLabel,
      endLabel: baseInfo.endLabel,
      phase: isRecoveryWeek ? "recovery" : "load",
      target_tss: tss,
      target_hours: hours,
      target_duration_minutes: Math.round(hours * 60),
      training_frequency: freq,
    });
  }

  return results;
}

export function harmonizeGeneratedWorkoutsToWeeklyTargets(generatedWeeksRecord, targets) {
  const result = {};
  const targetMap = new Map();
  targets.forEach(t => targetMap.set(t.index, t));

  Object.keys(generatedWeeksRecord).forEach(weekKeyStr => {
    const weekIdx = parseInt(weekKeyStr, 10);
    const workouts = (generatedWeeksRecord[weekIdx] || []).map(w => ({ ...w }));
    const target = targetMap.get(weekIdx);

    if (!target || workouts.length === 0) { result[weekIdx] = workouts; return; }

    const currentTotalTss = workouts.reduce((acc, w) => acc + (Number(w.tss) || 0), 0);
    const currentTotalMins = workouts.reduce((acc, w) => acc + (Number(w.duration_minutes) || 0), 0);

    const tssDiff = target.target_tss - currentTotalTss;
    const minsDiff = target.target_duration_minutes - currentTotalMins;

    if (Math.abs(tssDiff) <= Math.max(5, target.target_tss * 0.03) && Math.abs(minsDiff) <= 15) {
      result[weekIdx] = workouts; return;
    }

    let bestIndex = -1;
    let maxDuration = -1;
    workouts.forEach((w, idx) => {
      const title = String(w.title || "").toLowerCase();
      const desc = String(w.description || "").toLowerCase();
      const isIntervalQuality = title.includes("interval") || title.includes("threshold") || title.includes("vo2") || desc.includes("main set") || desc.includes("repeat");
      if (!isIntervalQuality && (Number(w.duration_minutes) || 0) > maxDuration) {
        maxDuration = Number(w.duration_minutes) || 0;
        bestIndex = idx;
      }
    });

    if (bestIndex === -1) {
      workouts.forEach((w, idx) => {
        if ((Number(w.duration_minutes) || 0) > maxDuration) {
          maxDuration = Number(w.duration_minutes) || 0;
          bestIndex = idx;
        }
      });
    }

    if (bestIndex !== -1) {
      const targetSession = workouts[bestIndex];
      const origTss = Number(targetSession.tss) || 50;
      const origMins = Number(targetSession.duration_minutes) || 60;
      targetSession.tss = Math.max(20, origTss + tssDiff);
      targetSession.duration_minutes = Math.max(30, origMins + minsDiff);

      if (typeof targetSession.description === "string" && targetSession.description.trim()) {
        const steadyMatch = targetSession.description.match(/- (\d+)m (\d+)%/);
        if (steadyMatch && !targetSession.description.includes("Main Set")) {
          const currM = parseInt(steadyMatch[1], 10);
          const adjustedM = Math.max(20, currM + minsDiff);
          targetSession.description = targetSession.description.replace(
            `- ${currM}m ${steadyMatch[2]}%`,
            `- ${adjustedM}m ${steadyMatch[2]}%`
          );
        }
      }
    }

    result[weekIdx] = workouts;
  });

  return result;
}

export function sanitizeWorkoutDescription(raw, sportType) {
  if (!raw || typeof raw !== "string") return "";

  let cleaned = raw
    .replace(/^```[a-zA-Z0-9_-]*\n?/gm, "")
    .replace(/\n?```$/gm, "")
    .replace(/\r\n/g, "\n");

  cleaned = cleaned
    .replace(/\s*\(\s*~?\s*\d+(?:\.\d+)?\s*(?:w|watts|bpm|lthr|%|rpm|w\/kg)?\s*\)/gi, "")
    .replace(/\s*\(\s*(?:zone|z)\s*\d+\s*\)/gi, "");

  const st = (sportType || "").toLowerCase();
  const isNonCardio = st.includes("weighttraining") || st.includes("strength") || st.includes("yoga") ||
    st.includes("core") || st.includes("stretch") || st.includes("mobility") || st.includes("pilates");

  if (isNonCardio) {
    const lines = cleaned.split("\n");
    const resultLines = [];
    for (let l of lines) {
      const trimmed = l.trimEnd();
      if (!trimmed.trim()) {
        if (resultLines.length > 0 && resultLines[resultLines.length - 1] !== "") resultLines.push("");
        continue;
      }
      resultLines.push(trimmed);
    }
    while (resultLines.length > 0 && resultLines[resultLines.length - 1] === "") resultLines.pop();
    return resultLines.join("\n");
  }

  const isCycling = !sportType || st.includes("ride") || st.includes("bike") || st.includes("cycling");
  if (isCycling) cleaned = cleaned.replace(/(\d+)%\s*FTP\b/gi, "$1%");
  cleaned = cleaned.replace(/(\d+(?:-\d+)?%)\s+\d+\s*(?:w|watts)\b/gi, "$1");

  const lines = cleaned.split("\n");
  const resultLines = [];
  let inRepeatBlock = false;

  for (let idx = 0; idx < lines.length; idx++) {
    let line = lines[idx].trim();
    if (!line) {
      if (resultLines.length > 0 && resultLines[resultLines.length - 1] !== "") resultLines.push("");
      inRepeatBlock = false;
      continue;
    }

    const headerWithoutDash = line.replace(/^[-\s]+/, "").trim();
    const isRepeatHeaderOnly = /^(?:Main Set\s+)?\d+x\s*\{?$/i.test(headerWithoutDash) || /^Set\s+\w+\s+\d+x\s*\{?$/i.test(headerWithoutDash);
    if (isRepeatHeaderOnly) {
      if (resultLines.length > 0 && resultLines[resultLines.length - 1] !== "") resultLines.push("");
      let headerText = headerWithoutDash;
      if (!headerText.startsWith("Main Set") && !/^\d+x\s*\{?$/i.test(headerText) && !/^Set\s+/i.test(headerText)) headerText = `Main Set ${headerText}`;
      resultLines.push(headerText);
      inRepeatBlock = true;
      continue;
    }

    const inlineRepeatMatch = line.match(/^(?:-\s*)?((?:Main Set\s+)?\d+x)\s+(?:-\s*)?(.*)/i);
    if (inlineRepeatMatch) {
      let headerText = inlineRepeatMatch[1].trim();
      if (!headerText.startsWith("Main Set") && !/^\d+x$/i.test(headerText) && !/^Set\s+/i.test(headerText)) headerText = `Main Set ${headerText}`;
      let stepText = inlineRepeatMatch[2].trim();
      if (resultLines.length > 0 && resultLines[resultLines.length - 1] !== "") resultLines.push("");
      resultLines.push(headerText);
      inRepeatBlock = true;
      if (stepText) {
        if (!stepText.startsWith("-")) stepText = `- ${stepText}`;
        if (isCycling) stepText = stepText.replace(/(\d+)%\s*FTP\b/gi, "$1%");
        resultLines.push(stepText);
      }
      continue;
    }

    const lowerLine = line.toLowerCase();
    if (inRepeatBlock && (lowerLine.startsWith("cooldown") || lowerLine.startsWith("- cooldown") || lowerLine.startsWith("warmup") || lowerLine.startsWith("- warmup"))) {
      if (resultLines.length > 0 && resultLines[resultLines.length - 1] !== "") resultLines.push("");
      inRepeatBlock = false;
    }

    let content = line.replace(/^-\s*/, "").trim();
    if (isCycling) content = content.replace(/(\d+)%\s*FTP\b/gi, "$1%");
    resultLines.push(`- ${content}`);
  }

  const finalLines = [];
  for (const l of resultLines) {
    if (l === "" && (finalLines.length === 0 || finalLines[finalLines.length - 1] === "")) continue;
    finalLines.push(l);
  }
  while (finalLines.length > 0 && finalLines[finalLines.length - 1] === "") finalLines.pop();
  return finalLines.join("\n");
}

// --- CLI ---
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , cmd, a, b, c] = process.argv;
  const readStdin = () => new Promise(res => { let s = ""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => res(s)); });
  if (cmd === "targets") {
    const targets = calculateDeterministicWeekTargets(JSON.parse(a || "{}"), b || "MAINTAIN", c ? JSON.parse(c) : undefined);
    console.log(JSON.stringify(targets, null, 2));
  } else if (cmd === "harmonize") {
    console.log(JSON.stringify(harmonizeGeneratedWorkoutsToWeeklyTargets(JSON.parse(a || "{}"), JSON.parse(b || "[]")), null, 2));
  } else if (cmd === "sanitize") {
    readStdin().then(txt => console.log(sanitizeWorkoutDescription(txt, a || "")));
  } else {
    console.error("usage: targets|harmonize|sanitize (see file header)");
    process.exit(1);
  }
}
