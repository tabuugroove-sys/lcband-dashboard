/* LCB app v2 — экран «Система»: перенос v1 как есть (плитки TG-сессий и offsite — фаза 2 ТЗ). */
"use strict";

async function renderSys() {
  const box = $("#scr-sys");
  box.innerHTML = `<div class="stats" id="sysKpi"></div>
    ${assuranceEntryHtml("sysAssurance")}
    <div class="card"><div class="cname">Процессы за 24ч</div><div id="procBox"><div class="skel"></div></div></div>
    <div class="card"><div class="cname">Токены сегодня</div><div id="tokBox"><div class="skel"></div></div></div>
    <div class="card"><div class="cname">Здоровье рантайма</div><div id="rhBox"><div class="skel"></div></div></div>`;
  bindAssuranceEntry("sysAssurance", "sys");
  try {
    const [act, usage, rh, tun] = await Promise.all([
      api("/api/process_activity_24h", { ttl: 120000 }),
      api("/api/ai_usage_breakdown", { ttl: 120000 }),
      api("/api/runtime_health", { ttl: 60000 }),
      api("/api/cloudflare_tunnel_status", { ttl: 60000 }).catch(() => null),
    ]);
    const procs = Object.entries(act).filter(([k]) => k.startsWith("proc_"));
    const aiCalls = (act._ai_calls_24h || {}).count || 0;
    $("#sysKpi").innerHTML = `
      <div class="stat"><div class="l">AI-вызовов за 24ч</div><div class="v num">${RUB.format(aiCalls)}</div></div>
      <div class="stat"><div class="l">Процессов активно</div><div class="v num">${procs.filter(([, v]) => (v.count || 0) > 0).length}/${procs.length}</div></div>
      <div class="stat"><div class="l">Здоровье</div><div class="v" style="color:${rh.level === "ok" ? "var(--ok)" : rh.level === "warn" ? "var(--warn)" : "var(--dang)"}">${esc(rh.level)}</div></div>
      <div class="stat"><div class="l">Туннель</div><div class="v">${tun ? (tun.stale ? "устарел" : "жив") : "—"}</div></div>`;
    $("#procBox").innerHTML = procs.map(([k, v]) => `
      <div class="proc"><span class="lamp ${(v.count || 0) > 0 ? "" : "wr"}"></span>
        <span>${esc(k.replace("proc_", ""))}</span>
        <span class="spacer mtext num">${v.count ?? "—"} ${esc(v.unit || "")}</span></div>`).join("");
    const t = usage.today || {};
    const days = usage.days || [];
    const maxTok = Math.max(1, ...days.map((d) => (d.input_tok || 0) + (d.output_tok || 0)));
    $("#tokBox").innerHTML = `
      <div class="mtext">Сегодня: <span class="num">${RUB.format(t.calls || 0)}</span> вызовов · in ${RUB.format(t.input_tok || 0)} · out ${RUB.format(t.output_tok || 0)}</div>
      ${Object.entries((usage.window || {}).by_service || {}).map(([svc, v]) => `
        <div class="mtext" style="margin-top:6px">${esc(svc)} <span class="num">${RUB.format(v.calls || 0)}</span></div>
        <div class="bar"><i style="width:${Math.min(100, Math.round(100 * (v.calls || 0) / Math.max(1, (usage.window || {}).calls || 1)))}%"></i></div>`).join("")}
      <div class="mtext" style="margin-top:10px">7 дней (токены):</div>
      <div style="display:flex; gap:4px; align-items:flex-end; height:56px; margin-top:6px">
        ${days.map((d) => `<div title="${esc(d.date)}" style="flex:1;background:var(--pine);border-radius:3px 3px 0 0;height:${Math.max(5, Math.round(100 * ((d.input_tok || 0) + (d.output_tok || 0)) / maxTok))}%"></div>`).join("")}
      </div>`;
    $("#rhBox").innerHTML = (rh.log_sizes || []).map((l) => `
      <div class="proc"><span class="lamp ${l.level === "ok" ? "" : l.level === "warn" ? "wr" : "dn"}"></span>
        <span>${esc(l.name)}</span><span class="spacer mtext num">${esc(l.human || "")}</span></div>`).join("") +
      `<div class="mtext" style="margin-top:8px">Плитки «3 TG-сессии» и offsite-бэкапа подключаются в фазе 2 (ручки уже живы).</div>`;
  } catch (e) {
    box.insertAdjacentHTML("beforeend", `<div class="empty">Система недоступна: ${esc(e.message)}</div>`);
  }
}
