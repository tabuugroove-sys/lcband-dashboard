/* LCB app v2 — карточка события (#event/<id>): перенос v1 как есть (правки — фаза 2 ТЗ). */
"use strict";

async function renderEvent(eid) {
  const box = $("#scr-view");
  box.innerHTML = `<div class="backrow"><button class="btn" onclick="history.back()">‹ Назад</button></div><div id="evBox"><div class="skel"></div><div class="skel"></div></div>`;
  try {
    const ev = await api("/api/events/" + encodeURIComponent(eid), { ttl: 60000 });
    const fin = ev.finance || {};
    const ck = ev.ops_checklist || [];
    const done = ck.filter((c) => c.status === "done").length;
    const lineup = ((ev.sections || []).find((s) => /Состав/i.test(s.name)) || {}).rows || [];
    const docsSec = (ev.sections || []).filter((s) => /Договор|Паспорта|Тайминг/i.test(s.name));
    $("#evBox").innerHTML = `
      <div class="chead"><span class="cname" style="font-size:17px">${esc(ev.title || eid)}</span>
        <span class="spacer pill p-brass num">${money(fin.client_total)} · осталось ${money(fin.client_remaining)}</span></div>
      <div class="mtext">${esc(ev.date || "")}${ev.notes ? " · " + esc(String(ev.notes).slice(0, 120)) : ""}</div>
      <div class="callay" style="margin-top:8px">${lineup.map((r) => {
        const paidOk = String(r["Статус ставки"] || "").toLowerCase().includes("оплач") || +r["Предоплата"] > 0;
        return `<span class="pill ${paidOk ? "p-ok" : "p-warn"}">${esc(r["Имя"] || "?")} · ${esc(r["Роль"] || "")}</span>`;
      }).join("")}</div>

      <div class="card"><div class="cname">Чек-лист · ${done} из ${ck.length}</div>
        ${ck.map((c) => `
          <div class="ck"><div class="ckdot ${c.status === "done" ? "done" : "gap"}">${c.status === "done" ? "✓" : "!"}</div>
            <div><div class="t">${esc(c.label || c.key)}${c.total_count ? ` · ${c.done_count || 0}/${c.total_count}` : ""}</div>
              ${c.detail ? `<div class="why">${esc(c.detail)}</div>` : ""}
              ${c.status !== "done" ? `<div class="why">Пайплайн ведёт этот пункт сам; если завис — причина будет в «Требуют внимания» на Сегодня.</div>` : ""}</div></div>`).join("") || `<div class="empty">Чек-лист пуст</div>`}
      </div>

      <div class="card"><div class="cname">Финансы</div>
        <div class="stats" style="margin-top:8px">
          <div class="stat"><div class="l">Клиент всего</div><div class="v num">${money(fin.client_total)}</div></div>
          <div class="stat"><div class="l">Получено</div><div class="v num" style="color:var(--ok)">${money(fin.client_paid)}</div></div>
          <div class="stat"><div class="l">Остаток</div><div class="v num" style="color:var(--brass)">${money(fin.client_remaining)}</div></div>
          <div class="stat"><div class="l">Составу</div><div class="v num">${money(fin.band_total)}</div></div>
        </div>
        ${(fin.reconciliation || []).map((r) => `<div class="mtext" style="margin-top:6px">⚠ ${esc(r.label)}: ${esc(r.detail || "")}</div>`).join("")}
      </div>

      ${docsSec.map((s) => `<div class="card"><div class="cname">${esc(s.name)}</div>
        ${(s.rows || []).slice(0, 8).map((r) => `<div class="doc"><div class="ic">§</div><div style="min-width:0">
          ${Object.entries(r).slice(0, 3).map(([k, v]) => `<div class="st"><b style="font-weight:500">${esc(k)}:</b> ${esc(String(v).slice(0, 80))}</div>`).join("")}
        </div></div>`).join("") || `<div class="empty">Пусто</div>`}</div>`).join("")}
      <div class="mtext" style="margin:12px 0">Отправка документов контактам карточки уйдёт через пайплайн-ревью — кнопка появится вместе с ручкой /api/event_send (в доработках бэкенда).</div>`;
  } catch (e) {
    $("#evBox").innerHTML = `<div class="empty">${e.status === 403
      ? "Карточка закрыта — введи ключ в шторке индикатора"
      : "Событие не найдено: " + esc(e.message)}</div>`;
  }
}
