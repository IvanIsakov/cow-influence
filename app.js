const COW_COUNT = 50;
const BASE_POWER = 1;
const MAX_ENERGY = 1;
const MIN_NODE_RADIUS = 8;
const MAX_NODE_RADIUS = 32;

const state = {
  cows: [],
  edges: new Map(),
  selected: new Set(),
  time: 0,
  events: [],
  running: false,
  randomMode: false,
  timer: null,
};

const controls = {
  playButton: document.querySelector("#playButton"),
  stepButton: document.querySelector("#stepButton"),
  resetButton: document.querySelector("#resetButton"),
  createEventButton: document.querySelector("#createEventButton"),
  clearSelectionButton: document.querySelector("#clearSelectionButton"),
  manualModeButton: document.querySelector("#manualModeButton"),
  randomModeButton: document.querySelector("#randomModeButton"),
  forgetfulnessInput: document.querySelector("#forgetfulnessInput"),
  tirednessInput: document.querySelector("#tirednessInput"),
  recoveryInput: document.querySelector("#recoveryInput"),
  intensityInput: document.querySelector("#intensityInput"),
  groupSizeInput: document.querySelector("#groupSizeInput"),
};

const outputs = {
  timeMetric: document.querySelector("#timeMetric"),
  powerMetric: document.querySelector("#powerMetric"),
  topShareMetric: document.querySelector("#topShareMetric"),
  eventMetric: document.querySelector("#eventMetric"),
  forgetfulnessValue: document.querySelector("#forgetfulnessValue"),
  tirednessValue: document.querySelector("#tirednessValue"),
  recoveryValue: document.querySelector("#recoveryValue"),
  intensityValue: document.querySelector("#intensityValue"),
  groupSizeValue: document.querySelector("#groupSizeValue"),
  selectedList: document.querySelector("#selectedList"),
  rankingList: document.querySelector("#rankingList"),
  eventLog: document.querySelector("#eventLog"),
  chart: document.querySelector("#distributionChart"),
  tooltip: document.querySelector("#tooltip"),
  network: document.querySelector("#network"),
};

function modelSettings() {
  return {
    forgetfulness: Number(controls.forgetfulnessInput.value),
    tiredness: Number(controls.tirednessInput.value),
    recovery: Number(controls.recoveryInput.value),
    intensity: Number(controls.intensityInput.value),
    groupSize: Number(controls.groupSizeInput.value),
  };
}

function initialize() {
  state.cows = Array.from({ length: COW_COUNT }, (_, index) => {
    const angle = (Math.PI * 2 * index) / COW_COUNT;
    const ring = index % 2 === 0 ? 0.34 : 0.43;
    return {
      id: index,
      name: `Cow ${String(index + 1).padStart(2, "0")}`,
      power: BASE_POWER,
      energy: MAX_ENERGY,
      activity: 0.78 + Math.random() * 0.44,
      x: 0.5 + Math.cos(angle) * ring,
      y: 0.5 + Math.sin(angle) * ring,
      vx: 0,
      vy: 0,
      collaborations: 0,
    };
  });
  state.edges = new Map();
  state.selected.clear();
  state.time = 0;
  state.events = [];
  stopSimulation();
  render();
}

function stepSimulation() {
  const settings = modelSettings();
  state.time += 1;

  for (const cow of state.cows) {
    cow.power = BASE_POWER + (cow.power - BASE_POWER) * Math.exp(-settings.forgetfulness);
    cow.energy = Math.min(MAX_ENERGY, cow.energy + settings.recovery);
  }

  if (state.randomMode) {
    createRandomEvent();
  }

  tickLayout(16);
  render();
}

function createEvent(participantIds, source = "manual") {
  const uniqueIds = [...new Set(participantIds)].filter((id) => state.cows[id]);
  if (uniqueIds.length < 2) {
    return false;
  }

  const settings = modelSettings();
  const powersBefore = new Map(uniqueIds.map((id) => [id, state.cows[id].power]));
  const gains = new Map();

  for (const id of uniqueIds) {
    const cow = state.cows[id];
    const collaboratorPower = uniqueIds.reduce((sum, collaboratorId) => {
      return collaboratorId === id ? sum : sum + powersBefore.get(collaboratorId);
    }, 0);
    const gain = settings.intensity * cow.activity * cow.energy * collaboratorPower;
    gains.set(id, gain);
  }

  for (const id of uniqueIds) {
    const cow = state.cows[id];
    cow.power += gains.get(id);
    cow.energy = Math.max(0.05, cow.energy - settings.tiredness);
    cow.collaborations += 1;
  }

  for (let i = 0; i < uniqueIds.length; i += 1) {
    for (let j = i + 1; j < uniqueIds.length; j += 1) {
      const key = edgeKey(uniqueIds[i], uniqueIds[j]);
      const existing = state.edges.get(key) || { source: uniqueIds[i], target: uniqueIds[j], weight: 0 };
      existing.weight += 1;
      state.edges.set(key, existing);
    }
  }

  state.events.unshift({
    time: state.time,
    source,
    participants: uniqueIds,
    gain: [...gains.values()].reduce((sum, value) => sum + value, 0),
  });
  state.events = state.events.slice(0, 36);
  state.selected.clear();
  tickLayout(24);
  render();
  return true;
}

