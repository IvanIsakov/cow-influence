const fs = require("node:fs");
const path = require("node:path");

const file = path.join(__dirname, "sweep-results-noactivity-intensity-0-18.csv");
const rows = readCsv(file);

const summary = {
  rows: rows.length,
  runawayRows: rows.filter((row) => row.runaway >= 0.5).length,
  avgTop5: mean(rows, "top5SharePct"),
  avgS20: mean(rows, "top10Stability20Pct"),
  avgScore: mean(rows, "oligarchyScore"),
  lowOligarchyRows: rows.filter((row) => row.runaway < 0.5 && row.top5SharePct <= 15 && row.top10Stability20Pct <= 30).length,
  best: rows.slice(0, 12).map(compactRow),
  worst: rows.slice(-8).reverse().map(compactRow),
  byMode: groupSummary("mode"),
  byGroupSize: groupSummary("groupSize"),
  byForgetfulness: groupSummary("forgetfulness"),
  byTiredness: groupSummary("tiredness"),
  byRecovery: groupSummary("recovery"),
};

console.log(JSON.stringify(summary, null, 2));

function readCsv(csvPath) {
  const text = fs.readFileSync(csvPath, "utf8").trim();
  const lines = text.split("\n");
  const columns = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row = Object.fromEntries(columns.map((column, index) => [column, stripQuotes(values[index])]));
    for (const key of columns) {
      if (key !== "mode") {
        row[key] = Number(row[key]);
      }
    }
    return row;
  });
}

function splitCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (const char of line) {
    if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function stripQuotes(value) {
  return String(value || "").replace(/^"|"$/g, "");
}

function groupSummary(key) {
  const groups = new Map();
  for (const row of rows) {
    const value = row[key];
    if (!groups.has(value)) {
      groups.set(value, []);
    }
    groups.get(value).push(row);
  }
  return [...groups.entries()]
    .map(([value, groupRows]) => ({
      value,
      n: groupRows.length,
      avgTop5: mean(groupRows, "top5SharePct"),
      avgS20: mean(groupRows, "top10Stability20Pct"),
      runawayRate: mean(groupRows, "runaway"),
      avgScore: mean(groupRows, "oligarchyScore"),
    }))
    .sort((a, b) => String(a.value).localeCompare(String(b.value), undefined, { numeric: true }));
}

function compactRow(row) {
  return {
    mode: row.mode,
    forgetfulness: row.forgetfulness,
    tiredness: row.tiredness,
    recovery: row.recovery,
    groupSize: row.groupSize,
    propensity: row.propensity,
    runaway: row.runaway,
    top5: row.top5SharePct,
    stability20: row.top10Stability20Pct,
    totalPower: row.totalPower,
    score: row.oligarchyScore,
  };
}

function mean(items, key) {
  return items.reduce((sum, item) => sum + item[key], 0) / items.length;
}
