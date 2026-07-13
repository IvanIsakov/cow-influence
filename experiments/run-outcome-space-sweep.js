const fs = require("node:fs");
const path = require("node:path");

const COW_COUNT = 50;
const BASE_POWER = 1;
const MAX_ENERGY = 1;
const STEPS = Number(process.env.STEPS || 1000);
const REPEATS = Number(process.env.REPEATS || 1);

const grid = {
  groupSize: Array.from({ length: 19 }, (_, index) => index + 2),
  tiredness: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
  forgetfulness: [0, 0.1, 0.2, 0.3, 0.4, 0.5],
  intensity: [0.01, 0.044, 0.078, 0.112, 0.146, 0.18],
  propensity: [0, 0.2, 0.4, 0.6, 0.8, 1],
};

const csvPath = path.join(__dirname, `outcome-space-sweep-group2-20-${STEPS}steps.csv`);
const htmlPath = path.join(__dirname, `outcome-space-plot-group2-20-${STEPS}steps.html`);

function main() {
  const rows = [];
  let simulations = 0;

  for (let groupIndex = 0; groupIndex < grid.groupSize.length; groupIndex += 1) {
    for (let tiredIndex = 0; tiredIndex < grid.tiredness.length; tiredIndex += 1) {
      for (let forgetIndex = 0; forgetIndex < grid.forgetfulness.length; forgetIndex += 1) {
        for (let intensityIndex = 0; intensityIndex < grid.intensity.length; intensityIndex += 1) {
          for (let propensityIndex = 0; propensityIndex < grid.propensity.length; propensityIndex += 1) {
            const groupSize = grid.groupSize[groupIndex];
            const tiredness = grid.tiredness[tiredIndex];
            const forgetfulness = grid.forgetfulness[forgetIndex];
            const intensity = grid.intensity[intensityIndex];
            const propensity = grid.propensity[propensityIndex];
            const metrics = [];
            for (let repeat = 0; repeat < REPEATS; repeat += 1) {
              metrics.push(simulate({
                seed: seedFromParams({ groupSize, tiredness, forgetfulness, intensity, propensity, repeat }),
                groupSize,
                tiredness,
                forgetfulness,
                intensity,
                propensity,
              }));
              simulations += 1;
              if (simulations % 500 === 0) {
                console.log(`Simulations completed: ${simulations}`);
              }
            }
            rows.push({
              groupSize,
              tiredness,
              forgetfulness,
              intensity,
              propensity,
              repeats: REPEATS,
              ...averageMetrics(metrics),
            });
          }
        }
      }
    }
  }

  fs.writeFileSync(csvPath, toCsv(rows));
  fs.writeFileSync(htmlPath, reportHtml(rows));
  console.log(`Simulations run: ${simulations}`);
  console.log(`Rows written: ${rows.length}`);
  console.log(`CSV: ${csvPath}`);
  console.log(`Plot: ${htmlPath}`);
  console.table(summary(rows));
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
  let runaway = false;

  for (let time = 1; time <= STEPS; time += 1) {
    for (const cow of cows) {
      cow.power = BASE_POWER + (cow.power - BASE_POWER) * Math.exp(-params.forgetfulness);
      cow.energy = Math.min(MAX_ENERGY, cow.energy + 0.05);
    }

    const participantIds = params.propensity > 0
      ? chooseHabitParticipants(cows, events, params, rng)
      : chooseRandomParticipants(cows, params, rng);
    applyEvent(cows, events, participantIds, params, time);

    if (cows.some((cow) => !Number.isFinite(cow.power))) {
      runaway = true;
      break;
    }

    topTenHistory.push(topIds(cows, 10));
    if (topTenHistory.length > 21) {
      topTenHistory.shift();
    }
  }

  const totalPowerRaw = cows.reduce((sum, cow) => sum + cow.power, 0);
  runaway = runaway || !Number.isFinite(totalPowerRaw);
  const totalPower = runaway ? Number.MAX_VALUE : totalPowerRaw;
  const sorted = cows.slice().sort((a, b) => b.power - a.power);
  const topFive = sorted.slice(0, 5);
  const bottomFive = sorted.slice(-5);
  const topFivePower = topFive.reduce((sum, cow) => sum + cow.power, 0);
  const topFiveAvg = topFivePower / topFive.length;
  const bottomFiveAvg = bottomFive.reduce((sum, cow) => sum + cow.power, 0) / bottomFive.length;
  const top5SharePct = runaway ? 100 : (topFivePower / totalPower) * 100;
  const topBottomRatio = runaway ? Number.MAX_VALUE : topFiveAvg / Math.max(0.000001, bottomFiveAvg);
  const currentTopTen = topTenHistory[topTenHistory.length - 1];
  const stability20 = overlapPct(currentTopTen, snapshotAgo(topTenHistory, 20));
  const log10TotalPower = safeLog10(totalPower);
  const log10TopBottomRatio = safeLog10(topBottomRatio);
  const oligarchyScore = top5SharePct + stability20 * 0.35 + Math.min(100, log10TopBottomRatio * 12) + (runaway ? 100 : 0);

  return {
    runaway: runaway ? 1 : 0,
    totalPower,
    log10TotalPower,
    top5SharePct,
    top10Stability20Pct: stability20,
    topBottomRatio,
    log10TopBottomRatio,
    oligarchyScore,
  };
}

