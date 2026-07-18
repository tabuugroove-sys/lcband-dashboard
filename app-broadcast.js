/* LCB app v2 — экран «Рассылка» (#cast): 5 вкладок каналов (TG·VK·WA·IG·Email),
   аудитория per-channel, кампании с бейджем канала, создание под активную вкладку.
   Бэкенд: /api/broadcast/* (через туннель/TS — токен, с Mac — открыто).
   Клиент только создаёт кампании и переключает статус; сами отправки делает
   системный рассыльщик (до 20/день, окно 10-22 МСК, presend-фильтр без цен). */
"use strict";

const CAST_CHANNELS = [
  { key: "tg", label: "Telegram" },
  { key: "vk", label: "VK" },
  { key: "wa", label: "WhatsApp" },
  { key: "ig", label: "Instagram" },
  { key: "email", label: "Email" },
];
const CAST_CH_NOTES = {
  vk: "Отправляет VK-бот в рамках квот.",
  wa: "WA-рассылка уходит в очередь ручного подтверждения (компьютерная отправка).",
};
const CAST_STATUS = {
  draft: { label: "черновик", pill: "p-pine" },
  running: { label: "идёт", pill: "p-ok" },
  paused: { label: "пауза", pill: "p-warn" },
  done: { label: "завершена", pill: "p-mut" },
};
const CAST_SKIP_LABELS = { active_order: "активный заказ", no_user_id: "нет user_id", city_filter: "фильтр города" };

function castErrHtml(e, what) {
  if (e.status === 403) return `<div class="empty">Раздел закрыт — введи ключ в шторке индикатора</div>`;
  if (e.status === 404 || e.status === 503) {
    warnOnce("cast", "Ручки /api/broadcast недоступны (" + e.status + ")");
    return `<div class="empty">${esc(what)}: ручка рассылки недоступна (${e.status})</div>`;
  }
  return `<div class="empty">${esc(what)}: ${esc(e.message)}</div>`;
}
function castActionErr(e) {
  if (e.status === 403) toast("Нужен код доступа — введи в шторке индикатора", true);
  else if (e.status === 400) toast("Бэкенд отклонил: " + ((e.data && e.data.error) || "проверь поля"), true);
  else if (!e.network) toast("Не вышло: " + e.message, true);
}

async function renderCast() {
  if (!S.castCh) S.castCh = "tg";
  const box = $("#scr-cast");
  box.innerHTML = `
    <div class="dirsw" id="castTabs">${CAST_CHANNELS.map((c) =>
      `<button data-ch="${c.key}" class="${S.castCh === c.key ? "on" : ""}">${c.label}</button>`).join("")}</div>
    <div class="h2" style="margin-top:10px">Аудитория</div><div id="castAud"><div class="skel"></div></div>
    <div class="h2">Новая рассылка</div><div id="castForm" class="card"></div>
    <div class="h2">Кампании</div><div id="castList"><div class="skel"></div></div>
    <div class="mtext" style="margin:10px 0">Отправляет системный рассыльщик: до 20/день, окно 10-22 МСК, пауза при первом сигнале антиспама. Деньги/цены в рассылку не попадают (presend-фильтр).</div>
    <div id="castView"></div>`;
  $("#castTabs").querySelectorAll("button").forEach((b) => (b.onclick = () => {
    if (S.castCh !== b.dataset.ch) { S.castCh = b.dataset.ch; renderCast(); }
  }));
  drawCastForm(true);
  loadCastAudience();
  loadCastCampaigns();
  startPoll("screen:cast", () => { delete S.cache["/api/broadcast/campaigns"]; loadCastCampaigns(); }, 60000);
}

/* аудитория активного канала: N + разбивка скипов + первые 10 контактов;
   available:false (ig/email) → честная плашка причины, форма отключается */
