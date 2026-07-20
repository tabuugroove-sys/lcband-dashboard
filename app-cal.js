/* LCB app v2 — календарь (§3.2 ТЗ): сетка/чипы/слои v1 + фикс тихого catch —
   ошибка одного из слоёв даёт явную строку под сеткой, не молчание. */
"use strict";

function evColor(ev) {
  const st = ((ev.linked_order_status || "") + " " + (ev.business_state || "")).toLowerCase();
  if (st.includes("отмен") || st.includes("cancel")) return "c-cxl";
  const total = +ev.client_total || 0, rem = +ev.client_remaining || 0;
  if (total > 0 && rem <= 0) return "c-ok";
  if (total > 0) return "c-pay";
  return "c-ok";
}
function leadColor(l) {
  return (l.stage === "contract" || l.stage === "prepayment") ? "c-pay" : "c-neg";
}
function calLayerReason(e) {
  if (!e) return "";
  if (e.status === 403) return "нужен ключ — шторка индикатора";
  return e.status ? "ошибка " + e.status : "сеть";
}
/* брокерские даты приходят строками «17.07» / «1 августа» — год эвристикой:
   собранная дата ушла в прошлое больше чем на ~45 дней → следующий год */
const BROKER_MONTHS = { "января": 1, "февраля": 2, "марта": 3, "апреля": 4, "мая": 5, "июня": 6,
  "июля": 7, "августа": 8, "сентября": 9, "октября": 10, "ноября": 11, "декабря": 12 };
