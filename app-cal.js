/* Complete LCB/Broker calendar. Filter changes are display-only. */
"use strict";

const CAL_FILTERS = ["lcb", "broker", "events", "leads", "followup", "cancelled"];

function calLayerReason(error) {
  if (!error) return "";
  if (error.status === 403) return "нужен ключ";
  return error.status ? "ошибка " + error.status : "сеть";
}

function calendarEntryVisible(entry) {
  if (!S.layers[entry.business_line]) return false;
  if (entry.cancelled) return !!S.layers.cancelled;
  if (entry.record_type === "job") return !!S.layers.events;
  const followup = /follow[ -]?up|посредник/i.test(String(entry.status || ""));
  return followup ? !!S.layers.followup : !!S.layers.leads;
}

function calendarEntryColor(entry) {
  if (entry.cancelled) return "c-cxl";
  if (entry.business_line === "broker") return "c-brk";
  if (["contract", "prepayment"].includes(entry.lifecycle)) return "c-pay";
  if (["confirmed", "performed"].includes(entry.lifecycle)) return "c-ok";
  if (entry.lifecycle === "lost") return "c-lost";
  return "c-neg";
}

function calendarFilter(label, key, extra) {
  return `<label class="calcheck ${extra || ""}">
    <input type="checkbox" data-l="${key}" ${S.layers[key] ? "checked" : ""}>
    <span>${label}</span>
  </label>`;
}

function setAllCalendarFilters(value) {
  for (const key of CAL_FILTERS) S.layers[key] = value;
  renderCal();
}

function undatedRows(entries) {
  if (!entries.length) return "";
  return `<details class="cal-undated">
    <summary>Без даты <b>${entries.length}</b></summary>
    <div class="cal-undated-list">${entries.map((entry) => `
      <button class="thr" data-href="${esc(entry.href || "#chats")}">
        <div class="t1"><span class="who">${entry.business_line === "broker" ? "Broker · " : "LCB · "}${esc(entry.title)}</span><span class="when">${esc(entry.status)}</span></div>
        <div class="prev">${esc(entry.date_raw || "дата не указана")}${entry.location ? " · " + esc(entry.location) : ""}</div>
      </button>`).join("")}</div>
  </details>`;
}

