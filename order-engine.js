(function () {
  function el(html) {
    const div = document.createElement("div");
    div.innerHTML = html.trim();
    return div.firstChild;
  }

  async function createAutoOrder(payload) {
    const res = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    return res.json();
  }
  async function fetchAutoOrders() {
    const res = await fetch("/api/orders");
    return res.json();
  }
  async function fetchManualOrders() {
    const res = await fetch("/api/session?view=manual-orders");
    return res.json();
  }

  function buildEngineCard() {
    return el(`
      <div class="kmp-engine-card" id="kmpEngineCard">
        <h2>🚀 KM Auto Engine</h2>
        <p class="kmp-muted" style="margin:0 0 12px;">Fully automatic delivery — no provider setup needed. Charged from your Panel Wallet.</p>

        <div class="field-block"><span class="field-label">Platform</span>
          <select class="input full" id="kmpPlatform">
            <option value="instagram">Instagram</option>
            <option value="tiktok">TikTok</option>
            <option value="youtube">YouTube</option>
          </select>
        </div>
        <div class="field-block"><span class="field-label">Link</span>
          <input class="input full" id="kmpLink" placeholder="https://instagram.com/p/...">
        </div>
        <div class="field-block"><span class="field-label">Mode</span>
          <select class="input full" id="kmpMode">
            <option value="viral" selected>Viral</option>
            <option value="fast">Fast</option>
            <option value="trending">Trending</option>
            <option value="slow">Slow</option>
          </select>
        </div>
        <div class="field-block"><span class="field-label">Views quantity</span>
          <input class="input full" id="kmpViewsQty" type="number" placeholder="e.g. 5000" min="1">
        </div>

        <div class="kmp-error" id="kmpOrderError" style="display:none;"></div>
        <button class="submit-btn" id="kmpCreateOrderBtn">Create Order</button>

        <div style="margin-top:18px;">
          <div class="card-title" style="font-size:0.9rem;">Order history</div>
          <div id="kmpOrderHistory"><div class="kmp-empty">Loading…</div></div>
        </div>
      </div>
    `);
  }

  async function loadHistory() {
    const box = document.getElementById("kmpOrderHistory");
    if (!box) return;
    const [autoRes, manualRes] = await Promise.all([fetchAutoOrders(), fetchManualOrders()]);
    const auto = (autoRes.success ? autoRes.orders : []).map((o) => ({ ...o, source: "auto", qty: o.views_quantity, cost: o.customer_cost }));
    const manual = (manualRes.success ? manualRes.orders : []).map((o) => ({ ...o, source: "manual", qty: o.quantity }));
    const all = [...auto, ...manual].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (!all.length) {
      box.innerHTML = '<div class="kmp-empty">No orders yet.</div>';
      return;
    }
    box.innerHTML = all.slice(0, 30).map((o) => `
      <div class="kmp-history-row">
        <span><span class="kmp-tag ${o.source}">${o.source.toUpperCase()}</span> ${o.link ? o.link.slice(0, 30) : ""}${o.link && o.link.length > 30 ? "…" : ""}</span>
        <span>${o.qty} · ${o.status}</span>
      </div>
    `).join("");
  }

  function wireEngineCard() {
    document.getElementById("kmpCreateOrderBtn").addEventListener("click", async () => {
      const platform = document.getElementById("kmpPlatform").value;
      const link = document.getElementById("kmpLink").value.trim();
      const mode = document.getElementById("kmpMode").value;
      const viewsQuantity = Number(document.getElementById("kmpViewsQty").value);
      const errEl = document.getElementById("kmpOrderError");
      const btn = document.getElementById("kmpCreateOrderBtn");
      errEl.style.display = "none";

      if (!link) { errEl.textContent = "Enter a link."; errEl.style.display = "block"; return; }
      if (!viewsQuantity || viewsQuantity <= 0) { errEl.textContent = "Enter a valid views quantity."; errEl.style.display = "block"; return; }

      btn.disabled = true;
      btn.textContent = "Creating…";
      const data = await createAutoOrder({ platform, link, mode, viewsQuantity });
      btn.disabled = false;
      btn.textContent = "Create Order";

      if (!data.success) {
        errEl.textContent = data.error + (data.required ? ` (need ₹${data.required}, have ₹${data.available})` : "");
        errEl.style.display = "block";
        return;
      }
      document.getElementById("kmpLink").value = "";
      document.getElementById("kmpViewsQty").value = "";
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

  document.addEventListener("DOMContentLoaded", function () {
    const orderTab = document.getElementById("tab-order");
    if (!orderTab) return;

    const existingCard = orderTab.querySelector(".create-order-card");
    if (!existingCard) return;

    // Rename the existing inner "Auto" toggle button to avoid confusion
    // with the new top-level "KM Auto Engine" — label only, no logic touched.
    const innerAutoBtn = existingCard.querySelector("#autoModeBtn");
    if (innerAutoBtn) innerAutoBtn.textContent = "✨ Auto-fill";

    const outerToggle = buildOuterToggle();
    const engineCard = buildEngineCard();

    orderTab.insertBefore(outerToggle, existingCard);
    orderTab.insertBefore(engineCard, existingCard);

    existingCard.style.display = "none"; // Manual is not the default view
    wireEngineCard();
    loadHistory();

    outerToggle.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-target]");
      if (!btn) return;
      outerToggle.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      if (btn.dataset.target === "auto") {
        engineCard.style.display = "block";
        existingCard.style.display = "none";
      } else {
        engineCard.style.display = "none";
        existingCard.style.display = "block";
      }
    });
  });
})();
