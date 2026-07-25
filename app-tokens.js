/* LCB app v2 — экран «Токены»: расход по агентам и провайдерам, порядок тиров
   drag-and-drop, drilldown на дорогие процессы, кнопка ревью. Михаил 25.07. */
"use strict";

/* Порядок тиров хранится локально и постится в бэкенд (runtime_config).
   Провайдеры делятся: подписка (0 ₽) и платный API ($). */
const TOKENS_TIER_KEY = "lcb_ai_tier_order";
const TOKENS_DEFAULT_TIERS = ["Claude", "Codex", "Kimi K3"];

function tokFmt(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + "k";
  return String(Math.round(n));
}
function usdFmt(n) {
  n = Number(n) || 0;
  return n > 0 ? "$" + n.toFixed(n < 1 ? 3 : 2) : "—";
}

async function renderTokens() {
  const box = $("#scr-tokens");
  box.innerHTML = `
    <div class="card">
      <div class="cname">Порядок мозгов — тяни, чтобы поменять</div>
      <div class="mtext" style="margin-bottom:8px">Кто первым берёт задачу; упал — идёт к следующему. Тексты клиенту всегда Claude.</div>
      <div id="tierList" class="tierlist"></div>
      <div class="mtext" id="tierSaveNote" style="margin-top:8px;color:var(--text-muted)"></div>
    </div>
    <div class="stats" id="tokKpi"></div>
    <div class="card"><div class="cname">Провайдеры — подписка и платный</div><div id="tokProv"><div class="skel"></div></div></div>
    <div class="card"><div class="cname">Агенты — расход за неделю (нажми для деталей)</div><div id="tokAgents"><div class="skel"></div></div></div>`;

  renderTierList();

  let data;
  try {
    data = await api("/api/app/token_spend", { ttl: 60000 });
  } catch (e) {
    $("#tokProv").innerHTML = `<div class="mtext">Не удалось получить расход: ${esc(String(e))}</div>`;
    return;
  }
  S._tokenSpend = data;

  const dayTok = (data.providers || []).reduce((s, p) => s + (p.day.tokens || 0), 0);
  const weekTok = (data.providers || []).reduce((s, p) => s + (p.week.tokens || 0), 0);
  const dayUsd = (data.providers || []).reduce((s, p) => s + (p.day.usd || 0), 0);
  const weekUsd = (data.providers || []).reduce((s, p) => s + (p.week.usd || 0), 0);
  $("#tokKpi").innerHTML = `
    <div class="stat"><div class="l">Токенов за сутки</div><div class="v num">${tokFmt(dayTok)}</div></div>
    <div class="stat"><div class="l">Токенов за неделю</div><div class="v num">${tokFmt(weekTok)}</div></div>
    <div class="stat"><div class="l">Платно за сутки</div><div class="v num">${usdFmt(dayUsd)}</div></div>
    <div class="stat"><div class="l">Платно за неделю</div><div class="v num">${usdFmt(weekUsd)}</div></div>`;

  $("#tokProv").innerHTML = (data.providers || []).map((p) => {
    const paid = p.wallet === "paid";
    const tag = paid
      ? `<span class="pill" style="background:var(--bg-warning);color:var(--text-warning)">платный $</span>`
      : `<span class="pill" style="background:var(--bg-success);color:var(--text-success)">подписка</span>`;
    return `<div class="proc"><span>${esc(p.provider)}</span> ${tag}
      <span class="spacer mtext num">${tokFmt(p.day.tokens)} / сут · ${tokFmt(p.week.tokens)} / нед${paid ? " · " + usdFmt(p.week.usd) : ""}</span></div>`;
  }).join("") || `<div class="mtext">Данных пока нет</div>`;

  $("#tokAgents").innerHTML = (data.agents || []).map((a, i) => {
    const short = a.agent.replace("com.lcband.", "");
    const provs = (a.providers || []).map((p) =>
      `${esc(p.provider)} ${tokFmt(p.tokens)}`).join(" · ");
    return `<div class="agentrow" data-agent-idx="${i}" style="cursor:pointer">
      <div class="proc"><span>${esc(short)}</span>
        <span class="spacer mtext num">${tokFmt(a.day.tokens)} / сут · ${tokFmt(a.week.tokens)} / нед · ${a.week.calls} выз.</span></div>
      <div class="mtext" style="margin-left:14px;color:var(--text-muted)">${esc(provs)}</div></div>`;
  }).join("") || `<div class="mtext">Данных пока нет</div>`;

  box.querySelectorAll("[data-agent-idx]").forEach((row) => {
    row.addEventListener("click", () => openAgentDrilldown(Number(row.dataset.agentIdx)));
  });
}

