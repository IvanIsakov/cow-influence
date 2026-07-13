const fs = require("node:fs");
const path = require("node:path");

const inputFile = path.join(__dirname, "sweep-results-intensity-0-18.csv");
const outputFile = path.join(__dirname, "parameter-graphs-log10-totalpower-intensity-0-18.html");

const rows = readCsv(inputFile).map((row) => ({
  ...row,
  log10TotalPower: safeLog10(row.totalPower),
}));

fs.writeFileSync(outputFile, html(rows));
console.log(`Rows graphed: ${rows.length}`);
console.log(`Graph report: ${outputFile}`);

function safeLog10(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.log10(value);
}

function readCsv(file) {
  const text = fs.readFileSync(file, "utf8").trim();
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

function html(data) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Cow Influence Parameter Graphs</title>
  <style>
    :root {
      --paper: #f8f5ec;
      --panel: #fffdf7;
      --ink: #24231f;
      --muted: #6b665d;
      --line: #d9d1c0;
      --accent: #287a78;
      --coral: #c45c43;
    }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--ink); background: var(--paper); font-family: Inter, system-ui, sans-serif; }
    main { width: min(1280px, calc(100% - 28px)); margin: 0 auto; padding: 26px 0 44px; }
    h1 { margin: 0 0 6px; font-size: 2rem; }
    h2 { margin: 26px 0 12px; font-size: 1.05rem; text-transform: uppercase; }
    p { color: var(--muted); line-height: 1.45; }
    .controls, .panel { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); }
    .controls { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; padding: 12px; margin: 16px 0; }
    label { display: grid; gap: 5px; color: var(--muted); font-size: 0.86rem; }
    select { min-height: 36px; border: 1px solid var(--line); border-radius: 8px; background: white; color: var(--ink); padding: 0 10px; }
    .grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(320px, 0.75fr); gap: 16px; align-items: start; }
    canvas, svg { display: block; width: 100%; background: #fffaf0; border: 1px solid var(--line); border-radius: 8px; }
    #scatter3d { height: 620px; cursor: grab; }
    .panel { padding: 14px; }
    .legend { display: grid; gap: 8px; margin-top: 12px; color: var(--muted); font-size: 0.9rem; }
    .scale { height: 14px; border-radius: 999px; background: linear-gradient(90deg, #287a78, #c89a31, #c45c43); border: 1px solid var(--line); }
    .heatmap-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; }
    .heatmap-card { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); padding: 12px; }
    .heatmap-card h3 { margin: 0 0 10px; font-size: 0.96rem; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 10px; margin: 16px 0; }
    .stat { border: 1px solid var(--line); border-radius: 8px; padding: 12px; background: var(--panel); }
    .stat span { display: block; color: var(--muted); font-size: 0.8rem; }
    .stat strong { display: block; margin-top: 4px; font-size: 1.25rem; }
    @media (max-width: 950px) {
      .grid, .stats { grid-template-columns: 1fr; }
      #scatter3d { height: 520px; }
    }
  </style>
</head>
<body>
  <main>
    <h1>Cow Influence Parameter Graphs</h1>
    <p>High-intensity sweep, including runaway overflow regimes. Axes are forgetfulness, tiredness, and group size. Color shows log10(totalPower), so explosive influence growth remains visible without flattening the rest of the data.</p>

    <div class="controls">
      <label>Mode
        <select id="modeSelect">
          <option value="all">All</option>
          <option value="random">Random</option>
          <option value="habit">Habit</option>
        </select>
      </label>
      <label>Outcome color
        <select id="metricSelect">
          <option value="log10TotalPower">log10(totalPower)</option>
          <option value="top5SharePct">Top 5 share</option>
          <option value="top10Stability20Pct">Top 10 stability, 20 steps</option>
          <option value="oligarchyScore">Oligarchy score</option>
        </select>
      </label>
      <label>Heatmap mode
        <select id="heatModeSelect">
          <option value="all">All</option>
          <option value="random">Random</option>
          <option value="habit">Habit</option>
        </select>
      </label>
    </div>

    <div class="stats" id="stats"></div>

    <section class="grid">
      <div>
        <h2>3D Parameter Space</h2>
        <canvas id="scatter3d" width="900" height="620" aria-label="3D scatter of parameter outcomes"></canvas>
      </div>
      <aside class="panel">
        <h2>Reading The Plot</h2>
        <p>Each point is one 1000-step simulation row. Drag the canvas to rotate. Runaway rows are included and appear near log10(totalPower) = 308.</p>
        <div class="legend">
          <span>Outcome color scale</span>
          <div class="scale"></div>
          <span>green = lower outcome, red = higher outcome</span>
        </div>
      </aside>
    </section>

    <h2>Heatmaps By Group Size</h2>
    <p>Each heatmap averages the selected outcome over forgetfulness and tiredness for one group size.</p>
    <section id="heatmaps" class="heatmap-grid"></section>
  </main>

  <script>
    const DATA = ${JSON.stringify(data)};
    const canvas = document.querySelector("#scatter3d");
    const context = canvas.getContext("2d");
    const modeSelect = document.querySelector("#modeSelect");
    const metricSelect = document.querySelector("#metricSelect");
    const heatModeSelect = document.querySelector("#heatModeSelect");
    const heatmaps = document.querySelector("#heatmaps");
    const stats = document.querySelector("#stats");
    let angleX = -0.72;
    let angleY = 0.62;
    let dragging = false;
    let lastPointer = null;

    const ranges = {
      forgetfulness: extent(DATA, "forgetfulness"),
      tiredness: extent(DATA, "tiredness"),
      groupSize: extent(DATA, "groupSize"),
    };

    function filteredRows() {
      const mode = modeSelect.value;
      return mode === "all" ? DATA : DATA.filter((row) => row.mode === mode);
    }

    function drawScatter() {
      const rows = filteredRows();
      const metric = metricSelect.value;
      const metricRange = extent(rows, metric);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#fffaf0";
      context.fillRect(0, 0, canvas.width, canvas.height);
      drawAxes();

      const points = rows.map((row) => {
        const x = normalize(row.forgetfulness, ranges.forgetfulness) - 0.5;
        const y = normalize(row.groupSize, ranges.groupSize) - 0.5;
        const z = normalize(row.tiredness, ranges.tiredness) - 0.5;
        const projected = project([x, y, z]);
        return { row, projected };
      }).sort((a, b) => a.projected.depth - b.projected.depth);

      for (const point of points) {
        const value = normalize(point.row[metric], metricRange);
        context.beginPath();
        context.fillStyle = colorScale(value);
        context.globalAlpha = point.row.mode === "habit" ? 0.76 : 0.62;
        context.arc(point.projected.x, point.projected.y, point.row.mode === "habit" ? 4.2 : 3.5, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
      drawStats(rows, metric);
    }

    function drawAxes() {
      const axes = [
        { from: [-0.55, -0.55, -0.55], to: [0.58, -0.55, -0.55], label: "forgetfulness" },
        { from: [-0.55, -0.55, -0.55], to: [-0.55, -0.55, 0.58], label: "tiredness" },
        { from: [-0.55, -0.55, -0.55], to: [-0.55, 0.58, -0.55], label: "group size" },
      ];
      context.strokeStyle = "#6b665d";
      context.fillStyle = "#6b665d";
      context.lineWidth = 1.2;
      context.font = "13px system-ui";
      for (const axis of axes) {
        const from = project(axis.from);
        const to = project(axis.to);
        context.beginPath();
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
        context.stroke();
        context.fillText(axis.label, to.x + 8, to.y);
      }
    }

    function project(point) {
      let [x, y, z] = point;
      const cosY = Math.cos(angleY);
      const sinY = Math.sin(angleY);
      const x1 = x * cosY - z * sinY;
      const z1 = x * sinY + z * cosY;
      const cosX = Math.cos(angleX);
      const sinX = Math.sin(angleX);
      const y1 = y * cosX - z1 * sinX;
      const z2 = y * sinX + z1 * cosX;
      const scale = 520 / (2.2 + z2);
      return {
        x: canvas.width / 2 + x1 * scale,
        y: canvas.height / 2 - y1 * scale,
        depth: z2,
      };
    }

    function drawHeatmaps() {
      const mode = heatModeSelect.value;
      const metric = metricSelect.value;
      const rows = mode === "all" ? DATA : DATA.filter((row) => row.mode === mode);
      const metricRange = extent(rows, metric);
      const groupSizes = unique(rows, "groupSize").sort((a, b) => a - b);
      const forgetfulness = unique(rows, "forgetfulness").sort((a, b) => a - b);
      const tiredness = unique(rows, "tiredness").sort((a, b) => a - b);
      heatmaps.innerHTML = "";

      for (const groupSize of groupSizes) {
        const card = document.createElement("article");
        card.className = "heatmap-card";
        const title = document.createElement("h3");
        title.textContent = "Group size " + groupSize;
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 360 280");
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", "Heatmap for group size " + groupSize);
        drawHeatmapSvg(svg, rows, groupSize, forgetfulness, tiredness, metric, metricRange);
        card.append(title, svg);
        heatmaps.append(card);
      }
    }

    function drawHeatmapSvg(svg, rows, groupSize, forgetfulness, tiredness, metric, metricRange) {
      const padLeft = 58;
      const padBottom = 44;
      const cellW = (340 - padLeft) / forgetfulness.length;
      const cellH = (236 - 18) / tiredness.length;
      svg.innerHTML = "";
      for (let yIndex = 0; yIndex < tiredness.length; yIndex += 1) {
        for (let xIndex = 0; xIndex < forgetfulness.length; xIndex += 1) {
          const cellRows = rows.filter((row) => row.groupSize === groupSize && row.forgetfulness === forgetfulness[xIndex] && row.tiredness === tiredness[yIndex]);
          const value = cellRows.length ? mean(cellRows, metric) : null;
          const rect = svgElement("rect", {
            x: padLeft + xIndex * cellW,
            y: 18 + (tiredness.length - 1 - yIndex) * cellH,
            width: cellW - 2,
            height: cellH - 2,
            fill: value === null ? "#eee6d5" : colorScale(normalize(value, metricRange)),
          });
          rect.appendChild(svgElement("title", {}, value === null ? "no rows" : formatMetric(metric, value)));
          svg.appendChild(rect);
        }
      }
      svg.appendChild(svgText(180, 272, "forgetfulness", "middle"));
      svg.appendChild(svgText(15, 128, "tiredness", "middle", "rotate(-90 15 128)"));
      forgetfulness.forEach((value, index) => svg.appendChild(svgText(padLeft + index * cellW + cellW / 2, 254, String(value), "middle", null, "10")));
      tiredness.forEach((value, index) => svg.appendChild(svgText(50, 18 + (tiredness.length - 1 - index) * cellH + cellH / 2 + 4, String(value), "end", null, "10")));
    }

    function drawStats(rows, metric) {
      const best = rows.slice().sort((a, b) => a[metric] - b[metric])[0];
      stats.innerHTML = [
        ["Rows", rows.length.toLocaleString()],
        ["Average top 5", mean(rows, "top5SharePct").toFixed(1) + "%"],
        ["Average stability 20", mean(rows, "top10Stability20Pct").toFixed(1) + "%"],
        ["Best " + metricLabel(metric), best ? formatMetric(metric, best[metric]) : "-"],
      ].map(([label, value]) => '<div class="stat"><span>' + label + '</span><strong>' + value + '</strong></div>').join("");
    }

    function metricLabel(metric) {
      return {
        top5SharePct: "top 5",
        top10Stability20Pct: "stability",
        oligarchyScore: "score",
        log10TotalPower: "log power",
      }[metric];
    }

    function formatMetric(metric, value) {
      if (metric === "log10TotalPower") {
        return value.toFixed(1);
      }
      return value.toFixed(1) + "%";
    }

    function svgElement(name, attrs, text) {
      const element = document.createElementNS("http://www.w3.org/2000/svg", name);
      for (const [key, value] of Object.entries(attrs)) {
        element.setAttribute(key, value);
      }
      if (text) element.textContent = text;
      return element;
    }

    function svgText(x, y, text, anchor, transform, size = "12") {
      return svgElement("text", {
        x,
        y,
        "text-anchor": anchor,
        transform: transform || "",
        fill: "#6b665d",
        "font-size": size,
        "font-family": "system-ui",
      }, text);
    }

    function extent(rows, key) {
      const values = rows.map((row) => row[key]).filter(Number.isFinite);
      return [Math.min(...values), Math.max(...values)];
    }

    function normalize(value, [min, max]) {
      if (max === min) return 0;
      return (value - min) / (max - min);
    }

    function colorScale(value) {
      const clamped = Math.max(0, Math.min(1, value));
      const stops = clamped < 0.5
        ? interpolate([40, 122, 120], [200, 154, 49], clamped * 2)
        : interpolate([200, 154, 49], [196, 92, 67], (clamped - 0.5) * 2);
      return "rgb(" + stops.map(Math.round).join(",") + ")";
    }

    function interpolate(a, b, t) {
      return a.map((value, index) => value + (b[index] - value) * t);
    }

    function unique(rows, key) {
      return [...new Set(rows.map((row) => row[key]))];
    }

    function mean(rows, key) {
      return rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
    }

    canvas.addEventListener("pointerdown", (event) => {
      dragging = true;
      lastPointer = { x: event.clientX, y: event.clientY };
      canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      const dx = event.clientX - lastPointer.x;
      const dy = event.clientY - lastPointer.y;
      angleY += dx * 0.008;
      angleX += dy * 0.008;
      lastPointer = { x: event.clientX, y: event.clientY };
      drawScatter();
    });

    canvas.addEventListener("pointerup", () => {
      dragging = false;
    });

    modeSelect.addEventListener("change", drawScatter);
    metricSelect.addEventListener("change", () => {
      drawScatter();
      drawHeatmaps();
    });
    heatModeSelect.addEventListener("change", drawHeatmaps);

    drawScatter();
    drawHeatmaps();
  </script>
</body>
</html>`;
}