async function loadCastAudience() {
  const b = $("#castAud");
  if (!b) return;
  const ch = S.castCh;
  try {
    const a = await api("/api/broadcast/audience?channel=" + encodeURIComponent(ch), { ttl: 60000 });
    if (S.castCh !== ch) return; // вкладку уже переключили
    if (a.available === false) {
      b.innerHTML = `<div class="card"><div class="cname">Аудитория: —</div>
        <div class="mtext" style="margin-top:4px">${esc(a.reason || "переписки не категоризированы — аудитории пока нет")}</div></div>`;
      drawCastForm(false);
      return;
    }
    const sk = a.skipped || {};
    const skParts = Object.entries(sk).filter(([, v]) => +v > 0)
      .map(([k, v]) => `${CAST_SKIP_LABELS[k] || k}: ${v}`).join(" · ");
    b.innerHTML = `<div class="card">
      <div class="cname">Аудитория: ${+a.eligible_count || 0} организаторов</div>
      <div class="mtext" style="margin-top:4px">Совпало по роли: ${a.total_role_match ?? "—"}${skParts ? " · скипы — " + esc(skParts) : ""}</div>
      ${(a.sample || []).slice(0, 10).map((s) => `
        <div class="proc"><span>${esc(s.first_name || s.username || "—")}</span>
          ${s.username ? `<span class="uname">@${esc(s.username)}</span>` : ""}
          <span class="spacer mtext">${esc(s.city || "")}${s.role ? " · " + esc(s.role) : ""}${s.last_msg_date ? " · " + esc(String(s.last_msg_date).slice(0, 10)) : ""}</span></div>`).join("")}
    </div>`;
    drawCastForm(true);
  } catch (e) {
    if (S.castCh !== ch) return;
    b.innerHTML = castErrHtml(e, "Аудитория");
    drawCastForm(true); // старый бэкенд без ?channel — форма живёт, бэкенд сам отклонит лишнее
  }
}

/* форма «Новая рассылка» под активную вкладку: название + бриф (≥20) + город + лимит/день */
function drawCastForm(available) {
  const f = $("#castForm");
  if (!f) return;
  const chLabel = (CAST_CHANNELS.find((c) => c.key === S.castCh) || {}).label || S.castCh;
  if (available === false) {
    f.innerHTML = `<div class="mtext">Канал ${esc(chLabel)} пока без аудитории — создание рассылки недоступно.</div>`;
    return;
  }
  const note = CAST_CH_NOTES[S.castCh];
  f.innerHTML = `
    <input id="castTitle" class="dinput" placeholder="Название" autocomplete="off">
    <textarea id="castBrief" class="dinput" rows="4" style="margin-top:8px"
      placeholder="Бриф: что предлагаем, без цен — текст каждому контакту персонально соберёт Opus"></textarea>
    <div style="display:flex;gap:8px;margin-top:8px">
      <input id="castCity" class="dinput" placeholder="Город (опц.)" style="flex:1">
      <input id="castPerDay" class="dinput num" type="number" min="1" max="40" value="20" style="width:110px" title="Лимит отправок в день (max 40)">
    </div>
    <button class="btn go" id="castCreate" style="margin-top:10px">Создать кампанию · ${esc(chLabel)}</button>
    <div class="mtext" style="margin-top:6px">Бриф — минимум 20 символов. Кампания создаётся черновиком; запуск — отдельной кнопкой в списке.</div>
    ${note ? `<div class="mtext" style="margin-top:6px">${esc(note)}</div>` : ""}`;
  $("#castCreate").onclick = createCast;
}
async function createCast() {
  const title = ($("#castTitle").value || "").trim();
  const brief = ($("#castBrief").value || "").trim();
  const city = ($("#castCity").value || "").trim();
  let perDay = Math.round(+$("#castPerDay").value || 20);
  if (perDay < 1) perDay = 1;
  if (perDay > 40) perDay = 40;
  if (!title) { toast("Дай название кампании", true); return; }
  if (brief.length < 20) { toast("Бриф слишком короткий — минимум 20 символов", true); return; }
  const btn = $("#castCreate");
  btn.disabled = true;
  btn.textContent = "Создаю…";
  try {
    const body = { title, brief, per_day: perDay, channel: S.castCh };
    if (city) body.city = city;
    const r = await api("/api/broadcast/campaigns", { method: "POST", body });
    toast("Кампания создана · аудитория " + (r.eligible ?? "?"));
    delete S.cache["/api/broadcast/campaigns"];
    drawCastForm(true);
    loadCastCampaigns();
  } catch (e) {
    castActionErr(e);
    btn.disabled = false;
    btn.textContent = "Создать кампанию";
  }
}

