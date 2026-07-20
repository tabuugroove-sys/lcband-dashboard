/* LCB app v2 — карточка события (#event/<id>): состав и гонорары по людям +
   бухгалтерия по структуре ручной таблицы заказчика (finance{} из /api/events/<eid>). */
"use strict";

/* пилюля оплаты участника: только из чисел (fee/paid/remaining) */
function memberPayPill(m) {
  const fee = +m.fee || 0, paid = +m.paid || 0, rem = +m.remaining || 0;
  if (fee <= 0) return `<span class="feenote">гонорар не внесён</span>`;
  if (rem === 0) return `<span class="pill p-ok">оплачен</span>`;
  if (paid > 0) return `<span class="pill p-brass">частично</span>`;
  return `<span class="pill p-mut">не оплачен</span>`;
}
function membersTableHtml(fin) {
  const members = fin.members || [];
  if (!members.length) return "";
  return `<div class="card"><div class="cname">Состав и гонорары · ${members.length}</div>
    <div class="ftablewrap"><table class="ftable">
      <thead><tr><th>Кто</th><th class="num">Гонорар</th><th class="num">Оплачено</th><th class="num">Остаток</th><th></th></tr></thead>
      <tbody>${members.map((m) => {
        const fee = +m.fee || 0, paid = +m.paid || 0;
        return `<tr>
          <td><div class="fname">${esc(m.name || "?")}</div>${m.role ? `<div class="frole">${esc(m.role)}</div>` : ""}</td>
          <td class="num">${fee > 0 ? money(fee) : "—"}</td>
          <td class="num">${paid > 0 ? money(paid) : "—"}</td>
          <td class="num">${fee > 0 ? money(m.remaining) : "—"}</td>
          <td>${memberPayPill(m)}</td></tr>`;
      }).join("")}</tbody>
      <tfoot><tr><td>Итого</td><td class="num">${money(fin.band_total)}</td>
        <td class="num">${money(fin.band_paid)}</td><td class="num">${money(fin.band_remaining)}</td><td></td></tr></tfoot>
    </table></div></div>`;
}
function accountingHtml(fin) {
  const brow = (k, v) => `<div class="brow"><span class="k">${k}</span><span class="num">${v}</span></div>`;
  const has = (x) => x != null && +x > 0;
  let h = `<div class="card"><div class="cname">Бухгалтерия</div>`;
  h += `<div class="bsec">Клиент</div>`;
  h += brow("Сумма" + (fin.client_total_source === "contract" ? " · по договору" : ""), money(fin.client_total));
  if (has(fin.client_bn)) h += brow("БН (безнал)", money(fin.client_bn));
  if (has(fin.client_nal)) h += brow("Нал", money(fin.client_nal));
  h += brow("Предоплата", money(fin.client_paid));
  h += brow("Остаток", money(fin.client_remaining));
  h += `<div class="bsec">Группа</div>`;
  h += brow("Гонорары состава", money(fin.band_total));
  h += brow("Оплачено", money(fin.band_paid));
  h += brow("Остаток", money(fin.band_remaining));
  h += `<div class="bsec">Расходы</div>`;
  h += has(fin.costs_total)
    ? brow("Всего расходов", money(fin.costs_total))
    : `<div class="brow"><span class="k">Всего расходов</span><span class="feenote">расходы не внесены</span></div>`;
  if (has(fin.agency_amount)) h += brow("Агентские" + (fin.agency_mode ? " · " + esc(String(fin.agency_mode)) : ""), money(fin.agency_amount));
  if (has(fin.kirill)) h += brow("Кирилл", money(fin.kirill));
  h += (fin.reconciliation || []).map((r) => `<div class="mtext" style="margin-top:6px">⚠ ${esc(r.label)}: ${esc(r.detail || "")}</div>`).join("");
  h += `<div class="mymoney"><span>Мои</span><span class="num">${money(fin.margin)}</span></div>`;
  h += `</div>`;
  return h;
}

async function renderEvent(eid) {
  const box = $("#scr-view");
  box.innerHTML = `<div class="backrow"><button class="btn" onclick="history.back()">‹ Назад</button></div><div id="evBox"><div class="skel"></div><div class="skel"></div></div>`;
  try {
    const ev = await api("/api/events/" + encodeURIComponent(eid), { ttl: 60000 });
    const fin = ev.finance || {};
    const ck = ev.ops_checklist || [];
    const done = ck.filter((c) => c.status === "done").length;
    const docsSec = (ev.sections || []).filter((s) => /Договор|Паспорта|Тайминг/i.test(s.name));
    $("#evBox").innerHTML = `
      <div class="chead"><span class="cname" style="font-size:17px">${esc(ev.title || eid)}</span>
        <span class="spacer pill p-brass num">${money(fin.client_total)} · осталось ${money(fin.client_remaining)}</span></div>
      <div class="mtext">${esc(ev.date || "")}${ev.notes ? " · " + esc(String(ev.notes).slice(0, 120)) : ""}</div>

      ${membersTableHtml(fin)}
      ${accountingHtml(fin)}

      <div class="card"><div class="cname">Чек-лист · ${done} из ${ck.length}</div>
        ${ck.map((c) => `
          <div class="ck"><div class="ckdot ${c.status === "done" ? "done" : "gap"}">${c.status === "done" ? "✓" : "!"}</div>
            <div><div class="t">${esc(c.label || c.key)}${c.total_count ? ` · ${c.done_count || 0}/${c.total_count}` : ""}</div>
              ${c.detail ? `<div class="why">${esc(c.detail)}</div>` : ""}
              ${c.status !== "done" ? `<div class="why">Пайплайн ведёт этот пункт сам; если завис — причина будет в «Требуют внимания» на Сегодня.</div>` : ""}</div></div>`).join("") || `<div class="empty">Чек-лист пуст</div>`}
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
