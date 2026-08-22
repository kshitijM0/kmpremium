(function () {
  const SERVICE_META = {
    likes: { icon: "❤️", name: "Likes", color: "#f87171" },
    shares: { icon: "📤", name: "Shares", color: "#a855f7" },
    saves: { icon: "🔖", name: "Saves", color: "#f59e0b" },
    reposts: { icon: "🔁", name: "Reposts", color: "#fb7185" },
    comments: { icon: "💬", name: "Comments", color: "#facc15" },
  };
  const ENGAGEMENT_TYPES = Object.keys(SERVICE_META);
  const VIEWS_COLOR = "#22c55e";

  // Mirrors render-auto-engine/offsets.js MODE_PRESETS exactly — this is a
  // PREVIEW only; the server (Vercel at order-creation, Render at delivery)
  // remains authoritative for actual billed/delivered quantities.
  const MODE_PRESETS = {
    viral: { minLegs: 12, maxLegs: 30, minDurationMin: 180, maxDurationMin: 480, variance: 18 },
    fast: { minLegs: 3, maxLegs: 8, minDurationMin: 20, maxDurationMin: 90, variance: 10 },
    trending: { minLegs: 10, maxLegs: 20, minDurationMin: 120, maxDurationMin: 300, variance: 14 },
    slow: { minLegs: 25, maxLegs: 60, minDurationMin: 480, maxDurationMin: 1440, variance: 8 },
  };

  let ratios = {};
  let rates = {};
  let enabled = { likes: true, shares: true, saves: true, reposts: true, comments: true };
  let walletBalance = 0;
  let idempotencyKey = crypto.randomUUID();
  let isSubmitting = false; // second layer of duplicate-submit protection (server also enforces via idempotency_key)

  function el(html) {
    const div = document.createElement("div");
    div.innerHTML = html.trim();
    return div.firstChild;
  }

  // ---------- mirrors render-auto-engine/bellCurve.js — PREVIEW ONLY ----------
  function previewBellCurve(total, legCount, variancePercent) {
    if (legCount <= 1) return [total];
    const weights = [];
    for (let i = 0; i < legCount; i++) {
      const x = (i / (legCount - 1)) * 2 - 1;
      const base = Math.exp(-Math.pow(x * 1.6, 2));
      weights.push(Math.max(0.05, base)); // no per-render-call randomness in the preview — stable while the user looks at it
    }
    const sum = weights.reduce((a, b) => a + b, 0);
    const raw = weights.map((w) => (w / sum) * total);
    return raw.map((q) => Math.max(0, Math.round(q)));
  }

  function seededLegCount(mode, viewsQty) {
    const p = MODE_PRESETS[mode] || MODE_PRESETS.viral;
    // Deterministic-for-preview leg count (a representative mid-range value,
    // not randomized every recalculation, so the graph doesn't jitter while typing).
    return Math.round((p.minLegs + p.maxLegs) / 2);
  }
  function seededDuration(mode) {
    const p = MODE_PRESETS[mode] || MODE_PRESETS.viral;
    return Math.round((p.minDurationMin + p.maxDurationMin) / 2);
  }

  async function loadRatiosAndWallet() {
    const [ratiosRes, walletRes] = await Promise.all([
      fetch("/api/orders?view=ratios").then((r) => r.json()),
      fetch("/api/session?view=wallet").then((r) => r.json()),
    ]);
    if (ratiosRes.success) {
      ratios = Object.fromEntries(ratiosRes.ratios.map((r) => [r.service_type, Number(r.ratio)]));
      rates = ratiosRes.rates || {};
    }
    if (walletRes.success) walletBalance = Number(walletRes.walletBalance);
  }

  function calcQuantities(viewsQty) {
    const out = {};
    for (const t of ENGAGEMENT_TYPES) out[t] = Math.max(1, Math.round(viewsQty * (ratios[t] || 0)));
    return out;
  }
  function calcCost(viewsQty, quantities) {
    let total = (viewsQty / 1000) * (rates.views || 0);
    for (const t of ENGAGEMENT_TYPES) {
      if (enabled[t] === false) continue;
      total += (quantities[t] / 1000) * (rates[t] || 0);
    }
    return Math.round(total * 100) / 100;
  }

  function serviceRowHtml(type) {
    const meta = SERVICE_META[type];
    return `
      <div class="kmp-service-row" data-type="${type}">
        <span class="kmp-service-icon">${meta.icon}</span>
        <div class="kmp-service-info">
          <div class="kmp-service-name">${meta.name}</div>
          <div class="kmp-service-qty" data-role="qty">Quantity: <strong>—</strong></div>
        </div>
        <label class="kmp-switch"><input type="checkbox" checked data-role="toggle"><span class="slider"></span></label>
      </div>
    `;
  }

  function buildBuilder() {
    return el(`
      <div class="kmp-builder" id="kmpBuilder">
        <div class="kmp-builder-header">
          <h2>🚀 KM Auto Order Builder</h2>
          <p style="margin:0;color:#888;font-size:0.85rem;">Fully automatic delivery, charged from your Panel Wallet.</p>
        </div>

        <div class="kmp-section">
          <div class="kmp-section-title">Order Details</div>
          <div class="kmp-field"><label>Order Name</label><input id="kmpName" placeholder="e.g. Reel launch push"></div>
          <div class="kmp-field"><label>Link</label><input id="kmpLink" placeholder="https://instagram.com/p/..."></div>
          <div class="kmp-field"><label>Platform</label>
            <select id="kmpPlatform"><option value="instagram">Instagram</option><option value="tiktok">TikTok</option><option value="youtube">YouTube</option></select>
          </div>
          <div class="kmp-field"><label>Mode</label>
            <select id="kmpMode"><option value="viral" selected>Viral</option><option value="fast">Fast</option><option value="trending">Trending</option><option value="slow">Slow</option></select>
          </div>
          <div class="kmp-field"><label>Views Quantity</label><span class="kmp-views-badge">👁 Base service</span>
            <input id="kmpViewsQty" type="number" min="1" placeholder="e.g. 5000">
          </div>
        </div>

        <div class="kmp-section">
          <div class="kmp-section-title">Engagement Services</div>
          <div id="kmpServiceRows">${ENGAGEMENT_TYPES.map(serviceRowHtml).join("")}</div>
        </div>

        <div class="kmp-section">
          <div class="kmp-section-title">Delivery Preview</div>
          <div class="kmp-graph-legend" id="kmpGraphLegend"></div>
          <div class="kmp-graph-wrap">
            <svg id="kmpGraphSvg" viewBox="0 0 600 220" style="width:100%; height:auto; display:block;"></svg>
            <div class="kmp-tooltip" id="kmpTooltip"></div>
          </div>
          <div class="kmp-graph-note">Estimated delivery — final quantities may vary naturally. The server remains authoritative for billing and delivery.</div>
        </div>

        <div class="kmp-section" id="kmpCommentsSection">
          <div class="kmp-section-title">Custom Comment</div>
          <div class="kmp-field"><textarea id="kmpCommentText" placeholder="Enter the comment text to be used for the Comments service..."></textarea></div>
        </div>

        <div class="kmp-section">
          <div class="kmp-section-title">Summary</div>
          <div class="kmp-summary" id="kmpSummary"></div>
          <div class="kmp-error" id="kmpOrderError" style="display:none;"></div>
          <div class="kmp-success" id="kmpOrderSuccess" style="display:none;"></div>
          <button class="kmp-place-btn" id="kmpPlaceBtn">Place Auto Order</button>
        </div>

        <div class="kmp-section" style="border-bottom:none; margin-bottom:0; padding-bottom:0;">
          <div class="kmp-section-title">Order History</div>
          <div id="kmpOrderHistory"><div class="kmp-empty">Loading…</div></div>
        </div>
      </div>
    `);
  }

  function updateServiceRows(viewsQty) {
    const quantities = viewsQty > 0 ? calcQuantities(viewsQty) : {};
    for (const type of ENGAGEMENT_TYPES) {
      const row = document.querySelector(`.kmp-service-row[data-type="${type}"]`);
      if (!row) continue;
      row.querySelector('[data-role="qty"] strong').textContent = viewsQty > 0 ? quantities[type].toLocaleString() : "—";
    }
    return quantities;
  }

  function updateSummary(viewsQty, quantities) {
    const box = document.getElementById("kmpSummary");
    if (!viewsQty || viewsQty <= 0) {
      box.innerHTML = '<div class="kmp-summary-row muted">Enter a Views quantity to see the summary.</div>';
      document.getElementById("kmpPlaceBtn").disabled = true;
      return;
    }
    const cost = calcCost(viewsQty, quantities);
    const remaining = walletBalance - cost;
    const enabledList = ENGAGEMENT_TYPES.filter((t) => enabled[t] !== false);

    let rows = `<div class="kmp-summary-row"><span>👁 Views</span><span>${viewsQty.toLocaleString()}</span></div>`;
    for (const t of enabledList) rows += `<div class="kmp-summary-row"><span>${SERVICE_META[t].icon} ${SERVICE_META[t].name}</span><span>${quantities[t].toLocaleString()}</span></div>`;
    rows += `<div class="kmp-summary-row"><span class="muted">Wallet balance</span><span>₹${walletBalance.toFixed(2)}</span></div>`;
    rows += `<div class="kmp-summary-row ${remaining < 0 ? "negative" : ""}"><span class="muted">Balance after order</span><span>₹${remaining.toFixed(2)}</span></div>`;
    rows += `<div class="kmp-summary-row total"><span>Estimated Cost</span><span>₹${cost.toFixed(2)}</span></div>`;
    box.innerHTML = rows;

    document.getElementById("kmpPlaceBtn").disabled = remaining < 0 || isSubmitting;
  }

  // ---------- Graph ----------
  let graphSeries = null; // { legCount, durationMinutes, points: [{minutes, views, likes, ...}] }

  function buildGraphSeries(viewsQty, mode, quantities) {
    const legCount = seededLegCount(mode, viewsQty);
    const durationMinutes = seededDuration(mode);
    const variance = (MODE_PRESETS[mode] || MODE_PRESETS.viral).variance;

    const viewsLegs = previewBellCurve(viewsQty, legCount, variance);
    const perType = {};
    for (const t of ENGAGEMENT_TYPES) {
      if (enabled[t] === false) continue;
      perType[t] = previewBellCurve(quantities[t], legCount, variance);
    }

    const points = [];
    for (let i = 0; i < legCount; i++) {
      const minutes = Math.round((i / (legCount - 1 || 1)) * durationMinutes);
      const p = { minutes, views: viewsLegs[i] };
      for (const t of Object.keys(perType)) p[t] = perType[t][i];
      points.push(p);
    }
    return { legCount, durationMinutes, points };
  }

  function fmtTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  function renderGraph(series) {
    const svg = document.getElementById("kmpGraphSvg");
    const legend = document.getElementById("kmpGraphLegend");
    if (!series || !series.points.length) {
      svg.innerHTML = "";
      legend.innerHTML = "";
      return;
    }

    const activeSeriesKeys = ["views", ...ENGAGEMENT_TYPES.filter((t) => enabled[t] !== false)];
    const colorFor = (k) => (k === "views" ? VIEWS_COLOR : SERVICE_META[k].color);
    legend.innerHTML = activeSeriesKeys.map((k) => `<span><i style="background:${colorFor(k)}"></i>${k === "views" ? "Views" : SERVICE_META[k].name}</span>`).join("");

    const W = 600, H = 220, padL = 34, padR = 10, padT = 10, padB = 24;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const n = series.points.length;
    const maxVal = Math.max(1, ...series.points.map((p) => p.views));

    const x = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v) => padT + plotH - (v / maxVal) * plotH;

    let svgHtml = "";
    for (const key of activeSeriesKeys) {
      const color = colorFor(key);
      const path = series.points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p[key] || 0).toFixed(1)}`).join(" ");
      svgHtml += `<path d="${path}" fill="none" stroke="${color}" stroke-width="${key === "views" ? 2.4 : 1.6}" opacity="${key === "views" ? 1 : 0.85}"/>`;
    }
    // Invisible wide hit-targets for hover, one per point index.
    svgHtml += series.points.map((p, i) => `<circle data-i="${i}" cx="${x(i).toFixed(1)}" cy="${padT}" r="10" fill="transparent" style="cursor:pointer;"/>`).join("");
    svgHtml += series.points.map((p, i) => `<line x1="${x(i).toFixed(1)}" y1="${padT}" x2="${x(i).toFixed(1)}" y2="${padT + plotH}" stroke="#222" stroke-width="1" data-hoverline="${i}" opacity="0"/>`).join("");

    svg.innerHTML = svgHtml;

    const tooltip = document.getElementById("kmpTooltip");
    const wrap = svg.parentElement;

    svg.querySelectorAll("circle[data-i]").forEach((c) => {
      c.addEventListener("mouseenter", () => showTooltip(Number(c.dataset.i), series, x, y, wrap, tooltip));
      c.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });
    });
  }

  function showTooltip(i, series, xFn, yFn, wrap, tooltip) {
    const p = series.points[i];
    const rows = [`<div class="t-row"><span>👁 Views</span><strong>${p.views.toLocaleString()}</strong></div>`];
    for (const t of ENGAGEMENT_TYPES) {
      if (enabled[t] === false || p[t] === undefined) continue;
      rows.push(`<div class="t-row"><span>${SERVICE_META[t].icon} ${SERVICE_META[t].name}</span><strong>${p[t].toLocaleString()}</strong></div>`);
    }
    tooltip.innerHTML = `<div class="t-time">Time: ${fmtTime(p.minutes)}</div>${rows.join("")}`;
    tooltip.style.display = "block";

    const wrapRect = wrap.getBoundingClientRect();
    const scaleX = wrapRect.width / 600;
    const px = xFn(i) * scaleX;
    tooltip.style.left = Math.min(wrapRect.width - 140, Math.max(4, px - 60)) + "px";
    tooltip.style.top = "6px";
  }

  function recalc() {
    const viewsQty = Number(document.getElementById("kmpViewsQty").value) || 0;
    const mode = document.getElementById("kmpMode").value;
    const quantities = updateServiceRows(viewsQty);
    updateSummary(viewsQty, quantities);

    if (viewsQty > 0) {
      graphSeries = buildGraphSeries(viewsQty, mode, quantities);
      renderGraph(graphSeries);
    } else {
      renderGraph(null);
    }
    return { viewsQty, quantities };
  }

  async function fetchAutoOrders() { return fetch("/api/orders").then((r) => r.json()); }
  async function fetchManualOrders() { return fetch("/api/session?view=manual-orders").then((r) => r.json()); }

  async function loadHistory() {
    const box = document.getElementById("kmpOrderHistory");
    if (!box) return;
    const [autoRes, manualRes] = await Promise.all([fetchAutoOrders(), fetchManualOrders()]);
    const auto = (autoRes.success ? autoRes.orders : []).map((o) => ({ ...o, source: "auto", qty: o.views_quantity, label: o.order_name || o.link }));
    const manual = (manualRes.success ? manualRes.orders : []).map((o) => ({ ...o, source: "manual", qty: o.quantity, label: o.service_name || o.link }));
    const all = [...auto, ...manual].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (!all.length) { box.innerHTML = '<div class="kmp-empty">No orders yet.</div>'; return; }
    box.innerHTML = all.slice(0, 30).map((o) => `
      <div class="kmp-history-row">
        <span><span class="kmp-tag ${o.source}">${o.source.toUpperCase()}</span> ${(o.label || "").slice(0, 28)}${(o.label || "").length > 28 ? "…" : ""}</span>
        <span>${o.qty} · ${o.status}</span>
      </div>
    `).join("");
  }

  function wireBuilder() {
    document.getElementById("kmpViewsQty").addEventListener("input", recalc);
    document.getElementById("kmpMode").addEventListener("change", recalc);

    document.querySelectorAll('.kmp-service-row [data-role="toggle"]').forEach((toggle) => {
      toggle.addEventListener("change", (e) => {
        const row = e.target.closest(".kmp-service-row");
        const type = row.dataset.type;
        enabled[type] = e.target.checked;
        row.classList.toggle("off", !e.target.checked);
        if (type === "comments") document.getElementById("kmpCommentsSection").style.display = e.target.checked ? "block" : "none";
        recalc();
      });
    });

    const placeBtn = document.getElementById("kmpPlaceBtn");
    placeBtn.addEventListener("click", async () => {
      // Guard #1 (client): ignore if a submission is already in flight.
      if (isSubmitting) return;

      const errEl = document.getElementById("kmpOrderError");
      const okEl = document.getElementById("kmpOrderSuccess");
      errEl.style.display = "none";
      okEl.style.display = "none";

      const orderName = document.getElementById("kmpName").value.trim();
      const link = document.getElementById("kmpLink").value.trim();
      const platform = document.getElementById("kmpPlatform").value;
      const mode = document.getElementById("kmpMode").value;
      const viewsQuantity = Number(document.getElementById("kmpViewsQty").value);
      const commentText = document.getElementById("kmpCommentText").value.trim();

      if (!link) { errEl.textContent = "Enter a link."; errEl.style.display = "block"; return; }
      if (!viewsQuantity || viewsQuantity <= 0) { errEl.textContent = "Enter a valid views quantity."; errEl.style.display = "block"; return; }
      if (enabled.comments && !commentText) { errEl.textContent = "Comments is ON — enter a comment, or turn Comments off."; errEl.style.display = "block"; return; }

      isSubmitting = true;
      placeBtn.disabled = true;
      placeBtn.textContent = "Placing order…";

      try {
        const res = await fetch("/api/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderName, platform, link, mode, viewsQuantity,
            enabledServices: enabled,
            commentText: enabled.comments ? commentText : null,
            idempotencyKey, // Guard #2 (server, authoritative): same key = same order, replay-safe
          }),
        });
        const data = await res.json();

        if (!data.success) {
          errEl.textContent = data.error + (data.required ? ` (need ₹${data.required}, have ₹${data.available})` : "");
          errEl.style.display = "block";
          return;
        }

        okEl.textContent = `Order placed! ID: ${data.orderId} — Charged ₹${data.customerCost}`;
        okEl.style.display = "block";
        document.getElementById("kmpLink").value = "";
        document.getElementById("kmpViewsQty").value = "";
        document.getElementById("kmpName").value = "";
        document.getElementById("kmpCommentText").value = "";
        idempotencyKey = crypto.randomUUID(); // fresh key for the NEXT distinct order
        await loadRatiosAndWallet();
        recalc();
        await loadHistory();
      } finally {
        isSubmitting = false;
        placeBtn.textContent = "Place Auto Order";
        placeBtn.disabled = false;
      }
    });
  }

  function buildOuterToggle() {
    return el(`<div class="kmp-outer-toggle" id="kmpOuterToggle"><button class="active" data-target="auto">🚀 KM Auto Engine</button><button data-target="manual">🔧 Manual (Your Panel)</button></div>`);
  }

  document.addEventListener("DOMContentLoaded", async function () {
    const orderTab = document.getElementById("tab-order");
    if (!orderTab) return;

    const existingCard = orderTab.querySelector(".create-order-card");
    if (!existingCard) return;

    const innerAutoBtn = existingCard.querySelector("#autoModeBtn");
    if (innerAutoBtn) innerAutoBtn.textContent = "✨ Auto-fill";

    const outerToggle = buildOuterToggle();
    const builder = buildBuilder();

    orderTab.insertBefore(outerToggle, existingCard);
    orderTab.insertBefore(builder, existingCard);
    existingCard.style.display = "none";

    await loadRatiosAndWallet();
    wireBuilder();
    recalc();
    loadHistory();

    outerToggle.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-target]");
      if (!btn) return;
      outerToggle.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (btn.dataset.target === "auto") { builder.style.display = "block"; existingCard.style.display = "none"; }
      else { builder.style.display = "none"; existingCard.style.display = "block"; }
    });
  });
})();