/* список кампаний: бейдж канала, прогресс sent/total, статус, кнопки, drill-down */
async function loadCastCampaigns() {
  const b = $("#castList");
  if (!b) return;
  let cs = [];
  try {
    const r = await api("/api/broadcast/campaigns", { ttl: 30000 });
    cs = r.campaigns || [];
  } catch (e) { b.innerHTML = castErrHtml(e, "Кампании"); return; }
  b.innerHTML = cs.map(castCardHtml).join("") || `<div class="empty">Кампаний пока нет</div>`;
  b.querySelectorAll("[data-cid]").forEach((card) => {
    const cid = card.dataset.cid;
    card.querySelectorAll("button[data-st]").forEach((btn) => (btn.onclick = () => castSetStatus(cid, btn.dataset.st, btn)));
    const open = card.querySelector("button[data-open]");
    if (open) open.onclick = () => castOpen(cid);
  });
}
function castCardHtml(c) {
  const cnt = c.counts || {};
  const sent = +cnt.sent || 0, total = +c.total || 0;
  const pct = total ? Math.min(100, Math.round(100 * sent / total)) : 0;
  const st = CAST_STATUS[c.status] || { label: c.status || "—", pill: "p-mut" };
  const ch = String(c.channel || "tg").toLowerCase();
  const chLabel = (CAST_CHANNELS.find((x) => x.key === ch) || {}).label || ch.toUpperCase();
  const extras = [];
  if (+cnt.pending > 0) extras.push(`в очереди ${cnt.pending}`);
  if (+cnt.skipped_review > 0) extras.push(`срезано ревью ${cnt.skipped_review}`);
  if (+cnt.failed_delivery > 0) extras.push(`не доставлено ${cnt.failed_delivery}`);
  return `<div class="card" data-cid="${esc(c.id)}">
    <div class="chead"><span class="cname">${esc(c.title || c.id)}</span>
      <span class="pill p-pine">${esc(chLabel)}</span>
      <span class="pill ${st.pill}">${esc(st.label)}</span>
      ${c.city ? `<span class="pill p-mut">${esc(c.city)}</span>` : ""}
      <span class="spacer mtext">${esc(String(c.created_at || "").slice(0, 10))}</span></div>
    <div class="mtext" style="margin-top:4px">${esc(trunc(c.brief || "", 140))}</div>
    <div class="bar" style="margin-top:8px"><i style="width:${pct}%"></i></div>
    <div class="mtext num" style="margin-top:4px">${sent}/${total} отправлено${extras.length ? " · " + esc(extras.join(" · ")) : ""} · лимит ${c.per_day ?? 20}/день${c.last_event ? " · " + esc(trunc(String(c.last_event), 60)) : ""}</div>
    <div class="callay" style="margin-top:10px">
      ${c.status === "draft" || c.status === "paused" ? `<button class="btn go" data-st="running">Запустить</button>` : ""}
      ${c.status === "running" ? `<button class="btn" data-st="paused">Пауза</button>` : ""}
      ${c.status !== "done" ? `<button class="btn stop" data-st="done">Завершить</button>` : ""}
      <button class="btn" data-open="1">Получатели</button>
    </div></div>`;
}
async function castSetStatus(cid, st, btn) {
  if (st === "running" && !confirm("Рассылка пойдёт автоматически, ~20/день в окне 10-22 МСК. Запустить?")) return;
  if (st === "done" && !confirm("Завершить кампанию? Оставшиеся получатели не получат сообщение.")) return;
  if (btn) btn.disabled = true;
  try {
    await api("/api/broadcast/campaigns/" + encodeURIComponent(cid) + "/status", { method: "POST", body: { status: st } });
    toast(st === "running" ? "Запущена" : st === "paused" ? "Пауза" : "Завершена");
  } catch (e) { castActionErr(e); }
  delete S.cache["/api/broadcast/campaigns"];
  delete S.cache["/api/broadcast/campaigns/" + encodeURIComponent(cid)];
  loadCastCampaigns();
}
/* drill-down: получатели со статусами */
async function castOpen(cid) {
  const v = $("#castView");
  if (!v) return;
  v.innerHTML = `<div class="skel"></div>`;
  try {
    const c = await api("/api/broadcast/campaigns/" + encodeURIComponent(cid), { ttl: 15000 });
    const rows = Object.entries(c.recipients || {});
    const pill = (s) => s === "sent" ? "p-ok" : s === "pending" ? "p-mut" : s === "failed_delivery" ? "p-dang" : "p-warn";
    v.innerHTML = `<div class="card">
      <div class="chead"><span class="cname">Получатели · ${esc(c.title || cid)}</span>
        <span class="spacer"></span><button class="btn" id="castViewClose">Закрыть</button></div>
      ${rows.map(([u, x]) => `
        <div class="proc"><span class="pill ${pill(x.status)}">${esc(x.status || "—")}</span>
          <span>@${esc(u)}</span>
          <span class="spacer mtext">${esc(trunc(x.detail || "", 60))}${x.ts ? " · " + esc(String(x.ts).slice(0, 16)) : ""}</span></div>`).join("") || `<div class="empty">Пусто</div>`}
    </div>`;
    $("#castViewClose").onclick = () => { v.innerHTML = ""; };
    v.scrollIntoView();
  } catch (e) { v.innerHTML = castErrHtml(e, "Кампания"); }
}