function chooseRandomParticipants(cows, params, rng) {
  return chooseWeightedGroup(cows.map((cow) => participantCandidate(cow, 0, 1)), params.groupSize, rng);
}

function chooseHabitParticipants(cows, events, params, rng) {
  const ids = [];
  const seed = weightedPick(cows.map((cow) => participantCandidate(cow, 0, 1 - params.propensity)), rng);
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
    pool.splice(pool.findIndex((item) => item.id === picked), 1);
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

  events.unshift({ time, participants: uniqueIds });
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
  return history[Math.max(0, history.length - 1 - stepsAgo)];
}

function overlapPct(current, past) {
  const currentSet = new Set(current);
  return (past.filter((id) => currentSet.has(id)).length / current.length) * 100;
}

function safeLog10(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.log10(value);
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
    "groupSize",
    "tiredness",
    "forgetfulness",
    "intensity",
    "propensity",
    "repeats",
    "runaway",
    "totalPower",
    "log10TotalPower",
    "top5SharePct",
    "top10Stability20Pct",
    "topBottomRatio",
    "log10TopBottomRatio",
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

function reportHtml(rows) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cow Influence Outcome Space Sweep</title>
  <style>
    :root { --paper:#f8f5ec; --panel:#fffdf7; --ink:#24231f; --muted:#6b665d; --line:#d9d1c0; --accent:#287a78; --coral:#c45c43; --gold:#c89a31; }
    * { box-sizing: border-box; }
    body { margin:0; color:var(--ink); background:var(--paper); font-family:Inter, system-ui, sans-serif; }
    main { width:min(1280px, calc(100% - 28px)); margin:0 auto; padding:28px 0 44px; }
    h1 { margin:0 0 8px; font-size:2rem; }
    p { color:var(--muted); line-height:1.45; }
    .controls, .panel { border:1px solid var(--line); border-radius:8px; background:var(--panel); }
    .controls { display:flex; gap:14px; flex-wrap:wrap; align-items:center; padding:12px; margin:16px 0; }
    label { display:grid; gap:5px; color:var(--muted); font-size:.86rem; }
    select { min-height:36px; border:1px solid var(--line); border-radius:8px; background:white; padding:0 10px; color:var(--ink); }
    canvas { display:block; width:100%; border:1px solid var(--line); border-radius:8px; background:#fffaf0; }
    .stats { display:grid; grid-template-columns:repeat(4, minmax(130px, 1fr)); gap:10px; margin:16px 0; }
    .stat { border:1px solid var(--line); border-radius:8px; padding:12px; background:var(--panel); }
    .stat span { display:block; color:var(--muted); font-size:.8rem; }
    .stat strong { display:block; margin-top:4px; font-size:1.2rem; }
    .legend { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-top:10px; color:var(--muted); font-size:.9rem; }
    .swatch { width:12px; height:12px; border-radius:50%; display:inline-block; }
    table { width:100%; border-collapse:collapse; margin-top:18px; background:var(--panel); border:1px solid var(--line); }
    th, td { padding:8px 9px; border-bottom:1px solid #e5decf; text-align:right; font-size:.86rem; }
    th:first-child, td:first-child { text-align:left; }
    th { background:#efe7d6; }
    @media (max-width: 760px) { .stats { grid-template-columns:1fr 1fr; } }
  </style>
</head>
<body>
  <main>
    <h1>Cow Influence Outcome Space</h1>
    <p>Each point is one ${STEPS}-step simulation of 50 cows. X-axis is log10(totalPower). Y-axis is the selected oligarchy or inequality metric. The sweep crosses automatic collaboration size from 2 to 20 with tiredness, forgetfulness, event intensity, and habituation.</p>
    <div class="controls">
      <label>Y metric
        <select id="metricSelect">
          <option value="oligarchyScore">Oligarchy score</option>
          <option value="top5SharePct">Top 5 share</option>
          <option value="top10Stability20Pct">Top 10 stability, 20 steps</option>
          <option value="log10TopBottomRatio">log10 top/bottom 5 ratio</option>
        </select>
      </label>
      <label>Point color
        <select id="colorSelect">
          <option value="groupSize">Cows per event</option>
          <option value="tiredness">Tiredness</option>
          <option value="forgetfulness">Forgetfulness</option>
          <option value="intensity">Intensity</option>
          <option value="propensity">Habituation</option>
        </select>
      </label>
      <label>Runaways
        <select id="runawaySelect">
          <option value="include">Include</option>
          <option value="exclude">Exclude</option>
          <option value="only">Only</option>
        </select>
      </label>
    </div>
    <div id="stats" class="stats"></div>
    <canvas id="plot" width="1120" height="680" aria-label="Outcome space scatterplot"></canvas>
    <div class="legend"><span><span class="swatch" style="background:var(--accent)"></span> low color value</span><span><span class="swatch" style="background:var(--gold)"></span> middle</span><span><span class="swatch" style="background:var(--coral)"></span> high</span></div>
    <table id="bestTable"></table>
  </main>
  <script>
    const DATA = ${JSON.stringify(rows)};
    const plot = document.querySelector("#plot");
    const ctx = plot.getContext("2d");
    const metricSelect = document.querySelector("#metricSelect");
    const colorSelect = document.querySelector("#colorSelect");
    const runawaySelect = document.querySelector("#runawaySelect");
    const stats = document.querySelector("#stats");
    const bestTable = document.querySelector("#bestTable");

    function filtered() {
      const mode = runawaySelect.value;
      if (mode === "exclude") return DATA.filter((row) => row.runaway < 0.5);
      if (mode === "only") return DATA.filter((row) => row.runaway >= 0.5);
      return DATA;
    }

    function draw() {
      const rows = filtered();
      const yMetric = metricSelect.value;
      const colorMetric = colorSelect.value;
      const xRange = extent(rows, "log10TotalPower");
      const yRange = extent(rows, yMetric);
      const colorRange = extent(rows, colorMetric);
      const pad = { left: 78, right: 24, top: 28, bottom: 62 };
      ctx.clearRect(0, 0, plot.width, plot.height);
      ctx.fillStyle = "#fffaf0";
      ctx.fillRect(0, 0, plot.width, plot.height);
      drawAxes(xRange, yRange, yMetric, pad);
      for (const row of rows) {
        const x = scale(row.log10TotalPower, xRange, pad.left, plot.width - pad.right);
        const y = scale(row[yMetric], yRange, plot.height - pad.bottom, pad.top);
        ctx.beginPath();
        ctx.globalAlpha = row.runaway >= 0.5 ? 0.9 : 0.58;
        ctx.fillStyle = colorScale(normalize(row[colorMetric], colorRange));
        ctx.arc(x, y, row.runaway >= 0.5 ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      renderStats(rows);
      renderBest(rows, yMetric);
    }

    function drawAxes(xRange, yRange, yMetric, pad) {
      ctx.strokeStyle = "#6b665d";
      ctx.fillStyle = "#6b665d";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pad.left, plot.height - pad.bottom);
      ctx.lineTo(plot.width - pad.right, plot.height - pad.bottom);
      ctx.moveTo(pad.left, pad.top);
      ctx.lineTo(pad.left, plot.height - pad.bottom);
      ctx.stroke();
      ctx.font = "13px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("log10(totalPower)", plot.width / 2, plot.height - 18);
      ctx.save();
      ctx.translate(18, plot.height / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(labelFor(yMetric), 0, 0);
      ctx.restore();
      drawTicks(xRange, true, pad);
      drawTicks(yRange, false, pad);
    }

    function drawTicks(range, horizontal, pad) {
      ctx.font = "11px system-ui";
      ctx.fillStyle = "#6b665d";
      ctx.strokeStyle = "rgba(107,102,93,.25)";
      for (let i = 0; i <= 5; i += 1) {
        const value = range[0] + (range[1] - range[0]) * i / 5;
        if (horizontal) {
          const x = scale(value, range, pad.left, plot.width - pad.right);
          ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, plot.height - pad.bottom); ctx.stroke();
          ctx.textAlign = "center"; ctx.fillText(value.toFixed(1), x, plot.height - pad.bottom + 18);
        } else {
          const y = scale(value, range, plot.height - pad.bottom, pad.top);
          ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(plot.width - pad.right, y); ctx.stroke();
          ctx.textAlign = "right"; ctx.fillText(value.toFixed(1), pad.left - 8, y + 4);
        }
      }
    }

    function renderStats(rows) {
      stats.innerHTML = [
        ["Rows", rows.length.toLocaleString()],
        ["Runaways", rows.filter((row) => row.runaway >= 0.5).length.toLocaleString()],
        ["Avg log power", mean(rows, "log10TotalPower").toFixed(1)],
        ["Avg oligarchy", mean(rows, "oligarchyScore").toFixed(1)],
      ].map(([label, value]) => '<div class="stat"><span>' + label + '</span><strong>' + value + '</strong></div>').join("");
    }

    function renderBest(rows, metric) {
      const best = rows.slice().sort((a, b) => a[metric] - b[metric]).slice(0, 12);
      bestTable.innerHTML = '<thead><tr><th>rank</th><th>cows/event</th><th>tired</th><th>forget</th><th>intensity</th><th>habit</th><th>log power</th><th>' + labelFor(metric) + '</th><th>runaway</th></tr></thead><tbody>' +
        best.map((row, index) => '<tr><td>' + (index + 1) + '</td><td>' + row.groupSize + '</td><td>' + row.tiredness + '</td><td>' + row.forgetfulness + '</td><td>' + row.intensity + '</td><td>' + row.propensity + '</td><td>' + row.log10TotalPower.toFixed(1) + '</td><td>' + row[metric].toFixed(1) + '</td><td>' + (row.runaway >= 0.5 ? "yes" : "no") + '</td></tr>').join("") +
        '</tbody>';
    }

    function extent(rows, key) {
      const values = rows.map((row) => row[key]).filter(Number.isFinite);
      if (!values.length) return [0, 1];
      const min = Math.min(...values);
      const max = Math.max(...values);
      return min === max ? [min - 1, max + 1] : [min, max];
    }

    function mean(rows, key) {
      return rows.length ? rows.reduce((sum, row) => sum + row[key], 0) / rows.length : 0;
    }

    function normalize(value, range) {
      return (value - range[0]) / Math.max(0.000001, range[1] - range[0]);
    }

    function scale(value, range, outMin, outMax) {
      return outMin + normalize(value, range) * (outMax - outMin);
    }

    function colorScale(value) {
      const t = Math.max(0, Math.min(1, value));
      const c = t < 0.5 ? mix([40, 122, 120], [200, 154, 49], t * 2) : mix([200, 154, 49], [196, 92, 67], (t - 0.5) * 2);
      return "rgb(" + c.map(Math.round).join(",") + ")";
    }

    function mix(a, b, t) {
      return a.map((value, index) => value + (b[index] - value) * t);
    }

    function labelFor(metric) {
      return {
        oligarchyScore: "oligarchy score",
        top5SharePct: "top 5 share (%)",
        top10Stability20Pct: "top 10 stability (%)",
        log10TopBottomRatio: "log10 top/bottom 5 ratio",
      }[metric] || metric;
    }

    metricSelect.addEventListener("change", draw);
    colorSelect.addEventListener("change", draw);
    runawaySelect.addEventListener("change", draw);
    draw();
  </script>
</body>
</html>`;
}

function summary(rows) {
  const runaway = rows.filter((row) => row.runaway >= 0.5).length;
  const finite = rows.filter((row) => row.runaway < 0.5);
  return [
    { metric: "rows", value: rows.length },
    { metric: "runaways", value: runaway },
    { metric: "avg log10 power", value: average(finite, "log10TotalPower").toFixed(2) },
    { metric: "avg oligarchy", value: average(finite, "oligarchyScore").toFixed(2) },
  ];
}

function average(rows, key) {
  return rows.length ? rows.reduce((sum, row) => sum + row[key], 0) / rows.length : 0;
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

main();