function createRandomEvent() {
  const settings = modelSettings();
  const weighted = state.cows.map((cow) => ({
    id: cow.id,
    weight: 0.55 + cow.energy + Math.sqrt(cow.power) * 0.08,
  }));
  const ids = [];
  while (ids.length < settings.groupSize && weighted.length) {
    const total = weighted.reduce((sum, item) => sum + item.weight, 0);
    let pick = Math.random() * total;
    const index = weighted.findIndex((item) => {
      pick -= item.weight;
      return pick <= 0;
    });
    ids.push(weighted.splice(Math.max(0, index), 1)[0].id);
  }
  createEvent(ids, "random");
}

function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function toggleCow(id) {
  if (state.selected.has(id)) {
    state.selected.delete(id);
  } else {
    state.selected.add(id);
  }
  render();
}

function startSimulation() {
  if (state.running) {
    return;
  }
  state.running = true;
  controls.playButton.textContent = "Pause";
  state.timer = window.setInterval(stepSimulation, 820);
}

function stopSimulation() {
  state.running = false;
  controls.playButton.textContent = "Play";
  if (state.timer) {
    window.clearInterval(state.timer);
    state.timer = null;
  }
}

function render() {
  syncOutputs();
  renderNetwork();
  renderRanking();
  renderEvents();
  renderChart();
}

function syncOutputs() {
  const settings = modelSettings();
  outputs.forgetfulnessValue.textContent = settings.forgetfulness.toFixed(3);
  outputs.tirednessValue.textContent = settings.tiredness.toFixed(2);
  outputs.recoveryValue.textContent = settings.recovery.toFixed(2);
  outputs.intensityValue.textContent = settings.intensity.toFixed(2);
  outputs.groupSizeValue.textContent = String(settings.groupSize);

  const totalPower = state.cows.reduce((sum, cow) => sum + cow.power, 0);
  const topFive = [...state.cows].sort((a, b) => b.power - a.power).slice(0, 5);
  const topShare = topFive.reduce((sum, cow) => sum + cow.power, 0) / Math.max(1, totalPower);

  outputs.timeMetric.textContent = String(state.time);
  outputs.powerMetric.textContent = totalPower.toFixed(1);
  outputs.topShareMetric.textContent = `${Math.round(topShare * 100)}%`;
  outputs.eventMetric.textContent = String(state.events.length);

  if (state.selected.size === 0) {
    outputs.selectedList.textContent = "No cows selected";
  } else {
    outputs.selectedList.innerHTML = [...state.selected]
      .map((id) => `<span class="selected-chip">${state.cows[id].name}</span>`)
      .join("");
  }
}

function renderNetwork() {
  const svg = outputs.network;
  const rect = svg.getBoundingClientRect();
  const width = Math.max(420, rect.width || 800);
  const height = Math.max(520, rect.height || 700);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = "";

  const maxPower = Math.max(...state.cows.map((cow) => cow.power));
  const edges = [...state.edges.values()];
  const edgeGroup = createSvg("g", { class: "edges" });
  const nodeGroup = createSvg("g", { class: "nodes" });

  for (const edge of edges) {
    const source = state.cows[edge.source];
    const target = state.cows[edge.target];
    const line = createSvg("line", {
      class: "edge",
      x1: source.x * width,
      y1: source.y * height,
      x2: target.x * width,
      y2: target.y * height,
      "stroke-width": Math.min(8, 0.8 + edge.weight * 0.45),
    });
    edgeGroup.appendChild(line);
  }

  for (const cow of state.cows) {
    const radius = nodeRadius(cow.power, maxPower);
    const group = createSvg("g", {
      class: `cow-node${state.selected.has(cow.id) ? " selected" : ""}`,
      transform: `translate(${cow.x * width}, ${cow.y * height})`,
      tabindex: "0",
      role: "button",
      "aria-label": `${cow.name}, power ${cow.power.toFixed(2)}, energy ${Math.round(cow.energy * 100)} percent`,
    });
    const circle = createSvg("circle", {
      r: radius,
      fill: cowColor(cow),
    });
    const label = createSvg("text", {
      y: 4,
    });
    label.textContent = String(cow.id + 1);

    group.appendChild(circle);
    group.appendChild(label);
    group.addEventListener("click", () => toggleCow(cow.id));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleCow(cow.id);
      }
    });
    group.addEventListener("pointermove", (event) => showTooltip(event, cow));
    group.addEventListener("pointerleave", hideTooltip);
    nodeGroup.appendChild(group);
  }

  svg.appendChild(edgeGroup);
  svg.appendChild(nodeGroup);
}

function createSvg(tag, attrs) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) {
    element.setAttribute(key, value);
  }
  return element;
}

