(function () {
  var LINKVERTISE_URL = "https://link-hub.net/8236285/ApjF6y0XD5CV";
  var DEVICE_ID_KEY = "km_device_id";

  function getDeviceId() {
    var id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  }

  function checkKey(key, onResult) {
    fetch("/api/validate-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: key, deviceId: getDeviceId() }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) { onResult(!!data.valid, data.error); })
      .catch(function () { onResult(false); });
  }

  function showOverlay() {
    var shell = document.querySelector(".shell");
    if (shell) shell.classList.add("gate-hidden-content");

    var overlay = document.createElement("div");
    overlay.className = "gate-overlay";
    overlay.innerHTML =
      '<div class="gate-box">' +
      "<h2>Enter your key</h2>" +
      '<input id="gateKeyInput" type="text" placeholder="KM-XXXX-XXXX-XXXX-XXXX">' +
      '<div id="gateError" class="gate-error" style="display:none;"></div>' +
      '<button id="gateUnlockBtn">Unlock</button>' +
      '<div class="gate-free-row">' +
      '<a href="' + LINKVERTISE_URL + '" target="_blank" rel="noopener noreferrer">Get key for free</a>' +
      '<div class="gate-free-hint">Complete a few steps to get a free key.</div>' +
      "</div>" +
      "</div>";
    document.body.appendChild(overlay);

    var input = overlay.querySelector("#gateKeyInput");
    var btn = overlay.querySelector("#gateUnlockBtn");
    var err = overlay.querySelector("#gateError");

    function attempt() {
      var key = input.value.trim();
      if (!key) return;
      btn.disabled = true;
      btn.textContent = "Checking...";
      checkKey(key, function (valid, errorMsg) {
        btn.disabled = false;
        btn.textContent = "Unlock";
        if (valid) {
          overlay.remove();
          if (shell) shell.classList.remove("gate-hidden-content");
        } else {
          err.textContent = errorMsg || "Key is invalid or expired. Try again or get a free key below.";
          err.style.display = "block";
        }
      });
    }

    btn.addEventListener("click", attempt);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") attempt();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    showOverlay();
  });
})();
