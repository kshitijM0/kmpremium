(function () {
  function el(html) {
    const div = document.createElement("div");
    div.innerHTML = html.trim();
    return div.firstChild;
  }

  async function api(action, body) {
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...body }),
    });
    return res.json();
  }
  async function apiGet(view, extra) {
    const qs = new URLSearchParams({ view, ...extra });
    const res = await fetch("/api/session?" + qs.toString());
    return res.json();
  }

  async function renderWalletCard(container) {
    const card = el(`
      <div class="kmp-card">
        <h2>💳 Panel Wallet</h2>
        <div class="kmp-balance" id="kmpWalletBalance">—</div>
        <div class="kmp-row">
          <a class="kmp-btn secondary" href="/wallet">Add Funds</a>
          <a class="kmp-btn ghost" href="/wallet">Deposit history / transactions</a>
        </div>
      </div>
    `);
    container.appendChild(card);

    const data = await apiGet("wallet");
    if (data.success) {
      document.getElementById("kmpWalletBalance").textContent = "₹" + Number(data.walletBalance).toFixed(2);
    } else {
      document.getElementById("kmpWalletBalance").textContent = "—";
    }
  }

  function apiItemHtml(p) {
    return `
      <div class="kmp-api-item" data-id="${p.id}">
        <div class="top">
          <strong>${p.profile_name}</strong>
          <span class="kmp-badge ${p.status}">${p.status}</span>
        </div>
        <div class="kmp-muted" style="margin-bottom:8px; word-break:break-all;">${p.api_url}</div>
        <div class="kmp-row">
          <button class="kmp-btn ghost" data-action="test">Test Connection</button>
          <button class="kmp-btn ghost" data-action="fetch">Fetch Services</button>
          <button class="kmp-btn ghost" data-action="toggle">${p.status === "active" ? "Disable" : "Enable"}</button>
          <button class="kmp-btn ghost" style="color:#f87171;border-color:#f87171;" data-action="delete">Delete</button>
        </div>
        <div class="kmp-error" data-role="msg" style="display:none;"></div>
      </div>
    `;
  }

  async function renderMyApisCard(container) {
    const card = el(`
      <div class="kmp-card">
        <h2>🧩 My APIs</h2>
        <p class="kmp-muted">Connect your own SMM panels — used only by Manual Order. Your services stay separate from every other customer's.</p>

        <div id="kmpApiList"></div>

        <div style="margin-top:12px; border-top:1px solid #262626; padding-top:12px;">
          <input class="kmp-input" id="kmpNewApiName" placeholder="Profile name (optional)">
          <input class="kmp-input" id="kmpNewApiUrl" placeholder="Panel API URL (https://...)">
          <input class="kmp-input" id="kmpNewApiKey" placeholder="API key" type="password">
          <div class="kmp-error" id="kmpNewApiError" style="display:none;"></div>
          <button class="kmp-btn secondary" id="kmpAddApiBtn">+ Add API</button>
        </div>
      </div>
    `);
    container.appendChild(card);

    async function loadList() {
      const listEl = document.getElementById("kmpApiList");
      listEl.innerHTML = '<div class="kmp-empty">Loading…</div>';
      const data = await apiGet("my-apis");
      if (!data.success || !data.profiles.length) {
        listEl.innerHTML = '<div class="kmp-empty">No APIs connected yet.</div>';
        return;
      }
      listEl.innerHTML = data.profiles.map(apiItemHtml).join("");
    }

    document.getElementById("kmpAddApiBtn").addEventListener("click", async () => {
      const profileName = document.getElementById("kmpNewApiName").value.trim();
      const apiUrl = document.getElementById("kmpNewApiUrl").value.trim();
      const apiKey = document.getElementById("kmpNewApiKey").value.trim();
      const errEl = document.getElementById("kmpNewApiError");
      errEl.style.display = "none";

      const data = await api("create-my-api", { profileName, apiUrl, apiKey });
      if (!data.success) {
        errEl.textContent = data.error;
        errEl.style.display = "block";
        return;
      }
      document.getElementById("kmpNewApiName").value = "";
      document.getElementById("kmpNewApiUrl").value = "";
      document.getElementById("kmpNewApiKey").value = "";
      await loadList();
    });

    document.getElementById("kmpApiList").addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const item = btn.closest(".kmp-api-item");
      const profileId = item.dataset.id;
      const msgEl = item.querySelector('[data-role="msg"]');
      msgEl.style.display = "none";
      const action = btn.dataset.action;

      if (action === "test") {
        btn.textContent = "Testing…";
        const data = await api("test-my-api", { profileId });
        btn.textContent = "Test Connection";
        msgEl.style.display = "block";
        msgEl.style.color = data.success ? "#34d399" : "#f87171";
        msgEl.textContent = data.success ? `Online — Balance: ${data.balance} ${data.currency || ""}` : data.error;
      } else if (action === "fetch") {
        btn.textContent = "Fetching…";
        const data = await api("fetch-my-api-services", { profileId });
        btn.textContent = "Fetch Services";
        msgEl.style.display = "block";
        msgEl.style.color = data.success ? "#34d399" : "#f87171";
        msgEl.textContent = data.success ? `Fetched ${data.fetched}, saved ${data.saved}.` : data.error;
      } else if (action === "toggle") {
        const currentlyActive = item.querySelector(".kmp-badge").classList.contains("active");
        await api("update-my-api", { profileId, status: currentlyActive ? "disabled" : "active" });
        await loadList();
      } else if (action === "delete") {
        if (!confirm("Delete this API?")) return;
        await api("delete-my-api", { profileId });
        await loadList();
      }
    });

    await loadList();
  }

  document.addEventListener("DOMContentLoaded", function () {
    const apiTab = document.getElementById("tab-api");
    if (!apiTab) return;

    const wrap = el('<div id="kmpAccountSection"></div>');
    apiTab.insertBefore(wrap, apiTab.firstChild.nextSibling); // right after panel-head

    renderWalletCard(wrap);
    renderMyApisCard(wrap);
  });
})();