function nodeRadius(power, maxPower) {
  const scale = Math.sqrt(power) / Math.sqrt(Math.max(1, maxPower));
  return MIN_NODE_RADIUS + scale * (MAX_NODE_RADIUS - MIN_NODE_RADIUS);
}

function cowColor(cow) {
  if (cow.energy < 0.28) {
    return "#c45c43";
  }
  if (cow.power > 8) {
    return "#c89a31";
  }
  return "#5b8d47";
}

function showTooltip(event, cow) {
  outputs.tooltip.hidden = false;
  outputs.tooltip.style.left = `${event.offsetX + 18}px`;
  outputs.tooltip.style.top = `${event.offsetY + 18}px`;
  outputs.tooltip.innerHTML = `
    <strong>${cow.name}</strong><br>
    Power: ${cow.power.toFixed(2)}<br>
    Energy: ${Math.round(cow.energy * 100)}%<br>
    Activity: ${cow.activity.toFixed(2)}<br>
    Events: ${cow.collaborations}
  `;
}

function hideTooltip() {
  outputs.tooltip.hidden = true;
}

function renderRanking() {
  outputs.rankingList.innerHTML = [...state.cows]
    .sort((a, b) => b.power - a.power)
    .slice(0, 8)
    .map((cow) => `
      <li>
        <strong>${cow.name} · ${cow.power.toFixed(2)}</strong>
        <span>Energy ${Math.round(cow.energy * 100)}% · ${cow.collaborations} collaborations</span>
      </li>
    `)
    .join("");
}

function renderEvents() {
  if (state.events.length === 0) {
    outputs.eventLog.textContent = "No events yet";
    return;
  }
  outputs.eventLog.innerHTML = state.events
    .slice(0, 8)
    .map((event) => {
      const names = event.participants.map((id) => state.cows[id].name.replace("Cow ", "#")).join(", ");
      return `
        <div class="event-entry">
          <strong>t=${event.time} · ${event.source} · +${event.gain.toFixed(2)}</strong>
          <span>${names}</span>
        </div>
      `;
    })
    .join("");
}

function renderChart() {
  const canvas = outputs.chart;
  const context = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  const padding = 18;
  const sorted = [...state.cows].sort((a, b) => a.power - b.power);
  const maxPower = Math.max(...sorted.map((cow) => cow.power), 1);

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#fff8e8";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#d9d1c0";
  context.strokeRect(0.5, 0.5, width - 1, height - 1);

  const barWidth = (width - padding * 2) / sorted.length;
  sorted.forEach((cow, index) => {
    const barHeight = ((height - padding * 2) * cow.power) / maxPower;
    context.fillStyle = cowColor(cow);
    context.fillRect(
      padding + index * barWidth,
      height - padding - barHeight,
      Math.max(2, barWidth - 1),
      barHeight
    );
  });

  context.fillStyle = "#6b665d";
  context.font = "12px system-ui";
  context.fillText("low power", padding, height - 5);
  context.fillText("high power", width - padding - 66, height - 5);
}

function tickLayout(iterations) {
  const edges = [...state.edges.values()];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const edge of edges) {
      const source = state.cows[edge.source];
      const target = state.cows[edge.target];
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.hypot(dx, dy) || 0.001;
      const desired = 0.12 + Math.max(0, 0.08 - edge.weight * 0.002);
      const force = (distance - desired) * 0.008 * Math.min(6, edge.weight);
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }

    for (let i = 0; i < state.cows.length; i += 1) {
      for (let j = i + 1; j < state.cows.length; j += 1) {
        const a = state.cows[i];
        const b = state.cows[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy) || 0.001;
        const force = 0.00022 / (distance * distance);
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    for (const cow of state.cows) {
      cow.vx += (0.5 - cow.x) * 0.002;
      cow.vy += (0.5 - cow.y) * 0.002;
      cow.x = clamp(cow.x + cow.vx, 0.045, 0.955);
      cow.y = clamp(cow.y + cow.vy, 0.06, 0.94);
      cow.vx *= 0.82;
      cow.vy *= 0.82;
    }
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

controls.playButton.addEventListener("click", () => {
  if (state.running) {
    stopSimulation();
  } else {
    startSimulation();
  }
});

controls.stepButton.addEventListener("click", stepSimulation);
controls.resetButton.addEventListener("click", initialize);
controls.createEventButton.addEventListener("click", () => createEvent([...state.selected]));
controls.clearSelectionButton.addEventListener("click", () => {
  state.selected.clear();
  render();
});

controls.manualModeButton.addEventListener("click", () => {
  state.randomMode = false;
  controls.manualModeButton.classList.add("active");
  controls.randomModeButton.classList.remove("active");
});

controls.randomModeButton.addEventListener("click", () => {
  state.randomMode = true;
  controls.randomModeButton.classList.add("active");
  controls.manualModeButton.classList.remove("active");
});

for (const input of [
  controls.forgetfulnessInput,
  controls.tirednessInput,
  controls.recoveryInput,
  controls.intensityInput,
  controls.groupSizeInput,
]) {
  input.addEventListener("input", render);
}

window.addEventListener("resize", renderNetwork);

initialize();
