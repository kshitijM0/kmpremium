// ==========================================
// DEMO CATALOG (used until a real panel is connected)
// ==========================================
const DEMO_CATALOG = {
  views: [
    { id: 3546, name: "Instagram Views [Real, Fast]", rate: 0.006 },
    { id: 3612, name: "Instagram Views [HQ, Refill]", rate: 0.009 },
    { id: 3720, name: "Instagram Reel Views [Instant]", rate: 0.007 },
  ],
  likes: [
    { id: 4108, name: "Instagram Likes [Real Users]", rate: 0.012 },
    { id: 4190, name: "Instagram Likes [Instant]", rate: 0.010 },
  ],
  followers: [
    { id: 5021, name: "Instagram Followers [HQ, No Drop]", rate: 0.020 },
    { id: 5099, name: "Instagram Followers [Real, Refill 30d]", rate: 0.026 },
  ],
  repost: [
    { id: 6011, name: "Instagram Repost [Real Accounts]", rate: 0.015 },
  ],
};

// Active catalog — replaced with real panel data after a successful connect
let CATALOG = DEMO_CATALOG;
let PANEL = { baseUrl: "", apiKey: "", connected: false };

// ==========================================
// DELIVERY CURVES (20 points each, weight 0-100)
// ==========================================
const GRAPH_PRESETS = {
  steady: { name: "Steady Drip", organic: false, points: Array(20).fill(50) },
  burst: {
    name: "Instant Burst",
    organic: false,
    points: [95,90,84,78,72,65,58,52,46,40,34,29,24,20,16,13,10,8,6,5],
  },
  late: {
    name: "Late Spike",
    organic: false,
    points: [5,6,8,10,13,16,20,24,29,34,40,46,52,58,65,72,78,84,90,95],
  },
  organic1: {
    name: "Organic — Morning Rise",
    organic: true,
    points: [8,10,14,20,28,38,50,62,72,80,85,88,88,85,80,74,68,62,58,55],
  },
  organic2: {
    name: "Organic — Evening Wave",
    organic: true,
    points: [15,25,35,45,40,30,22,18,22,30,42,55,68,80,90,88,78,65,50,38],
  },
};

let CUSTOM_GRAPH_POINTS = Array(20).fill(50);

// ==========================================
// ELEMENT REFERENCES
// ==========================================
const servicesContainer = document.getElementById("servicesContainer");
const addServiceBtn = document.getElementById("addServiceBtn");
const serviceTemplate = document.getElementById("serviceTemplate");

const totalQtyEl = document.getElementById("totalQty");
const totalCostEl = document.getElementById("totalCost");
const graphBigNumEl = document.getElementById("graphBigNum");
const balanceValueEl = document.getElementById("balanceValue");

const scheduleTable = document.getElementById("scheduleTable");
const logsList = document.getElementById("logsList");

const tabButtons = document.querySelectorAll(".tab-btn");
const panels = document.querySelectorAll(".panel");

const presetsBtn = document.getElementById("presetsBtn");
const submitOrderBtn = document.getElementById("submitOrderBtn");
const orderStatusEl = document.getElementById("orderStatus");

const apiBaseUrlInput = document.getElementById("apiBaseUrl");
const apiKeyInputEl = document.getElementById("apiKeyInput");
const proxyUrlInput = document.getElementById("proxyUrlInput");
const connectBtn = document.getElementById("connectBtn");
const connectStatusEl = document.getElementById("connectStatus");
const fetchedServicesListEl = document.getElementById("fetchedServicesList");

// ==========================================
// GENERIC PANEL CALL — goes through the proxy
// server when a proxy URL is set (fixes CORS),
// otherwise calls the panel directly.
// ==========================================
async function callPanelAPI(baseUrl, apiKey, actionParams) {
  const proxyUrl = proxyUrlInput.value.trim();
  const params = { key: apiKey, ...actionParams };

  if (proxyUrl) {
    const res = await fetch(proxyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl, params }),
    });
    const data = await res.json();
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  const res = await fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  return res.json();
}

const graphModal = document.getElementById("graphModal");
const closeGraphModal = document.getElementById("closeGraphModal");
const saveGraphBtn = document.getElementById("saveGraphBtn");
const customGraphSvg = document.getElementById("customGraphSvg");