async function renderCal() {
  const box = $("#scr-cal");
  if (!S.month) {
    const now = new Date();
    S.month = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  box.innerHTML = `<div id="calHead">
      <button id="calToday">Сегодня</button>
      <button id="calPrev" aria-label="Предыдущий месяц">‹</button>
      <button id="calNext" aria-label="Следующий месяц">›</button>
      <span class="mon">${MONTHS[S.month.getMonth()]} ${S.month.getFullYear()}</span>
      <span class="mtext" style="font-size:11px">МСК</span>
    </div>
    <div class="calfilterbar">
      <div class="calfilter-actions">
        <button id="calSelectAll">Выбрать все</button>
        <button id="calClearAll">Снять все</button>
      </div>
      <div class="callay" role="group" aria-label="Фильтры календаря">
        ${calendarFilter("LCB", "lcb", "brand-lcb")}
        ${calendarFilter("Broker", "broker", "brand-broker")}
        ${calendarFilter("События", "events")}
        ${calendarFilter("Заявки", "leads")}
        ${calendarFilter("Follow-up", "followup", "warn")}
        ${calendarFilter("Отменённые", "cancelled")}
      </div>
    </div>
    <div id="calGrid"><div class="skel"></div></div>
    <div id="calNote" class="mtext" style="margin-top:8px"></div>
    <div id="calUndated"></div>
    <div id="dayPanel"></div>`;

  $("#calToday").onclick = () => {
    const now = new Date();
    S.month = new Date(now.getFullYear(), now.getMonth(), 1);
    renderCal();
  };
  $("#calPrev").onclick = () => {
    S.month = new Date(S.month.getFullYear(), S.month.getMonth() - 1, 1);
    renderCal();
  };
  $("#calNext").onclick = () => {
    S.month = new Date(S.month.getFullYear(), S.month.getMonth() + 1, 1);
    renderCal();
  };
  $("#calSelectAll").onclick = () => setAllCalendarFilters(true);
  $("#calClearAll").onclick = () => setAllCalendarFilters(false);
  box.querySelectorAll('.callay input[type="checkbox"]').forEach((input) => {
    input.onchange = () => {
      S.layers[input.dataset.l] = input.checked;
      renderCal();
    };
  });

  startPoll("screen:cal", () => {
    delete S.cache["/api/app/calendar"];
    renderCal();
  }, 60000);

  let payload = null;
  let loadError = null;
  try {
    payload = await api("/api/app/calendar", { ttl: 60000 });
  } catch (error) {
    loadError = error;
  }
  const allEntries = payload && Array.isArray(payload.entries) ? payload.entries : [];
  const query = S.search.toLowerCase();
  const filtered = allEntries.filter((entry) => {
    if (!calendarEntryVisible(entry)) return false;
    if (!query) return true;
    return [entry.title, entry.username, entry.status, entry.location, entry.service]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });

  const byDay = {};
  const undated = [];
  for (const entry of filtered) {
    if (!entry.event_date) {
      undated.push(entry);
      continue;
    }
    (byDay[entry.event_date] = byDay[entry.event_date] || []).push({
      cls: calendarEntryColor(entry),
      label: `${entry.business_line === "broker" ? "B · " : "LCB · "}${entry.title}`,
      href: entry.href || "#chats",
      sub: entry.status || entry.lifecycle,
    });
  }

  const first = new Date(S.month);
  const year = first.getFullYear();
  const month = first.getMonth();
  const start = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayIso = mskDateIso(new Date());
  let cells = "";
  const heads = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]
    .map((head) => `<div class="h">${head}</div>`).join("");
  const total = Math.ceil((start + daysInMonth) / 7) * 7;
  for (let index = 0; index < total; index++) {
    const day = index - start + 1;
    if (day < 1 || day > daysInMonth) {
      cells += `<div class="gd out"></div>`;
      continue;
    }
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const chips = byDay[iso] || [];
    const shown = chips.slice(0, 3);
    const more = chips.length - shown.length;
    cells += `<div class="gd" data-iso="${iso}">
      <span class="dn ${iso === todayIso ? "today" : ""}">${day}</span>
      ${shown.map((chip) => `<button class="chip ${chip.cls}" data-href="${esc(chip.href)}" title="${esc(chip.label)} · ${esc(chip.sub)}">${esc(chip.label)}</button>`).join("")}
      ${more > 0 ? `<span class="more">ещё ${more}</span>` : ""}
    </div>`;
  }

  const grid = $("#calGrid");
  if (!grid) return;
  grid.innerHTML = `<div class="gwk">${heads}${cells}</div>`;
  const note = loadError
    ? `Календарь недоступен (${calLayerReason(loadError)})`
    : `${filtered.length} из ${allEntries.length} · с датой ${filtered.length - undated.length} · без даты ${undated.length}`;
  $("#calNote").textContent = loadError ? "⚠ " + note : note;
  $("#calUndated").innerHTML = undatedRows(undated);

  grid.querySelectorAll(".chip").forEach((chip) => {
    chip.onclick = (event) => {
      event.stopPropagation();
      nav(chip.dataset.href);
    };
  });
  grid.querySelectorAll(".gd[data-iso]").forEach((cell) => {
    cell.onclick = () => {
      const iso = cell.dataset.iso;
      const list = byDay[iso] || [];
      $("#dayPanel").innerHTML = list.length
        ? `<div class="card"><div class="cname">${iso.split("-").reverse().join(".")}</div>` +
          list.map((chip) => `<button class="thr" data-href="${esc(chip.href)}" style="margin-top:8px"><div class="t1"><span class="who">${esc(chip.label)}</span><span class="when">${esc(chip.sub)}</span></div></button>`).join("") +
          `</div>`
        : "";
      $("#dayPanel").querySelectorAll(".thr").forEach((row) => {
        row.onclick = () => nav(row.dataset.href);
      });
    };
  });
  $("#calUndated").querySelectorAll(".thr").forEach((row) => {
    row.onclick = () => nav(row.dataset.href);
  });
}