function renderTierList() {
  let order;
  try { order = JSON.parse(localStorage.getItem(TOKENS_TIER_KEY) || "null"); } catch { order = null; }
  if (!Array.isArray(order) || !order.length) order = TOKENS_DEFAULT_TIERS.slice();
  const list = $("#tierList");
  if (!list) return;
  list.innerHTML = order.map((name, i) =>
    `<div class="tieritem" draggable="true" data-tier="${esc(name)}">
      <span class="tiernum">${i + 1}</span><span>${esc(name)}</span>
      <span class="spacer mtext">${i === 0 ? "первый" : "запас"}</span>
      <span class="drag" aria-hidden="true">⠿</span></div>`).join("");

  let dragEl = null;
  list.querySelectorAll(".tieritem").forEach((item) => {
    item.addEventListener("dragstart", () => { dragEl = item; item.style.opacity = "0.4"; });
    item.addEventListener("dragend", () => {
      item.style.opacity = "1";
      const names = [...list.querySelectorAll(".tieritem")].map((n) => n.dataset.tier);
      localStorage.setItem(TOKENS_TIER_KEY, JSON.stringify(names));
      renderTierList();
      saveTierOrder(names);
    });
    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (!dragEl || dragEl === item) return;
      const rect = item.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      list.insertBefore(dragEl, after ? item.nextSibling : item);
    });
  });
}

async function saveTierOrder(names) {
  const note = $("#tierSaveNote");
  if (note) note.textContent = "Сохраняю…";
  try {
    await api("/api/app/set_tier_order", { method: "POST", body: { order: names } });
    if (note) note.textContent = "Сохранено: " + names.join(" → ");
  } catch (e) {
    if (note) note.textContent = "Порядок применится локально; сервер: " + String(e).slice(0, 60);
  }
}

async function openAgentDrilldown(idx) {
  const data = S._tokenSpend || {};
  const agent = (data.agents || [])[idx];
  if (!agent) return;
  const short = agent.agent.replace("com.lcband.", "");
  const topDay = (data.top_day || []).filter((r) => r.owner === agent.agent).slice(0, 8);
  const topWeek = (data.top_week || []).filter((r) => r.owner === agent.agent).slice(0, 8);
  const big = agent.week.tokens >= 500000;

  const rows = (arr) => arr.map((r) =>
    `<div class="proc"><span>${esc(r.purpose)}</span>
      <span class="spacer mtext num">${tokFmt(r.tokens)} · ${r.calls} выз.${r.usd > 0 ? " · " + usdFmt(r.usd) : ""}</span></div>`).join("")
    || `<div class="mtext">нет данных</div>`;

  const html = `<div class="sheet-head"><strong>${esc(short)}</strong>
      <button class="btn" id="tokSheetClose">✕</button></div>
    <div class="stats">
      <div class="stat"><div class="l">За сутки</div><div class="v num">${tokFmt(agent.day.tokens)}</div></div>
      <div class="stat"><div class="l">За неделю</div><div class="v num">${tokFmt(agent.week.tokens)}</div></div>
      <div class="stat"><div class="l">Платно/нед</div><div class="v num">${usdFmt(agent.week.usd)}</div></div>
    </div>
    <div class="cname" style="margin-top:10px">Самое затратное — сутки</div>${rows(topDay)}
    <div class="cname" style="margin-top:10px">Самое затратное — неделя</div>${rows(topWeek)}
    <button class="btn go" id="tokReviewBtn" style="margin-top:12px;width:100%">
      Отправить на ревью: можно ли сократить расход?</button>
    ${big ? `<div class="mtext" style="margin-top:6px;color:var(--text-warning)">Расход крупный — ревью рекомендуется</div>` : ""}`;
  openSheet(html);
  $("#tokSheetClose").onclick = closeSheet;
  $("#tokReviewBtn").onclick = () => {
    closeSheet();
    sendPrompt(`Проанализируй расход токенов агента ${agent.agent} за неделю `
      + `(${tokFmt(agent.week.tokens)} токенов, ${agent.week.calls} вызовов). `
      + `Топ дорогих процессов: ${topWeek.map((r) => r.purpose + " " + tokFmt(r.tokens)).join(", ")}. `
      + `Можно ли сократить расход без потери качества — что конкретно и на сколько?`);
  };
}

/* Лёгкий bottom-sheet, если в app.js его ещё нет. */
function openSheet(html) {
  let s = $("#tokSheet");
  if (!s) {
    s = el(`<div id="tokSheet" class="tok-sheet-wrap"><div class="tok-sheet"></div></div>`);
    document.body.appendChild(s);
    s.addEventListener("click", (e) => { if (e.target.id === "tokSheet") closeSheet(); });
  }
  s.querySelector(".tok-sheet").innerHTML = html;
  s.style.display = "flex";
}
function closeSheet() {
  const s = $("#tokSheet");
  if (s) s.style.display = "none";
}