const trackerLinkInput = document.getElementById("trackerLink");
const trackBtn = document.getElementById("trackBtn");
const trackerViewsNumEl = document.getElementById("trackerViewsNum");
const trackerLikesNumEl = document.getElementById("trackerLikesNum");

const schedulesLocked = document.getElementById("schedulesLocked");
const schedulesContent = document.getElementById("schedulesContent");
const schedulesPasswordInput = document.getElementById("schedulesPassword");
const unlockSchedulesBtn = document.getElementById("unlockSchedulesBtn");
const lockErrorEl = document.getElementById("lockError");

const SCHEDULES_PASSWORD = "010";
let schedulesUnlocked = false;

let slotCounter = 0;
const logEntries = [];
let editingCard = null; // which slot card's custom-graph the modal is currently editing

// ==========================================
// TABS
// ==========================================
tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabButtons.forEach((b) => b.classList.remove("active"));
    panels.forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// ==========================================
// LOGGING
// ==========================================
function addLog(message) {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  logEntries.unshift({ time, message });
  renderLogs();
}

function renderLogs() {
  if (logEntries.length === 0) {
    logsList.innerHTML = `<div class="summary-empty">No activity yet.</div>`;
    return;
  }
  logsList.innerHTML = logEntries
    .map((entry) => `
      <div class="log-row">
        <span class="log-time">${entry.time}</span>
        <span class="log-text">${entry.message}</span>
      </div>
    `)
    .join("");
}

// ==========================================
// PANEL CONNECT
// ==========================================
connectBtn.addEventListener("click", async () => {
  const baseUrl = apiBaseUrlInput.value.trim();
  const apiKey = apiKeyInputEl.value.trim();

  if (!baseUrl) {
    connectStatusEl.textContent = "Enter the panel's API URL first.";
    connectStatusEl.className = "connect-status error";
    return;
  }

  connectStatusEl.textContent = "Connecting...";
  connectStatusEl.className = "connect-status";

  try {
    const balanceData = await callPanelAPI(baseUrl, apiKey, { action: "balance" });
    const servicesData = await callPanelAPI(baseUrl, apiKey, { action: "services" });

    if (balanceData && balanceData.balance !== undefined) {
      const currency = balanceData.currency || "$";
      balanceValueEl.textContent = `${currency}${parseFloat(balanceData.balance).toFixed(2)}`;
    }

    if (Array.isArray(servicesData)) {
      CATALOG = groupServicesByCategory(servicesData);
      renderFetchedServices(servicesData);
      rebuildAllCategoryDropdowns();
    }

    PANEL = { baseUrl, apiKey, connected: true };
    connectStatusEl.textContent = "Connected — balance and services loaded.";
    connectStatusEl.className = "connect-status ok";
    addLog(`Connected to panel at ${baseUrl}`);
  } catch (err) {
    const usingProxy = !!proxyUrlInput.value.trim();
    connectStatusEl.textContent = usingProxy
      ? `Proxy couldn't reach that panel: ${err.message}. Check the panel URL/key, and that the proxy server is actually running.`
      : "Couldn't reach that panel directly from the browser (CORS block). Fill in the Proxy server URL field above and make sure proxy-server is running — see the included README.";
    connectStatusEl.className = "connect-status error";
    addLog(`Connect failed for ${baseUrl}`);
  }
});

function groupServicesByCategory(list) {
  const groups = {};
  list.forEach((svc) => {
    const haystack = `${svc.name || ""} ${svc.category || ""} ${svc.type || ""}`.toLowerCase();
    let bucket = "other";
    if (haystack.includes("view")) bucket = "views";
    else if (haystack.includes("like")) bucket = "likes";
    else if (haystack.includes("follow")) bucket = "followers";
    else if (haystack.includes("comment")) bucket = "comments";
    else if (haystack.includes("share") || haystack.includes("repost")) bucket = "repost";

    if (!groups[bucket]) groups[bucket] = [];
    groups[bucket].push({
      id: svc.service,
      name: svc.name,
      rate: parseFloat(svc.rate) / 1000 || 0.01,
    });
  });
  return groups;
}

