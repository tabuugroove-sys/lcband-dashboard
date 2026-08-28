/* LCB 2.0 «Питчи» — live-поток отправленных питчей (CHG-20260828-011).
   Данные: /api/app/pitches_live (прокси :8880 → dashboard_backend :8878).
   CSP: никаких inline-стилей — только классы и textContent. */
(function () {
  "use strict";
  var feed = document.getElementById("feed");
  var tpl = document.getElementById("rowTpl");
  var metaLine = document.getElementById("metaLine");
  var note = document.getElementById("note");
  var hoursSel = document.getElementById("hours");
  var filterSel = document.getElementById("filter");
  var autoCb = document.getElementById("auto");
  var refreshBtn = document.getElementById("refresh");
  var timer = null;
  var lastPitches = [];

  var PROBLEM_BADGES = {
    urgent: "🔴 ургент-бот",
    digest: "📮 notify-digest",
    send_block: "⛔ send-блок"
  };
  var KIND_LABELS = {
    ignored_client_reply: "клиент остался без ответа (SLA)",
    presend_fail_streak_cap: "серия presend-fail — блок отправок",
    ball_on_us: "клиент ждёт (мяч у нас)",
    rider_delivery_blocked: "обещанный райдер не доставлен",
    presend_block: "блок пресенда",
    auto_stop: "авто-стоп писаря",
    broker_stuck: "брокер застрял",
    writer_block: "блок писаря",
    promise_overdue: "просроченное обещание",
    agent_debt: "долг агента",
    watchdog_loop: "watchdog: залипание",
    ai_limit: "AI-лимит исчерпан",
    event_audit: "аудит события",
    event_close_confirm: "закрыть событие?",
    draft_approval: "драфт ждёт апрува",
    media_review: "медиа на ручную сверку",
    media_sourcing_fail: "sourcing упал",
    role_mismatch: "зачем агент писал (роль)",
    tech_question: "вопрос состава",
    call_reminder_final: "созвон закрыт как пропущенный"
  };
  var PRESEND_LABELS = { ok: "ok", send: "ok", adapt: "adapt", skip: "skip",
                         escalate_to_opus: "эскалация" };

  function fmtWhen(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      return d.toLocaleString("ru-RU", {
        day: "2-digit", month: "2-digit",
        hour: "2-digit", minute: "2-digit"
      });
    } catch (e) { return String(iso); }
  }

  function clampable(el, text, emptyLabel) {
    if (text) {
      el.textContent = text;
      if (text.length > 260) {
        el.classList.add("clamped");
        el.addEventListener("click", function () {
          el.classList.toggle("clamped");
        });
      }
    } else {
      el.textContent = emptyLabel;
      el.classList.add("missing");
    }
  }

  function row(parent, cls, label, value) {
    if (!value && value !== false) return;
    var div = document.createElement("div");
    div.className = "p-row" + (cls ? " " + cls : "");
    var b = document.createElement("b");
    b.textContent = label + ": ";
    div.appendChild(b);
    div.appendChild(document.createTextNode(
      value === true ? "да" : value === false ? "нет" : String(value)));
    parent.appendChild(div);
  }

  function renderProblem(p) {
    var box = document.createElement("div");
    box.className = "problem src-" + (p.src || "digest");
    var head = document.createElement("div");
    head.className = "p-head";
    var badge = document.createElement("span");
    badge.className = "p-badge src-" + (p.src || "digest");
    badge.textContent = PROBLEM_BADGES[p.src] || p.src || "";
    head.appendChild(badge);
    var kind = document.createElement("span");
    kind.className = "p-kind";
    kind.textContent = KIND_LABELS[p.kind] || p.kind || "";
    head.appendChild(kind);
    if (p.ts) {
      var when = document.createElement("span");
      when.className = "p-when";
      when.textContent = fmtWhen(p.ts);
      head.appendChild(when);
    }
    if (p.status) {
      var st = document.createElement("span");
      st.className = "p-status";
      st.textContent = "статус: " + p.status;
      head.appendChild(st);
    }
    if (p.module || p.detector) {
      var md = document.createElement("span");
      md.className = "p-status";
      md.textContent = "источник: " + (p.module || p.detector);
      head.appendChild(md);
    }
    box.appendChild(head);

    row(box, "", "Почему возникло", p.why);
    if (p.src === "digest") {
      // формат дневного обзора notify_policy: пытался ли агент сам и
      // почему не справился — прямо из полей отправителя эскалации
      row(box, "", "Агент пытался сам",
          p.attempted === null || p.attempted === undefined
            ? "неизвестно (отправитель не передал)" : p.attempted);
      row(box, p.attempted === false ? "p-no-mech" : "",
          p.attempted === false
            ? "Почему не пытался (нет механики/права)"
            : "Почему не справился сам",
          p.attempt_detail);
    }
    if (p.src === "urgent") {
      row(box, p.mechanic && p.mechanic.indexOf("нет") === 0
            ? "p-no-mech" : "",
          "Механика восстановления", p.mechanic);
      row(box, "", "Containment", p.containment);
      row(box, "", "Сигнатура", p.root_signature);
      if (p.tribrain_summary) {
        var det = document.createElement("details");
        det.className = "p-tribrain";
        var sum = document.createElement("summary");
        sum.textContent = "TriBrain-разбор: почему пошло не так" +
          (p.tribrain_status ? " (" + p.tribrain_status + ")" : "");
        det.appendChild(sum);
        var body = document.createElement("div");
        body.className = "p-sum";
        body.textContent = p.tribrain_summary;
        det.appendChild(body);
        box.appendChild(det);
      } else {
        row(box, "", "TriBrain-разбор",
            p.tribrain_status ? "в очереди (" + p.tribrain_status + ")" : null);
      }
    }
    if (p.src === "send_block") {
      row(box, "", "Ургент-алерт ушёл", p.alert_sent);
    }
    return box;
  }

  function render() {
    var f = filterSel.value;
    var shown = lastPitches.filter(function (p) {
      if (!f) return true;
      if (f === "__problems__") return (p.problems || []).length > 0;
      return p.type === f;
    });
    feed.textContent = "";
    if (!shown.length) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Питчей нет (окно/фильтр).";
      feed.appendChild(empty);
      return;
    }
    shown.forEach(function (p) {
      var node = tpl.content.cloneNode(true);
      var art = node.querySelector(".pitch");
      node.querySelector(".when").textContent = fmtWhen(p.ts);
      node.querySelector(".chat").textContent = p.chat || "—";
      var target = node.querySelector(".target");
      var t = String(p.target || "").replace(/^@/, "");
      if (/^[A-Za-z0-9_]{3,32}$/.test(t)) {
        target.textContent = "@" + t;
        target.href = "https://t.me/" + t;
      } else {
        target.textContent = t || "без username";
        target.removeAttribute("href");
      }
      var typeChip = node.querySelector(".chip.type");
      typeChip.textContent = p.type_label || p.type || "—";
      if (p.type) typeChip.classList.add("type-" + p.type);
      var orderChip = node.querySelector(".chip.order");
      if (p.order_status) {
        orderChip.hidden = false;
        orderChip.textContent = "сейчас: " + p.order_status;
        if (p.order_archived) orderChip.classList.add("archived");
      }
      var flag = node.querySelector(".chip.problem-flag");
      var problems = p.problems || [];
      if (problems.length) {
        flag.hidden = false;
        flag.textContent = "⚠ проблем: " + problems.length;
        art.classList.add("has-problems");
      }

      var src = p.source_post;
      clampable(node.querySelector(".src-text"), src && src.text,
                "текст поста недоступен (нет в базе/журнале)");
      var srcMeta = node.querySelector(".src-meta");
      if (src) {
        srcMeta.textContent = [
          src.chat || p.chat || "",
          src.ts ? fmtWhen(src.ts) : "",
          src.origin === "orders" ? "из карточки заказа" :
            src.origin === "classify_journal" ? "из журнала классификации" : ""
        ].filter(Boolean).join(" · ");
      } else {
        srcMeta.textContent = p.chat ? "чат: " + p.chat : "";
      }

      clampable(node.querySelector(".out-text"), p.pitch_text, "—");
      var chips = node.querySelector(".out-chips");
      var modelsChip = node.querySelector(".chip.models");
      if (p.models && p.models.length) {
        modelsChip.hidden = false;
        modelsChip.textContent = "🧠 " + p.models.join(" → ");
      }
      (p.presend || []).forEach(function (d) {
        var c = document.createElement("span");
        var dec = String(d.decision || "");
        c.className = "chip presend-" +
          (dec === "skip" ? "skip" : dec === "adapt" ? "adapt" : "ok");
        c.textContent = "presend: " + (PRESEND_LABELS[dec] || dec || "—");
        if (d.reason) c.title = d.reason;
        chips.appendChild(c);
      });

      if (problems.length) {
        var pbox = node.querySelector(".problems");
        pbox.hidden = false;
        problems.forEach(function (pr) { pbox.appendChild(renderProblem(pr)); });
      }
      feed.appendChild(node);
    });
  }

  function load() {
    var hours = hoursSel.value || "168";
    fetch("/api/app/pitches_live?hours=" + encodeURIComponent(hours))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.ok !== true) {
          metaLine.textContent = "Ошибка данных: " +
            ((data && data.error) || "нет ответа");
          return;
        }
        lastPitches = data.pitches || [];
        var c = data.counts || {};
        metaLine.textContent = "Live: отправлено за " + data.hours + "ч: " +
          (c.sent || 0) + " · с проблемами: " + (c.with_problems || 0) +
          " (эскалаций: " + (c.problems || 0) + ")" +
          " · обновлено " + fmtWhen(data.generated_at);
        if (data.note) {
          note.hidden = false;
          note.textContent = data.note;
        }
        render();
      })
      .catch(function (e) {
        metaLine.textContent = "Сеть/бэкенд недоступны: " + e;
      });
  }

  function schedule() {
    if (timer) { clearInterval(timer); timer = null; }
    if (autoCb.checked) { timer = setInterval(load, 15000); }
  }

  hoursSel.addEventListener("change", load);
  filterSel.addEventListener("change", render);
  autoCb.addEventListener("change", schedule);
  refreshBtn.addEventListener("click", load);
  load();
  schedule();
}());
