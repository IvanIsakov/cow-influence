const fs = require("node:fs");
const path = require("node:path");

const COW_COUNT = 50;
const BASE_POWER = 1;
const MAX_ENERGY = 1;
const STEPS = 1000;
const REPEATS = 1;
const DEFAULT_INTENSITY = 0.18;

const ranges = {
  forgetfulness: [0, 0.5],
  tiredness: [0, 0.5],
  recovery: [0, 0.2],
  groupSize: [2, 14],
  propensity: [0, 1],
};

function increments([min, max], mapper = (value) => value) {
  return Array.from({ length: 6 }, (_, index) => mapper(min + ((max - min) * index) / 5));
}

const grid = {
  forgetfulness: increments(ranges.forgetfulness, round3),
  tiredness: increments(ranges.tiredness, round3),
  recovery: increments(ranges.recovery, round3),
  groupSize: increments(ranges.groupSize, Math.round),
  propensity: increments(ranges.propensity, round2),
};

function runSweep() {
  const outputDir = __dirname;
  const rows = [];
  let simulationIndex = 0;

  for (const mode of ["random", "habit"]) {
    for (let forgetIndex = 0; forgetIndex < grid.forgetfulness.length; forgetIndex += 1) {
      for (let tiredIndex = 0; tiredIndex < grid.tiredness.length; tiredIndex += 1) {
        for (let recoveryIndex = 0; recoveryIndex < grid.recovery.length; recoveryIndex += 1) {
          for (let groupIndex = 0; groupIndex < grid.groupSize.length; groupIndex += 1) {
            const forgetfulness = grid.forgetfulness[forgetIndex];
            const tiredness = grid.tiredness[tiredIndex];
            const recovery = grid.recovery[recoveryIndex];
            const groupSize = grid.groupSize[groupIndex];
            const propensity = mode === "habit"
              ? grid.propensity[(forgetIndex + tiredIndex + recoveryIndex + groupIndex) % grid.propensity.length]
              : 0;
              const metrics = [];
              for (let repeat = 0; repeat < REPEATS; repeat += 1) {
                const seed = seedFromParams({
                  mode,
                  forgetfulness,
                  tiredness,
                  recovery,
                  groupSize,
                  propensity,
                  repeat,
                });
                metrics.push(
                  simulate({
                    seed,
                    mode,
                    forgetfulness,
                    tiredness,
                    recovery,
                    intensity: DEFAULT_INTENSITY,
                    groupSize,
                    propensity,
                  })
                );
                simulationIndex += 1;
              }
              rows.push({
                mode,
                forgetfulness,
                tiredness,
                recovery,
                intensity: DEFAULT_INTENSITY,
                groupSize,
                propensity,
                repeats: REPEATS,
                ...averageMetrics(metrics),
              });
          }
        }
      }
    }
  }

  rows.sort((a, b) => a.oligarchyScore - b.oligarchyScore);
  const intensityLabel = String(DEFAULT_INTENSITY).replace(".", "-");
  const csvPath = path.join(outputDir, `sweep-results-noactivity-intensity-${intensityLabel}.csv`);
  const reportPath = path.join(outputDir, `sweep-report-noactivity-intensity-${intensityLabel}.html`);
  fs.writeFileSync(csvPath, toCsv(rows));
  fs.writeFileSync(reportPath, reportHtml(rows, simulationIndex));

  const best = rows.slice(0, 12);
  console.log(`Simulations run: ${simulationIndex}`);
  console.log(`Rows written: ${rows.length}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`Report: ${reportPath}`);
  console.table(
    best.map((row) => ({
      mode: row.mode,
      forget: row.forgetfulness,
      tired: row.tiredness,
      recovery: row.recovery,
      group: row.groupSize,
      prop: row.propensity,
      top5: `${row.top5SharePct.toFixed(1)}%`,
      stab20: `${row.top10Stability20Pct.toFixed(1)}%`,
      score: row.oligarchyScore.toFixed(2),
    }))
  );
}

function simulate(params) {
  const rng = mulberry32(params.seed);
  const cows = Array.from({ length: COW_COUNT }, (_, id) => ({
    id,
    power: BASE_POWER,
    energy: MAX_ENERGY,
    collaborations: 0,
  }));
  const events = [];
  const topTenHistory = [topIds(cows, 10)];

  for (let time = 1; time <= STEPS; time += 1) {
    for (const cow of cows) {
      cow.power = BASE_POWER + (cow.power - BASE_POWER) * Math.exp(-params.forgetfulness);
      cow.energy = Math.min(MAX_ENERGY, cow.energy + params.recovery);
    }

    const participantIds = params.mode === "habit"
      ? chooseHabitParticipants(cows, events, params, rng)
      : chooseRandomParticipants(cows, params, rng);

    applyEvent(cows, events, participantIds, params, time);
    topTenHistory.push(topIds(cows, 10));
    if (topTenHistory.length > 21) {
      topTenHistory.shift();
    }
  }

  const totalPower = cows.reduce((sum, cow) => sum + cow.power, 0);
  const topFivePower = topIds(cows, 5).reduce((sum, id) => sum + cows[id].power, 0);
  const currentTopTen = topTenHistory[topTenHistory.length - 1];
  const runaway = !Number.isFinite(totalPower) || !Number.isFinite(topFivePower);
  const top5SharePct = runaway ? 100 : (topFivePower / totalPower) * 100;
  const stability1 = overlapPct(currentTopTen, snapshotAgo(topTenHistory, 1));
  const stability10 = overlapPct(currentTopTen, snapshotAgo(topTenHistory, 10));
  const stability20 = overlapPct(currentTopTen, snapshotAgo(topTenHistory, 20));

  return {
    runaway: runaway ? 1 : 0,
    top5SharePct,
    top10Stability1Pct: stability1,
    top10Stability10Pct: stability10,
    top10Stability20Pct: stability20,
    totalPower: runaway ? Number.MAX_VALUE : totalPower,
    oligarchyScore: top5SharePct + stability20 * 0.35 + (runaway ? 100 : 0),
  };
}

function chooseRandomParticipants(cows, params, rng) {
  const weighted = cows.map((cow) => participantCandidate(cow, 0, 1));
  return chooseWeightedGroup(weighted, params.groupSize, rng);
}

function chooseHabitParticipants(cows, events, params, rng) {
  const ids = [];
  const seed = weightedPick(
    cows.map((cow) => participantCandidate(cow, 0, 1 - params.propensity)),
    rng
  );
  if (seed === null) {
    return ids;
  }
  ids.push(seed);

  while (ids.length < params.groupSize) {
    const candidates = cows
      .filter((cow) => !ids.includes(cow.id))
      .map((cow) => participantCandidate(
        cow,
        recentPartnerScore(cow.id, ids, events) * params.propensity,
        1 - params.propensity
      ));
    const picked = weightedPick(candidates, rng);
    if (picked === null) {
      break;
    }
    ids.push(picked);
  }
  return ids;
}

function participantCandidate(cow, partnerAffinity, curiosity) {
  const energyGate = Math.pow(cow.energy, 2.4);
  return {
    id: cow.id,
    weight: energyGate * (0.08 + curiosity + Math.sqrt(cow.power) * 0.05 + partnerAffinity),
  };
}

function chooseWeightedGroup(candidates, size, rng) {
  const pool = candidates.slice();
  const ids = [];
  while (ids.length < size && pool.length) {
    const picked = weightedPick(pool, rng);
    if (picked === null) {
      break;
    }
    ids.push(picked);
    const index = pool.findIndex((item) => item.id === picked);
    pool.splice(index, 1);
  }
  return ids;
}

function weightedPick(candidates, rng) {
  const available = candidates.filter((item) => item.weight > 0.0001);
  if (!available.length) {
    return null;
  }
  const total = available.reduce((sum, item) => sum + item.weight, 0);
  let pick = rng() * total;
  const selected = available.find((item) => {
    pick -= item.weight;
    return pick <= 0;
  });
  return (selected || available[available.length - 1]).id;
}

function recentPartnerScore(candidateId, selectedIds, events) {
  let score = 0;
  for (const event of events.slice(0, 5)) {
    if (!event.participants.includes(candidateId)) {
      continue;
    }
    score += selectedIds.filter((id) => event.participants.includes(id)).length;
  }
  return score;
}

function applyEvent(cows, events, participantIds, params, time) {
  const uniqueIds = [...new Set(participantIds)].filter((id) => cows[id]);
  if (uniqueIds.length < 2) {
    return;
  }
  const powersBefore = new Map(uniqueIds.map((id) => [id, cows[id].power]));
  const gains = new Map();

  for (const id of uniqueIds) {
    const cow = cows[id];
    const collaboratorPower = uniqueIds.reduce((sum, collaboratorId) => {
      return collaboratorId === id ? sum : sum + powersBefore.get(collaboratorId);
    }, 0);
    gains.set(id, params.intensity * cow.energy * collaboratorPower);
  }

  for (const id of uniqueIds) {
    const cow = cows[id];
    cow.power += gains.get(id);
    cow.energy = Math.max(0.05, cow.energy - params.tiredness);
    cow.collaborations += 1;
  }

  events.unshift({ time, source: params.mode, participants: uniqueIds });
  if (events.length > 36) {
    events.length = 36;
  }
}

function topIds(cows, count) {
  return cows
    .slice()
    .sort((a, b) => b.power - a.power)
    .slice(0, count)
    .map((cow) => cow.id);
}

function snapshotAgo(history, stepsAgo) {
  const index = Math.max(0, history.length - 1 - stepsAgo);
  return history[index];
}

function overlapPct(current, past) {
  const currentSet = new Set(current);
  return (past.filter((id) => currentSet.has(id)).length / current.length) * 100;
}

function averageMetrics(metrics) {
  const keys = Object.keys(metrics[0]);
  const averaged = {};
  for (const key of keys) {
    averaged[key] = metrics.reduce((sum, metric) => sum + metric[key], 0) / metrics.length;
  }
  return averaged;
}

function toCsv(rows) {
  const columns = [
    "mode",
    "forgetfulness",
    "tiredness",
    "recovery",
    "intensity",
    "groupSize",
    "propensity",
    "repeats",
    "runaway",
    "top5SharePct",
    "top10Stability1Pct",
    "top10Stability10Pct",
    "top10Stability20Pct",
    "totalPower",
    "oligarchyScore",
  ];
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\n");
}

function csvCell(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(6);
  }
  return `"${String(value).replaceAll('"', '""')}"`;
}

function reportHtml(rows, simulationCount) {
  const bestRows = rows.slice(0, 40);
  const byMode = groupBy(rows, "mode").map(([mode, modeRows]) => summarizeGroup(mode, modeRows));
  const byGroupSize = groupBy(rows, "groupSize").map(([groupSize, groupRows]) => summarizeGroup(groupSize, groupRows));
  const byTiredness = groupBy(rows, "tiredness").map(([tiredness, tiredRows]) => summarizeGroup(tiredness, tiredRows));
  const scatterRows = rows.filter((_, index) => index % Math.max(1, Math.floor(rows.length / 900)) === 0);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cow Influence Sweep Report</title>
  <style>
    body { margin: 0; font-family: Inter, system-ui, sans-serif; color: #24231f; background: #f8f5ec; }
    main { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 48px; }
    h1 { margin: 0 0 6px; font-size: 2rem; }
    h2 { margin-top: 34px; font-size: 1.05rem; text-transform: uppercase; }
    p { color: #6b665d; line-height: 1.45; }
    table { width: 100%; border-collapse: collapse; background: #fffdf7; border: 1px solid #d9d1c0; }
    th, td { padding: 8px 9px; border-bottom: 1px solid #e5decf; text-align: right; font-size: 0.88rem; }
    th:first-child, td:first-child { text-align: left; }
    th { background: #efe7d6; position: sticky; top: 0; }
    .cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 20px 0; }
    .card { border: 1px solid #d9d1c0; background: #fffdf7; border-radius: 8px; padding: 14px; }
    .card span { display: block; color: #6b665d; font-size: 0.8rem; }
    .card strong { display: block; margin-top: 6px; font-size: 1.35rem; }
    .bars { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
    .bar-row { display: grid; grid-template-columns: 64px 1fr 62px; gap: 8px; align-items: center; margin: 8px 0; }
    .track { height: 12px; background: #e9dfcd; border-radius: 999px; overflow: hidden; }
    .fill { height: 100%; background: #287a78; }
    svg { width: 100%; height: auto; border: 1px solid #d9d1c0; background: #fffdf7; }
    circle.random { fill: #287a78; opacity: 0.58; }
    circle.habit { fill: #c45c43; opacity: 0.58; }
    @media (max-width: 850px) { .cards { grid-template-columns: 1fr 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>Cow Influence Sweep Report</h1>
    <p>${simulationCount.toLocaleString()} simulations, ${STEPS} steps each, ${REPEATS} seeded repeats per parameter row. Intensity held at ${DEFAULT_INTENSITY} for this screening sweep. Runaway rows are regimes where power overflowed and are penalized in the score.</p>
    <div class="cards">
      <div class="card"><span>Parameter rows</span><strong>${rows.length.toLocaleString()}</strong></div>
      <div class="card"><span>Best top 5 share</span><strong>${bestRows[0].top5SharePct.toFixed(1)}%</strong></div>
      <div class="card"><span>Best 20-step stability</span><strong>${bestRows[0].top10Stability20Pct.toFixed(1)}%</strong></div>
      <div class="card"><span>Runaway rows</span><strong>${rows.filter((row) => row.runaway >= 0.5).length}</strong></div>
    </div>

    <h2>Outcome Scatter</h2>
    <p>Lower-left is less oligarchic: low top 5 share and low long-term top 10 stability.</p>
    ${scatterSvg(scatterRows)}

    <h2>Best Low-Oligarchy Parameter Rows</h2>
    ${table(bestRows)}

    <h2>Mode Summary</h2>
    ${summaryBars(byMode)}

    <h2>Group Size Summary</h2>
    ${summaryBars(byGroupSize)}

    <h2>Tiredness Summary</h2>
    ${summaryBars(byTiredness)}
  </main>
</body>
</html>`;
}

function table(rows) {
  return `<table>
    <thead><tr><th>mode</th><th>forget</th><th>tired</th><th>recovery</th><th>group</th><th>propensity</th><th>runaway</th><th>top 5</th><th>stab 1</th><th>stab 10</th><th>stab 20</th><th>score</th></tr></thead>
    <tbody>
      ${rows.map((row) => `<tr>
        <td>${row.mode}</td>
        <td>${row.forgetfulness}</td>
        <td>${row.tiredness}</td>
        <td>${row.recovery}</td>
        <td>${row.groupSize}</td>
        <td>${row.propensity}</td>
        <td>${row.runaway >= 0.5 ? "yes" : "no"}</td>
        <td>${row.top5SharePct.toFixed(1)}%</td>
        <td>${row.top10Stability1Pct.toFixed(1)}%</td>
        <td>${row.top10Stability10Pct.toFixed(1)}%</td>
        <td>${row.top10Stability20Pct.toFixed(1)}%</td>
        <td>${row.oligarchyScore.toFixed(2)}</td>
      </tr>`).join("")}
    </tbody>
  </table>`;
}

function summaryBars(groups) {
  const max = Math.max(...groups.map((group) => group.top5SharePct));
  return `<div class="bars">
    ${groups.map((group) => `<div class="card">
      <strong>${group.label}</strong>
      <div class="bar-row"><span>top 5</span><div class="track"><div class="fill" style="width:${(group.top5SharePct / max) * 100}%"></div></div><span>${group.top5SharePct.toFixed(1)}%</span></div>
      <div class="bar-row"><span>stab20</span><div class="track"><div class="fill" style="width:${group.top10Stability20Pct}%"></div></div><span>${group.top10Stability20Pct.toFixed(1)}%</span></div>
    </div>`).join("")}
  </div>`;
}

function scatterSvg(rows) {
  const width = 920;
  const height = 420;
  const pad = 48;
  const x = (value) => pad + (value / 100) * (width - pad * 2);
  const y = (value) => height - pad - (value / 100) * (height - pad * 2);
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Top 5 share versus top 10 stability scatter">
    <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#6b665d"/>
    <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#6b665d"/>
    <text x="${width / 2}" y="${height - 10}" text-anchor="middle" fill="#6b665d">Top 5 share</text>
    <text x="16" y="${height / 2}" text-anchor="middle" fill="#6b665d" transform="rotate(-90 16 ${height / 2})">Top 10 stability over 20 steps</text>
    ${rows.map((row) => `<circle class="${row.mode}" cx="${x(row.top5SharePct).toFixed(1)}" cy="${y(row.top10Stability20Pct).toFixed(1)}" r="3"><title>${row.mode}: top5 ${row.top5SharePct.toFixed(1)}%, stab20 ${row.top10Stability20Pct.toFixed(1)}%</title></circle>`).join("")}
  </svg>`;
}

function groupBy(rows, key) {
  const groups = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!groups.has(value)) {
      groups.set(value, []);
    }
    groups.get(value).push(row);
  }
  return [...groups.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }));
}

function summarizeGroup(label, rows) {
  return {
    label,
    top5SharePct: mean(rows, "top5SharePct"),
    top10Stability20Pct: mean(rows, "top10Stability20Pct"),
  };
}

function mean(rows, key) {
  return rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
}

function seedFromParams(params) {
  return hashString(JSON.stringify(params));
}

function hashString(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function random() {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

runSweep();