function _calIso(y, mo, d) { return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`; }
function brokerDateIso(s) {
  s = String(s || "").trim().toLowerCase();
  if (!s) return null;
  let d = null, mo = null;
  let m = s.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/);
  if (m) {
    d = +m[1]; mo = +m[2];
    if (m[3]) { let y = +m[3]; if (y < 100) y += 2000; return _calIso(y, mo, d); }
  } else {
    m = s.match(/^(\d{1,2})\s+([а-яё]+)/);
    if (m && BROKER_MONTHS[m[2]]) { d = +m[1]; mo = BROKER_MONTHS[m[2]]; }
  }
  if (!d || !mo || mo > 12 || d > 31) return null;
  const today = mskDateIso(new Date());
  const y = +today.slice(0, 4);
  const cand = _calIso(y, mo, d);
  const diffDays = (Date.parse(cand) - Date.parse(today)) / 86400000;
  return diffDays < -45 ? _calIso(y + 1, mo, d) : cand;
}
async function renderCal() {
  const box = $("#scr-cal");
  if (!S.month) { const n = new Date(); S.month = new Date(n.getFullYear(), n.getMonth(), 1); }
  box.innerHTML = `<div id="calHead">
      <button id="calToday">Сегодня</button>
      <button id="calPrev">‹</button><button id="calNext">›</button>
      <span class="mon">${MONTHS[S.month.getMonth()]} ${S.month.getFullYear()}</span>
      <span class="mtext" style="font-size:11px">МСК</span>
    </div>
    <div class="callay">
      <button class="lay ${S.layers.events ? "on" : ""}" data-l="events">События</button>
      <button class="lay ${S.layers.leads ? "on" : ""}" data-l="leads">Лиды с датами</button>
      <button class="lay warn ${S.layers.followup ? "on" : ""}" data-l="followup">Follow-up</button>
      <button class="lay ${S.layers.cancelled ? "on" : ""}" data-l="cancelled">Отменённые</button>
      <button class="lay ${S.layers.broker ? "on" : ""}" data-l="broker">Брокер</button>
    </div>
    <div id="calGrid"><div class="skel"></div></div>
    <div id="calNote" class="mtext" style="margin-top:8px"></div>
    <div id="dayPanel"></div>`;
  $("#calToday").onclick = () => { const n = new Date(); S.month = new Date(n.getFullYear(), n.getMonth(), 1); renderCal(); };
  $("#calPrev").onclick = () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() - 1, 1); renderCal(); };
  $("#calNext").onclick = () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth() + 1, 1); renderCal(); };
  box.querySelectorAll(".callay .lay").forEach((b) => (b.onclick = () => { S.layers[b.dataset.l] = !S.layers[b.dataset.l]; renderCal(); }));
  startPoll("screen:cal", () => {
    delete S.cache["/api/events?include_past=1"];
    delete S.cache["/api/leads_with_dates"];
    delete S.cache["/api/threads?dir=broker"];
    renderCal();
  }, 60000);

  let events = [], leads = [], broker = [], evErr = null, leadErr = null, brokerErr = null;
  try {
    const r = await api("/api/events?include_past=1", { ttl: 60000 });
    events = r.events || [];
  } catch (e) { evErr = e; }
  try {
    const r = await api("/api/leads_with_dates", { ttl: 60000 });
    leads = r.leads || [];
  } catch (e) { leadErr = e; }
  if (S.layers.broker) {
    try {
      const r = await api("/api/threads?dir=broker", { ttl: 60000 });
      broker = r.threads || r.rows || [];
    } catch (e) { brokerErr = e; }
  }

  const byDay = {};
  const put = (iso, chip) => { if (!iso) return; (byDay[iso] = byDay[iso] || []).push(chip); };
  if (S.layers.events) for (const ev of events) {
    const cls = evColor(ev);
    if (cls === "c-cxl" && !S.layers.cancelled) continue;
    put(ev.date, { cls, label: (cls === "c-cxl" ? "✕ " : "") + (ev.title || ev.linked_order_client || ev.id), href: "#event/" + encodeURIComponent(ev.id), sub: ev.business_state || "" });
  }
  // Follow-up-лиды — отдельный слой (то же соответствие статусов, что папка в чатах);
  // остальные лиды сохраняют цвет по стадии (contract/prepayment — латунь)
  const FU_LEAD_STATUSES = ["Follow-up", "Посредник"];
  for (const l of leads) {
    const isFu = FU_LEAD_STATUSES.includes(String(l.status || ""));
    if (isFu ? !S.layers.followup : !S.layers.leads) continue;
    put(l.event_date_iso, {
      cls: isFu ? "c-neg" : leadColor(l),
      label: (isFu ? "⏳ " : "") + (l.client || l.username || "лид"),
      href: l.username ? "#chat/lcb/" + encodeURIComponent(l.username) : "#chats",
      sub: l.status || "",
    });
  }
  if (S.layers.broker) for (const b of broker) {
    const iso = brokerDateIso(b.event_date);
    if (!iso) continue;
    const nq = threadNavQ(b);
    put(iso, {
      cls: "c-brk",
      label: "🤝 " + (b.display || b.username || "брокер"),
      href: nq ? "#chat/broker/" + encodeURIComponent(nq) : "#chats",
      sub: b.status || "",
    });
  }

  const q = S.search.toLowerCase();
  const first = new Date(S.month), y = first.getFullYear(), m = first.getMonth();
  const start = (first.getDay() + 6) % 7; // Пн=0
  const dim = new Date(y, m + 1, 0).getDate();
  const todayIso = mskDateIso(new Date()); // «сегодня» — по МСК, не по локальной TZ
  let cells = "";
  const heads = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].map((h) => `<div class="h">${h}</div>`).join("");
  const total = Math.ceil((start + dim) / 7) * 7;
  for (let i = 0; i < total; i++) {
    const d = i - start + 1;
    if (d < 1 || d > dim) { cells += `<div class="gd out"></div>`; continue; }
    const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    let chips = (byDay[iso] || []);
    if (q) chips = chips.filter((c) => c.label.toLowerCase().includes(q));
    const shown = chips.slice(0, 3);
    const moreN = chips.length - shown.length;
    cells += `<div class="gd" data-iso="${iso}">
      <span class="dn ${iso === todayIso ? "today" : ""}">${d}</span>
      ${shown.map((c) => `<button class="chip ${c.cls}" data-href="${esc(c.href)}" title="${esc(c.label)} · ${esc(c.sub)}">${esc(c.label)}</button>`).join("")}
      ${moreN > 0 ? `<span class="more">ещё ${moreN}</span>` : ""}
    </div>`;
  }
  const grid = $("#calGrid");
  if (!grid) return; // экран сменился, пока грузились данные
  grid.innerHTML = `<div class="gwk">${heads}${cells}</div>`;

  // слой пропадает НЕ молча (фикс тихого catch v1)
  let note = "";
  if (evErr && leadErr) note = `⚠ Слои событий и лидов недоступны (${calLayerReason(evErr)}) — календарь может быть пустым`;
  else if (evErr) note = `⚠ Слой событий недоступен (${calLayerReason(evErr)}) — показаны только лиды`;
  else if (leadErr) note = `⚠ Слой лидов недоступен (${calLayerReason(leadErr)}) — показаны только события`;
  if (brokerErr) note += (note ? " · " : "⚠ ") + `Слой брокера недоступен (${calLayerReason(brokerErr)})`;
  const noteEl = $("#calNote");
  if (noteEl) noteEl.textContent = note;

  grid.querySelectorAll(".chip").forEach((c) => (c.onclick = (e) => { e.stopPropagation(); nav(c.dataset.href); }));
  grid.querySelectorAll(".gd[data-iso]").forEach((cell) => (cell.onclick = () => {
    const iso = cell.dataset.iso, list = byDay[iso] || [];
    $("#dayPanel").innerHTML = list.length
      ? `<div class="card"><div class="cname">${iso.split("-").reverse().join(".")}</div>` +
        list.map((c) => `<button class="thr" data-href="${esc(c.href)}" style="margin-top:8px"><div class="t1"><span class="who">${esc(c.label)}</span><span class="when">${esc(c.sub)}</span></div></button>`).join("") + `</div>`
      : "";
    $("#dayPanel").querySelectorAll(".thr").forEach((t) => (t.onclick = () => nav(t.dataset.href)));
  }));
}
