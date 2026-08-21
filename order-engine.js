(function () {
  const SERVICE_META = {
    likes: { icon: "❤️", name: "Likes" },
    shares: { icon: "📤", name: "Shares" },
    saves: { icon: "🔖", name: "Saves" },
    reposts: { icon: "🔁", name: "Reposts" },
    comments: { icon: "💬", name: "Comments" },
  };
  const ENGAGEMENT_TYPES = Object.keys(SERVICE_META);

  let ratios = {}; // { likes: 0.05, ... }
  let rates = {};  // { views: 0.5, likes: 0.6, ... }
  let enabled = { likes: true, shares: true, saves: true, reposts: true, comments: true };
  let walletBalance = 0;

  function el(html) {
    const div = document.createElement("div");
    div.innerHTML = html.trim();
    return div.firstChild;
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
    for (const t of ENGAGEMENT_TYPES) {
      out[t] = Math.max(1, Math.round(viewsQty * (ratios[t] || 0)));
    }
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
        <label class="kmp-switch">
          <input type="checkbox" checked data-role="toggle">
          <span class="slider"></span>
        </label>
      </div>
    `;
  }

  function buildBuilder() {
    return el(`
      <div class="kmp-builder" id="kmpBuilder">
        <div class="kmp-builder-header">
          <h2>🚀 KM Auto Order Builder</h2>
          <p class="kmp-muted" style="margin:0;color:#888;font-size:0.85rem;">Fully automatic delivery, charged from your Panel Wallet.</p>
        </div>

        <div class="kmp-section">
          <div class="kmp-section-title">Order Details</div>
          <div class="kmp-field"><label>Order Name</label><input id="kmpName" placeholder="e.g. Reel launch push"></div>
          <div class="kmp-field"><label>Link</label><input id="kmpLink" placeholder="https://instagram.com/p/..."></div>
          <div class="kmp-field">
            <label>Platform</label>
            <select id="kmpPlatform">
              <option value="instagram">Instagram</option>
              <option value="tiktok">TikTok</option>
              <option value="youtube">YouTube</option>
            </select>
          </div>
          <div class="kmp-field">
            <label>Mode</label>
            <select id="kmpMode">
              <option value="viral" selected>Viral</option>
              <option value="fast">Fast</option>
              <option value="trending">Trending</option>
              <option value="slow">Slow</option>
            </select>
          </div>
          <div class="kmp-field">
            <label>Views Quantity</label>
            <span class="kmp-views-badge">👁 Base service</span>
            <input id="kmpViewsQty" type="number" min="1" placeholder="e.g. 5000">
          </div>
        </div>

        <div class="kmp-section">
          <div class="kmp-section-title">Engagement Services</div>
          <div id="kmpServiceRows">
            ${ENGAGEMENT_TYPES.map(serviceRowHtml).join("")}
          </div>
        </div>

        <div class="kmp-section" id="kmpCommentsSection">
          <div class="kmp-section-title">Custom Comment</div>
          <div class="kmp-field">
            <textarea id="kmpCommentText" placeholder="Enter the comment text to be used for the Comments service..."></textarea>
          </div>
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
      const qtyEl = row.querySelector('[data-role="qty"] strong');
      qtyEl.textContent = viewsQty > 0 ? quantities[type].toLocaleString() : "—";
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
    for (const t of enabledList) {
      rows += `<div class="kmp-summary-row"><span>${SERVICE_META[t].icon} ${SERVICE_META[t].name}</span><span>${quantities[t].toLocaleString()}</span></div>`;
    }
    rows += `<div class="kmp-summary-row"><span class="muted">Wallet balance</span><span>₹${walletBalance.toFixed(2)}</span></div>`;
    rows += `<div class="kmp-summary-row ${remaining < 0 ? "negative" : ""}"><span class="muted">Balance after order</span><span>₹${remaining.toFixed(2)}</span></div>`;
    rows += `<div class="kmp-summary-row total"><span>Estimated Cost</span><span>₹${cost.toFixed(2)}</span></div>`;
    box.innerHTML = rows;

    document.getElementById("kmpPlaceBtn").disabled = remaining < 0;
  }

  function recalc() {
    const viewsQty = Number(document.getElementById("kmpViewsQty").value) || 0;
    const quantities = updateServiceRows(viewsQty);
    updateSummary(viewsQty, quantities);
    return { viewsQty, quantities };
  }

  async function fetchAutoOrders() {
    const res = await fetch("/api/orders");
    return res.json();
  }
  async function fetchManualOrders() {
    const res = await fetch("/api/session?view=manual-orders");
    return res.json();
  }

  async function loadHistory() {
    const box = document.getElementById("kmpOrderHistory");
    if (!box) return;
    const [autoRes, manualRes] = await Promise.all([fetchAutoOrders(), fetchManualOrders()]);
    const auto = (autoRes.success ? autoRes.orders : []).map((o) => ({ ...o, source: "auto", qty: o.views_quantity, label: o.order_name || o.link }));
    const manual = (manualRes.success ? manualRes.orders : []).map((o) => ({ ...o, source: "manual", qty: o.quantity, label: o.service_name || o.link }));
    const all = [...auto, ...manual].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (!all.length) {
      box.innerHTML = '<div class="kmp-empty">No orders yet.</div>';
      return;
    }
    box.innerHTML = all.slice(0, 30).map((o) => `
      <div class="kmp-history-row">
        <span><span class="kmp-tag ${o.source}">${o.source.toUpperCase()}</span> ${(o.label || "").slice(0, 28)}${(o.label || "").length > 28 ? "…" : ""}</span>
        <span>${o.qty} · ${o.status}</span>
      </div>
    `).join("");
  }

  function wireBuilder() {
    document.getElementById("kmpViewsQty").addEventListener("input", recalc);

    document.querySelectorAll('.kmp-service-row [data-role="toggle"]').forEach((toggle) => {
      toggle.addEventListener("change", (e) => {
        const row = e.target.closest(".kmp-service-row");
        const type = row.dataset.type;
        enabled[type] = e.target.checked;
        row.classList.toggle("off", !e.target.checked);
        if (type === "comments") {
          document.getElementById("kmpCommentsSection").style.display = e.target.checked ? "block" : "none";
        }
        recalc();
      });
    });

    document.getElementById("kmpPlaceBtn").addEventListener("click", async () => {
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

      const btn = document.getElementById("kmpPlaceBtn");
      btn.disabled = true;
      btn.textContent = "Placing order…";

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderName, platform, link, mode, viewsQuantity,
          enabledServices: enabled,
          commentText: enabled.comments ? commentText : null,
        }),
      });
      const data = await res.json();
      btn.textContent = "Place Auto Order";
      btn.disabled = false;

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
      await loadRatiosAndWallet();
      recalc();
      await loadHistory();
    });
  }

  function buildOuterToggle() {
    return el(`
      <div class="kmp-outer-toggle" id="kmpOuterToggle">
        <button class="active" data-target="auto">🚀 KM Auto Engine</button>
        <button data-target="manual">🔧 Manual (Your Panel)</button>
      </div>
    `);
  }

  document.addEventListener("DOMContentLoaded", async function () {
    const orderTab = document.getElementById("tab-order");
    if (!orderTab) return;

    const existingCard = orderTab.querySelector(".create-order-card");
    if (!existingCard) return;

    // Rename the existing inner "Auto" toggle button only — no logic touched.
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

      if (btn.dataset.target === "auto") {
        builder.style.display = "block";
        existingCard.style.display = "none";
      } else {
        builder.style.display = "none";
        existingCard.style.display = "block";
      }
    });
  });
})();
