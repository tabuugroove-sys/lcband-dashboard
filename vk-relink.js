(function installVkRelink() {
  "use strict";

  function backendBase() {
    const privateDashboard = location.port === "8878" || location.hostname.endsWith(".ts.net");
    const localDashboard = location.hostname === "127.0.0.1" || location.hostname === "localhost";
    if (privateDashboard) return "";
    if (localDashboard || location.protocol === "file:") return "http://127.0.0.1:8878";
    return null;
  }

  function actionMessage(button) {
    return button.closest(".conn-actions")?.querySelector(".conn-action-msg") || null;
  }

  function show(button, text, isError) {
    const message = actionMessage(button);
    if (!message) return;
    message.textContent = text;
    message.title = text;
    message.style.color = isError ? "#f87171" : "";
  }

  function adminToken(forcePrompt) {
    if (forcePrompt) localStorage.removeItem("lcband_admin_token");
    let token = localStorage.getItem("lcband_admin_token") || "";
    if (!token) {
      token = (window.prompt("Admin token (~/lcband/.env: DASHBOARD_ADMIN_TOKEN):") || "").trim();
      if (token) localStorage.setItem("lcband_admin_token", token);
    }
    return token;
  }

  async function jsonRequest(url, options) {
    const response = await fetch(url, {cache: "no-store", ...options});
    const payload = await response.json().catch(() => ({}));
    if (response.status === 403) {
      localStorage.removeItem("lcband_admin_token");
      throw new Error("bad admin token");
    }
    if (!response.ok) throw new Error(payload.error || payload.reason || `HTTP ${response.status}`);
    return payload;
  }

  function scheduleRefresh() {
    setTimeout(() => location.reload(), 800);
  }

  async function reconnectVk(button) {
    if (button.dataset.vkRelinkBusy === "1") return;
    const base = backendBase();
    if (base === null) {
      show(button, "open private dashboard", true);
      return;
    }
    const token = adminToken(false);
    if (!token) return;

    button.dataset.vkRelinkBusy = "1";
    button.disabled = true;
    show(button, "checking VK…", false);
    try {
      const headers = {"X-Admin-Token": token};
      const status = await jsonRequest(`${base}/api/vk_relink_status`, {headers});
      let tokenOrUrl = "";
      if (status.reauth_required) {
        if (!status.oauth_url) throw new Error("VK OAuth app is not configured");
        const authKey = `lcband_vk_oauth_pending:${status.oauth_client_id || "current"}`;
        const authStarted = sessionStorage.getItem(authKey) === "1";
        if (!authStarted) {
          sessionStorage.setItem(authKey, "1");
          const popup = window.open(status.oauth_url, "_blank", "noopener");
          show(
            button,
            popup ? "разреши доступ приложению LCBand, затем снова нажми Reconnect" : "разреши popup и нажми Reconnect",
            false,
          );
          return;
        }
        tokenOrUrl = (window.prompt(
          "Вставь ВЕСЬ финальный URL после разрешения нашего VK-приложения (…blank.html#access_token=…). Токен проверится и сохранится локально."
        ) || "").trim();
        if (!tokenOrUrl) {
          window.open(status.oauth_url, "_blank", "noopener");
          show(button, "нужен финальный VK URL", true);
          return;
        }
      }

      show(button, status.reauth_required ? "verifying VK access…" : "restarting VK…", false);
      const payload = await jsonRequest(`${base}/api/vk_relink`, {
        method: "POST",
        headers: {"Content-Type": "application/json", "X-Admin-Token": token},
        body: JSON.stringify(tokenOrUrl ? {token_or_url: tokenOrUrl} : {}),
      });
      sessionStorage.removeItem(`lcband_vk_oauth_pending:${status.oauth_client_id || "current"}`);
      show(button, payload.user?.name ? `connected: ${payload.user.name}` : "connected", false);
      scheduleRefresh();
    } catch (error) {
      show(button, String(error.message || error).slice(0, 80), true);
    } finally {
      button.dataset.vkRelinkBusy = "0";
      button.disabled = false;
    }
  }

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.(".conn-reconnect-btn");
    if (!button || !String(button.title || "").startsWith("VK reconnect:")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    reconnectVk(button);
  }, true);
})();