function renderFetchedServices(list) {
  if (list.length === 0) {
    fetchedServicesListEl.innerHTML = `<div class="summary-empty">Panel returned no services.</div>`;
    return;
  }
  fetchedServicesListEl.innerHTML = list
    .slice(0, 40)
    .map(
      (svc) => `
      <div class="fetched-service-row">
        <span>#${svc.service} — ${svc.name}</span>
        <span class="mono">${svc.rate}</span>
      </div>
    `
    )
    .join("");
}

function rebuildAllCategoryDropdowns() {
  servicesContainer.querySelectorAll(".service-card").forEach((card) => {
    populateCategorySelect(card.querySelector(".category-select"));
  });
  refreshEverything();
}

function populateCategorySelect(select) {
  const previous = select.value;
  select.innerHTML = Object.keys(CATALOG)
    .map((cat) => `<option value="${cat}">${capitalize(cat)}</option>`)
    .join("");
  if (Object.keys(CATALOG).includes(previous)) select.value = previous;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ==========================================
// CREATE A NEW SERVICE SLOT
// ==========================================
function createServiceSlot() {
  slotCounter += 1;

  const fragment = serviceTemplate.content.cloneNode(true);
  const card = fragment.querySelector(".service-card");
  card.dataset.id = slotCounter;
  card.dataset.selectedServiceId = "";
  card.dataset.selectedRate = "0";
  card.customGraphPoints = null; // per-slot custom curve override, set when user saves one for this slot

  servicesContainer.appendChild(card);
  card.querySelector(".slot-label").textContent = `Slot ${slotCounter}`;

  const categorySelect = card.querySelector(".category-select");
  const searchInput = card.querySelector(".service-search");
  const dropdown = card.querySelector(".service-dropdown");
  const noteEl = card.querySelector(".selected-service-note");
  const qtyInput = card.querySelector(".qty");
  const durationInput = card.querySelector(".duration");
  const randomnessInput = card.querySelector(".randomness");
  const randomnessReadout = card.querySelector(".randomness-readout");
  const graphSelect = card.querySelector(".graph-select");
  const editGraphBtn = card.querySelector(".edit-graph-btn");

  populateCategorySelect(categorySelect);

  function renderDropdown(query) {
    const category = categorySelect.value;
    const list = CATALOG[category] || [];
    const q = (query || "").toLowerCase().trim();
    const filtered = list.filter(
      (svc) => !q || String(svc.id).includes(q) || svc.name.toLowerCase().includes(q)
    );

    dropdown.innerHTML = filtered.length
      ? filtered
          .map(
            (svc) => `
            <div class="service-option" data-id="${svc.id}" data-rate="${svc.rate}" data-name="${svc.name}">
              <span class="opt-id">#${svc.id}</span>${svc.name}
              <span class="opt-rate">$${svc.rate.toFixed(3)}/unit</span>
            </div>
          `
          )
          .join("")
      : `<div class="service-option">No matching services</div>`;
    dropdown.classList.add("open");
  }

  function selectService(id, rate, name) {
    card.dataset.selectedServiceId = id;
    card.dataset.selectedRate = rate;
    searchInput.value = `#${id} — ${name}`;
    noteEl.textContent = `Selected: ${name} · $${parseFloat(rate).toFixed(3)}/unit`;
    noteEl.classList.add("filled");
    dropdown.classList.remove("open");
    refreshEverything();
  }

  searchInput.addEventListener("focus", () => renderDropdown(searchInput.value));
  searchInput.addEventListener("input", () => renderDropdown(searchInput.value));

  document.addEventListener("click", (e) => {
    if (!card.contains(e.target)) dropdown.classList.remove("open");
  });

  dropdown.addEventListener("click", (e) => {
    const opt = e.target.closest(".service-option");
    if (!opt || !opt.dataset.id) return;
    selectService(opt.dataset.id, opt.dataset.rate, opt.dataset.name);
  });

  categorySelect.addEventListener("change", () => {
    card.dataset.selectedServiceId = "";
    card.dataset.selectedRate = "0";
    searchInput.value = "";
    noteEl.textContent = "No service selected yet";
    noteEl.classList.remove("filled");
    refreshEverything();
  });

  randomnessInput.addEventListener("input", () => {
    const value = parseInt(randomnessInput.value, 10);
    randomnessReadout.textContent = value >= 40 ? "40% (Full Random)" : `${value}%`;
    refreshEverything();
  });

  [qtyInput, durationInput, graphSelect].forEach((input) => {
    input.addEventListener("input", () => refreshEverything());
    input.addEventListener("change", () => refreshEverything());
  });

  editGraphBtn.addEventListener("click", () => openGraphModal(card));

  card.querySelector(".remove-btn").addEventListener("click", () => {
    card.remove();
    addLog(`Removed slot ${card.dataset.id}`);
    refreshEverything();
  });

  updateCardPreview(card);
  addLog(`Added slot ${slotCounter}`);
}

// ==========================================
// LEG GENERATION
// ==========================================
function getCurveForCard(card) {
  const graphSelect = card.querySelector(".graph-select");
  if (graphSelect.value === "custom") {
    return card.customGraphPoints || CUSTOM_GRAPH_POINTS;
  }
  return GRAPH_PRESETS[graphSelect.value].points;
}

function jitter(value, percent) {
  const range = value * (percent / 100);
  return value + (Math.random() * 2 - 1) * range;
}

function generateLegs(quantity, durationHours, randomness, curvePoints) {
  const legs = [];

  if (randomness >= 40) {
    // FULL RANDOM MODE — irregular amounts, irregular intervals, spread over 12-24h
    const totalMinutes = (12 + Math.random() * 12) * 60;
    const legCount = 14 + Math.floor(Math.random() * 14); // ~14-28 legs

    const rawWeights = Array.from({ length: legCount }, () => Math.random() + 0.15);
    const weightSum = rawWeights.reduce((a, b) => a + b, 0);

    const rawTimes = [0];
    for (let i = 1; i < legCount; i++) {
      rawTimes.push(rawTimes[i - 1] + Math.random() * (totalMinutes / legCount) * 1.8);
    }
    const maxTime = rawTimes[rawTimes.length - 1] || 1;
    const times = rawTimes.map((t) => Math.round((t / maxTime) * totalMinutes));

    let remaining = quantity;
    rawWeights.forEach((w, i) => {
      const isLast = i === legCount - 1;
      const amount = isLast ? remaining : Math.max(1, Math.round((w / weightSum) * quantity));
      remaining -= amount;
      legs.push({ index: i + 1, amount: Math.max(0, amount), minutesAt: times[i] });
    });
  } else {
    // CURVE MODE — follow the selected shape, with a small jitter for realism
    const weightSum = curvePoints.reduce((a, b) => a + b, 0) || 1;
    let remaining = quantity;
    const totalMinutes = durationHours * 60;

    curvePoints.forEach((weight, i) => {
      const isLast = i === curvePoints.length - 1;
      let amount = isLast ? remaining : Math.round((weight / weightSum) * quantity);
      if (!isLast && randomness > 0) amount = Math.max(0, Math.round(jitter(amount, randomness)));
      remaining -= isLast ? 0 : amount;
      const minutesAt = Math.round((i / (curvePoints.length - 1)) * totalMinutes);
      legs.push({ index: i + 1, amount, minutesAt });
    });

    // fix rounding drift on the final leg so totals always match exactly
    const sumSoFar = legs.reduce((a, l) => a + l.amount, 0);
    legs[legs.length - 1].amount += quantity - sumSoFar;
  }

  return legs.filter((l) => l.amount > 0);
}

// ==========================================
// CARD PREVIEW
// ==========================================
function updateCardPreview(card) {
  const categorySelect = card.querySelector(".category-select");
  const qtyInput = card.querySelector(".qty");
  const durationInput = card.querySelector(".duration");
  const randomnessInput = card.querySelector(".randomness");
  const previewBox = card.querySelector(".legs-preview");
  const previewCostEl = card.querySelector(".preview-cost");

  const serviceLabel = capitalize(categorySelect.value || "service");
  const rate = parseFloat(card.dataset.selectedRate) || 0;
  const quantity = Math.max(0, parseInt(qtyInput.value, 10) || 0);
  const durationHours = Math.max(1, parseInt(durationInput.value, 10) || 24);
  const randomness = Math.min(40, Math.max(1, parseInt(randomnessInput.value, 10) || 1));

  const curvePoints = getCurveForCard(card);
  const legs = generateLegs(quantity, durationHours, randomness, curvePoints).map((l) => ({
    ...l,
    serviceLabel,
  }));

  previewBox.innerHTML = legs
    .map(
      (leg) => `
      <div class="leg-row">
        <span class="leg-dot"></span>
        <span class="leg-label">Leg ${leg.index}</span>
        <span class="leg-amount">${leg.amount.toLocaleString()} ${serviceLabel}</span>
        <span class="leg-time mono">${formatMinutes(leg.minutesAt)}</span>
      </div>
    `
    )
    .join("");

  const cost = quantity * rate;
  previewCostEl.textContent = `$${cost.toFixed(2)}`;

  return { serviceLabel, quantity, cost, legs, serviceId: card.dataset.selectedServiceId };
}

function formatMinutes(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// ==========================================
// SUMMARY
// ==========================================
function updateSummary() {
  const cards = servicesContainer.querySelectorAll(".service-card");
  let totalQty = 0;
  let totalCost = 0;

  cards.forEach((card) => {
    const qtyInput = card.querySelector(".qty");
    const rate = parseFloat(card.dataset.selectedRate) || 0;
    const quantity = Math.max(0, parseInt(qtyInput.value, 10) || 0);
    totalQty += quantity;
    totalCost += quantity * rate;
  });

  totalQtyEl.textContent = totalQty.toLocaleString();
  totalCostEl.textContent = `$${totalCost.toFixed(2)}`;
  graphBigNumEl.textContent = totalQty.toLocaleString();
}

// ==========================================
// SCHEDULES
// ==========================================
function updateSchedule(allLegs) {
  if (allLegs.length === 0) {
    scheduleTable.innerHTML = `<div class="summary-empty">No scheduled legs yet — add a service in the Order tab.</div>`;
    return;
  }

  const sorted = [...allLegs].sort((a, b) => a.minutesAt - b.minutesAt);
  const headRow = `
    <div class="schedule-row head-row">
      <span>ETA</span><span>Service</span><span>Leg</span><span>Amount</span>
    </div>
  `;
  const rows = sorted
    .map(
      (leg) => `
      <div class="schedule-row">
        <span class="sched-time">${formatMinutes(leg.minutesAt)}</span>
        <span>${leg.serviceLabel}</span>
        <span class="sched-status">Leg ${leg.index}</span>
        <span class="mono">${leg.amount.toLocaleString()}</span>
      </div>
    `
    )
    .join("");

  scheduleTable.innerHTML = headRow + rows;
}

// ==========================================
// GROWTH GRAPH
// ==========================================
function updateGraph(allLegs) {
  const line = document.getElementById("graphLine");
  const fill = document.getElementById("graphFill");
  const width = 600, height = 120, padding = 8;

  if (allLegs.length === 0) {
    const flatY = height - padding;
    line.setAttribute("d", `M ${padding} ${flatY} L ${width - padding} ${flatY}`);
    fill.setAttribute("d", `M ${padding} ${flatY} L ${width - padding} ${flatY} L ${width - padding} ${height} L ${padding} ${height} Z`);
    return;
  }

  const sorted = [...allLegs].sort((a, b) => a.minutesAt - b.minutesAt);
  let cumulative = 0;
  const points = sorted.map((leg) => {
    cumulative += leg.amount;
    return { t: leg.minutesAt, v: cumulative };
  });

  const maxT = Math.max(...points.map((p) => p.t), 1);
  const maxV = Math.max(...points.map((p) => p.v), 1);
  const toXY = (p) => [
    padding + (p.t / maxT) * (width - padding * 2),
    height - padding - (p.v / maxV) * (height - padding * 2),
  ];

  const coords = points.map(toXY);
  let linePath = `M ${coords[0][0]} ${coords[0][1]}`;
  coords.slice(1).forEach(([x, y]) => (linePath += ` L ${x} ${y}`));
  const fillPath = `${linePath} L ${coords[coords.length - 1][0]} ${height} L ${coords[0][0]} ${height} Z`;

  line.setAttribute("d", linePath);
  fill.setAttribute("d", fillPath);
}

// ==========================================
// REFRESH EVERYTHING
// ==========================================
function refreshEverything() {
  const cards = servicesContainer.querySelectorAll(".service-card");
  let allLegs = [];

  cards.forEach((card) => {
    const { legs } = updateCardPreview(card);
    allLegs = allLegs.concat(legs);
  });

  updateSummary();
  updateSchedule(allLegs);
  updateGraph(allLegs);
}

// ==========================================
// CUSTOM GRAPH EDITOR (20 draggable dots)
// ==========================================
function openGraphModal(card) {
  editingCard = card;
  const points = card.customGraphPoints ? [...card.customGraphPoints] : [...CUSTOM_GRAPH_POINTS];
  renderGraphEditor(points);
  graphModal.classList.add("open");
}

function renderGraphEditor(points) {
  const width = 600, height = 200, padding = 16;
  const stepX = (width - padding * 2) / (points.length - 1);

  const valueToY = (v) => height - padding - (v / 100) * (height - padding * 2);
  const yToValue = (y) => {
    const clampedY = Math.min(height - padding, Math.max(padding, y));
    return Math.round(((height - padding - clampedY) / (height - padding * 2)) * 100);
  };

  function pathD() {
    return points
      .map((v, i) => `${i === 0 ? "M" : "L"} ${padding + i * stepX} ${valueToY(v)}`)
      .join(" ");
  }

  function draw() {
    const dots = points
      .map(
        (v, i) => `<circle class="graph-dot" data-index="${i}" cx="${padding + i * stepX}" cy="${valueToY(v)}" r="7"></circle>`
      )
      .join("");
    customGraphSvg.innerHTML = `<path d="${pathD()}" fill="none" stroke="#ff2d43" stroke-width="2"></path>${dots}`;
    attachDragHandlers();
  }

  function attachDragHandlers() {
    customGraphSvg.querySelectorAll(".graph-dot").forEach((dot) => {
      dot.addEventListener("pointerdown", (e) => {
        const index = parseInt(dot.dataset.index, 10);
        dot.setPointerCapture(e.pointerId);

        function onMove(ev) {
          const rect = customGraphSvg.getBoundingClientRect();
          const scaleY = height / rect.height;
          const localY = (ev.clientY - rect.top) * scaleY;
          points[index] = yToValue(localY);
          draw();
        }
        function onUp() {
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
        }
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
      });
    });
  }

  draw();
  customGraphSvg._points = points;
}

closeGraphModal.addEventListener("click", () => graphModal.classList.remove("open"));

saveGraphBtn.addEventListener("click", () => {
  const points = customGraphSvg._points;
  if (editingCard) {
    editingCard.customGraphPoints = [...points];
    editingCard.querySelector(".graph-select").value = "custom";
  } else {
    CUSTOM_GRAPH_POINTS = [...points];
  }
  graphModal.classList.remove("open");
  addLog("Saved a custom delivery curve");
  refreshEverything();
});

// ==========================================
// ORDER CREATION / SCHEDULING
// ==========================================
submitOrderBtn.addEventListener("click", () => {
  const cards = servicesContainer.querySelectorAll(".service-card");
  const link = document.getElementById("targetLink").value.trim();
  const name = document.getElementById("scheduleName").value.trim() || "Untitled schedule";

  if (cards.length === 0) {
    orderStatusEl.textContent = "Add at least one service slot first.";
    orderStatusEl.className = "connect-status error";
    return;
  }

  let scheduledLegCount = 0;

  cards.forEach((card) => {
    const { legs, serviceLabel, serviceId } = updateCardPreview(card);
    legs.forEach((leg) => {
      scheduledLegCount += 1;
      const fireInMs = leg.minutesAt * 60000;
      const fireAtClock = new Date(Date.now() + fireInMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

      setTimeout(() => placeLeg(serviceId, serviceLabel, leg.amount, link, fireAtClock), fireInMs);
      addLog(`Queued ${leg.amount.toLocaleString()} ${serviceLabel} for ${fireAtClock}`);
    });
  });

  orderStatusEl.textContent = PANEL.connected
    ? `Schedule "${name}" created — ${scheduledLegCount} legs queued while this tab stays open.`
    : `Schedule "${name}" created in demo mode (no panel connected) — ${scheduledLegCount} legs queued while this tab stays open.`;
  orderStatusEl.className = "connect-status ok";
  addLog(`Order created — "${name}" (${scheduledLegCount} legs)`);
});

async function placeLeg(serviceId, serviceLabel, amount, link, clockLabel) {
  if (!PANEL.connected || !serviceId) {
    addLog(`(Simulated) Delivered ${amount.toLocaleString()} ${serviceLabel} at ${clockLabel}`);
    return;
  }
  try {
    const data = await callPanelAPI(PANEL.baseUrl, PANEL.apiKey, {
      action: "add",
      service: serviceId,
      link,
      quantity: amount,
    });
    addLog(`Placed ${amount.toLocaleString()} ${serviceLabel} at ${clockLabel} — order #${data.order || "?"}`);
  } catch (err) {
    addLog(`Failed to place ${amount.toLocaleString()} ${serviceLabel} at ${clockLabel} — ${err.message}`);
  }
}

// ==========================================
// TRACKER TAB
// ==========================================
let trackerInterval = null;
let trackerViewsData = [];
let trackerLikesData = [];

trackBtn.addEventListener("click", () => {
  const link = trackerLinkInput.value.trim();
  if (!link) return;

  if (trackerInterval) clearInterval(trackerInterval);
  trackerViewsData = [0];
  trackerLikesData = [0];
  addLog(`Started tracking ${link} (simulated)`);

  trackerInterval = setInterval(() => {
    const lastViews = trackerViewsData[trackerViewsData.length - 1];
    const lastLikes = trackerLikesData[trackerLikesData.length - 1];

    trackerViewsData.push(lastViews + Math.round(20 + Math.random() * 80));
    trackerLikesData.push(lastLikes + Math.round(2 + Math.random() * 12));

    if (trackerViewsData.length > 40) {
      trackerViewsData.shift();
      trackerLikesData.shift();
    }

    trackerViewsNumEl.textContent = trackerViewsData[trackerViewsData.length - 1].toLocaleString();
    trackerLikesNumEl.textContent = trackerLikesData[trackerLikesData.length - 1].toLocaleString();
    drawTrackerGraph();
  }, 2000);
});

function drawTrackerGraph() {
  const width = 600, height = 140, padding = 8;
  const viewsLine = document.getElementById("trackerViewsLine");
  const likesLine = document.getElementById("trackerLikesLine");

  function buildPath(data) {
    const max = Math.max(...data, 1);
    const stepX = (width - padding * 2) / Math.max(1, data.length - 1);
    return data
      .map((v, i) => {
        const x = padding + i * stepX;
        const y = height - padding - (v / max) * (height - padding * 2);
        return `${i === 0 ? "M" : "L"} ${x} ${y}`;
      })
      .join(" ");
  }

  const combinedMax = Math.max(...trackerViewsData, 1);
  viewsLine.setAttribute("d", buildPath(trackerViewsData));

  // scale likes against the same max as views isn't ideal since likes are smaller;
  // draw likes on its own scale so the shape is still visible
  likesLine.setAttribute("d", buildPath(trackerLikesData));
}

// ==========================================
// SCHEDULES PASSWORD GATE
// ==========================================
unlockSchedulesBtn.addEventListener("click", () => {
  if (schedulesPasswordInput.value === SCHEDULES_PASSWORD) {
    schedulesUnlocked = true;
    schedulesLocked.style.display = "none";
    schedulesContent.style.display = "block";
    lockErrorEl.textContent = "";
  } else {
    lockErrorEl.textContent = "Incorrect password.";
  }
});

schedulesPasswordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") unlockSchedulesBtn.click();
});

// ==========================================
// MISC
// ==========================================
presetsBtn.addEventListener("click", () => addLog("Opened saved presets"));

// ==========================================
// INIT
// ==========================================
addServiceBtn.addEventListener("click", () => {
  createServiceSlot();
  refreshEverything();
});

addLog("Session started");
createServiceSlot();
refreshEverything();