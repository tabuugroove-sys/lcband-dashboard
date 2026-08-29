/* LCB 2.0 «Посты» — live-поток event-постов (CHG-20260828-006).
   Данные: /api/app/posts_live (прокси :8880 → dashboard_backend :8878).
   CSP: никаких inline-стилей — только классы и textContent. */
(function () {
  "use strict";
  var feed = document.getElementById("feed");
  var tpl = document.getElementById("rowTpl");
  var metaLine = document.getElementById("metaLine");
  var v2note = document.getElementById("v2note");
  var hoursSel = document.getElementById("hours");
  var catSel = document.getElementById("cat");
  var autoCb = document.getElementById("auto");
  var archiveCb = document.getElementById("archive");
  var refreshBtn = document.getElementById("refresh");
  var timer = null;
  var lastPosts = [];
  var TRIBRAIN_STATUS_RU = {
    queued: "в очереди на разбор", running: "разбирает…",
    done: "разбор готов", failed: "разбор не удался"
  };

  function fmtWhen(iso) {
    if (!iso) return "—";
    try {
      var d = new Date(iso);
      return d.toLocaleString("ru-RU", {
        day: "2-digit", month: "2-digit",
        hour: "2-digit", minute: "2-digit"
      });
    } catch (e) { return iso; }
  }

  function render() {
    var cat = catSel.value;
    var shown = lastPosts.filter(function (p) {
      var v = p.v1 && p.v1.verdict;
      if (!cat) return true;
      if (cat === "__none__") return !v;
      return v === cat;
    });
    feed.textContent = "";
    if (!shown.length) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Постов нет (окно/фильтр).";
      feed.appendChild(empty);
      return;
    }
    shown.forEach(function (p) {
      var node = tpl.content.cloneNode(true);
      node.querySelector(".when").textContent = fmtWhen(p.ts);
      node.querySelector(".chat").textContent = p.chat || "—";
      var sender = node.querySelector(".sender");
      var s = String(p.sender || "").replace(/^@/, "");
      if (/^[A-Za-z0-9_]{3,32}$/.test(s)) {
        sender.textContent = "@" + s;
        sender.href = "https://t.me/" + s;
      } else if (s) {
        sender.textContent = s;          // display-имя без username — не ссылка
        sender.removeAttribute("href");
      } else {
        sender.textContent = "без username";
        sender.removeAttribute("href");
      }
      var text = node.querySelector(".text");
      text.textContent = p.text || "";
      if ((p.text || "").length > 220) {
        text.classList.add("clamped");
        text.addEventListener("click", function () {
          text.classList.toggle("clamped");
        });
      }
      var catChip = node.querySelector(".chip.cat");
      var v1 = p.v1 || {};
      if (v1.verdict) {
        catChip.textContent = v1.category || v1.verdict;
        catChip.classList.add("cat-" + v1.verdict);
      } else if (v1.state === "pre_journal") {
        catChip.textContent = "архив: до журнала вердиктов";
        catChip.classList.add("state-pre-journal");
      } else {
        catChip.textContent = "в обработке…";
        catChip.classList.add("state-pending");
      }
      var modeChip = node.querySelector(".chip.mode");
      if (v1.mode) {
        modeChip.textContent = v1.mode_label || v1.mode;
        if (v1.mode === "classifier_down") {
          modeChip.classList.add("mode-classifier_down");
        } else if (v1.escalated) {
          modeChip.classList.add("mode-escalated");
        }
      } else {
        modeChip.textContent = "режим: —";
      }
      var modelsChip = node.querySelector(".chip.models");
      if (v1.models && v1.models.length) {
        modelsChip.hidden = false;
        modelsChip.textContent = "🧠 " + v1.models.join(" → ");
      }
      node.querySelector(".chip.v2").textContent = p.v2 ? p.v2 : "—";
      var orderChip = node.querySelector(".chip.order");
      if (p.order_status) {
        orderChip.hidden = false;
        orderChip.textContent = "заказ: " + p.order_status;
      }
      var pitchStatus = node.querySelector(".pitch-status");
      var pitchReason = node.querySelector(".pitch-reason");
      var pitchTribrain = node.querySelector(".pitch-tribrain");
      if (!("pitch" in p)) {
        // старый бэкенд ещё не отдаёт поле pitch — не путать с «не отправлен»
        pitchStatus.textContent = "нет данных";
        pitchStatus.classList.add("pitch-unknown");
        pitchStatus.title = "Бэкенд не обновлён: поле pitch отсутствует в ответе API";
      } else {
        var pitch = p.pitch || {};
        if (pitch.sent === true) {
          pitchStatus.textContent = "✅ отправлен" +
            (pitch.type_label ? " · " + pitch.type_label : "");
          pitchStatus.classList.add("pitch-sent");
          pitchStatus.title = pitch.ts ? "Отправлен " + fmtWhen(pitch.ts) : "";
        } else if (pitch.sent === false) {
          pitchStatus.textContent = "❌ не отправлен";
          pitchStatus.classList.add("pitch-not-sent");
          var reason = pitch.reason || "причина не зафиксирована";
          pitchStatus.title = reason;
          pitchReason.hidden = false;
          pitchReason.textContent = "Почему: " + reason;
          if (pitch.tribrain_status) {
            pitchTribrain.hidden = false;
            var tStatus = TRIBRAIN_STATUS_RU[pitch.tribrain_status] || pitch.tribrain_status;
            if (pitch.tribrain_status === "done" && pitch.tribrain_summary) {
              pitchTribrain.textContent = "🧩 TriBrain: " + pitch.tribrain_summary;
            } else if (pitch.tribrain_status === "failed" && pitch.tribrain_summary) {
              pitchTribrain.textContent = "🧩 TriBrain: " + tStatus + " — " + pitch.tribrain_summary;
            } else {
              pitchTribrain.textContent = "🧩 TriBrain " + tStatus +
                " — решение (внедрить/нет) придёт в бот";
            }
          }
        } else {
          pitchStatus.textContent = "— нет адресата";
          pitchStatus.classList.add("pitch-unknown");
          if (pitch.reason) {
            pitchStatus.title = pitch.reason;
            pitchReason.hidden = false;
            pitchReason.textContent = "Почему: " + pitch.reason;
          }
        }
      }
      feed.appendChild(node);
    });
  }

  function load() {
    var hours = hoursSel.value || "24";
    var cat = catSel.value || "";
    // категория уходит на сервер: фильтр обязан отсекать ДО среза по limit,
    // иначе на busy-чатах старый реальный лид выбранной категории тонет
    // среди свежего шума ещё до того, как дойдёт до этого фильтра
    fetch("/api/app/posts_live?hours=" + encodeURIComponent(hours) +
          (cat ? "&cat=" + encodeURIComponent(cat) : "") +
          (archiveCb.checked ? "&include_archive=1" : ""))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.ok !== true) {
          metaLine.textContent = "Ошибка данных: " +
            ((data && data.error) || "нет ответа");
          return;
        }
        lastPosts = data.posts || [];
        var withVerdict = lastPosts.filter(function (p) {
          return p.v1 && p.v1.verdict;
        }).length;
        metaLine.textContent = "Live: агент изучил за " + data.hours + "ч: " +
          (data.journal_entries || 0) + " · в ленте: " + lastPosts.length +
          " · с вердиктом: " + withVerdict +
          " · обновлено " + fmtWhen(data.generated_at);
        if (data.v2_note) {
          v2note.hidden = false;
          v2note.textContent = data.v2_note;
        }
        render();
      })
      .catch(function (e) {
        metaLine.textContent = "Сеть/бэкенд недоступны: " + e;
      });
  }

  function schedule() {
    if (timer) { clearInterval(timer); timer = null; }
    if (autoCb.checked) { timer = setInterval(load, 5000); }
  }

  hoursSel.addEventListener("change", load);
  catSel.addEventListener("change", load);
  autoCb.addEventListener("change", schedule);
  archiveCb.addEventListener("change", load);
  refreshBtn.addEventListener("click", load);
  load();
  schedule();
}());
