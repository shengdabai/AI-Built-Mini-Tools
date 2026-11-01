/* =========================================================
   app.js — 主控制器
   视图切换、打卡、习惯管理、热力墙/曲线渲染、导出导入、里程碑。
   ========================================================= */

(function () {
  const S = window.CW;
  const buildWallGrid = S.buildWallGrid,
        buildCurveData = S.buildCurveData,
        computeStreaks = S.computeStreaks,
        hitMilestone = S.hitMilestone,
        MILESTONE_TEXT = S.MILESTONE_TEXT,
        drawCurve = S.drawCurve;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  activeId: null,
  curveMode: "linear",
};

/* ===================== 初始化 ===================== */
async function init() {
  try {
    await S.hydrateFromIDB();
  } catch (e) {
    // IndexedDB 兜底恢复失败不应阻断主界面渲染
    console.warn("IDB 恢复跳过:", e);
  }
  initTheme();
  try { await seedDefaultIfEmpty(); } catch (e) { toast("未保存：" + e.message); }

  state.activeId = resolveActiveId();
  bindGlobal();
  bindModals();
  bindHabitForm();
  bindCheckForm();
  bindShare();

  renderAll();
  // 字体加载后重绘曲线（避免度量错位）
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => renderCurve());
  }
  window.addEventListener("resize", debounce(renderCurve, 150));
}

async function seedDefaultIfEmpty() {
  if (S.getHabits().length === 0) {
    await S.createHabit({ name: "读书", unit: "页", color: "#6b8e23" });
  }
}
function resolveActiveId() {
  const habits = S.getHabits();
  const saved = S.getActiveHabitId();
  if (saved && habits.some((h) => h.id === saved)) return saved;
  const first = habits[0]?.id || null;

  return first;
}
function activeHabit() {
  return S.getHabits().find((h) => h.id === state.activeId) || null;
}

/* ===================== 主题 ===================== */
function initTheme() {
  let saved = "auto";
  try { saved = localStorage.getItem("cw:theme") || "auto"; } catch {}
  document.body.dataset.theme = saved;
}
function cycleTheme() {
  const order = ["auto", "light", "dark"];
  const cur = document.body.dataset.theme || "auto";
  const next = order[(order.indexOf(cur) + 1) % order.length];
  document.body.dataset.theme = next;
  try { localStorage.setItem("cw:theme", next); } catch {}
  toast(next === "auto" ? "跟随系统" : next === "dark" ? "深色模式" : "浅色模式");
  renderCurve();
}

/* ===================== 全局事件 ===================== */
function bindGlobal() {
  $("#themeToggle").addEventListener("click", cycleTheme);

  $$(".topnav__btn").forEach((btn) =>
    btn.addEventListener("click", () => switchView(btn.dataset.view))
  );

  $("#habitSelect").addEventListener("change", async (e) => {
    try { await S.setActiveHabitId(e.target.value); state.activeId = S.getActiveHabitId(); }
    catch (err) { toast("未保存：" + err.message); }
    renderAll();
  });

  $("#todayCheckBtn").addEventListener("click", () => openCheck());
  $("#addHabitBtn").addEventListener("click", () => openHabit(null));

  // 曲线视角切换
  $$("#curveToggle .seg-toggle__btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      $$("#curveToggle .seg-toggle__btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.curveMode = btn.dataset.mode;
      renderCurve();
    })
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllModals();
  });
}

function switchView(name) {
  $$(".topnav__btn").forEach((b) => b.classList.toggle("is-active", b.dataset.view === name));
  $$(".view").forEach((v) => v.classList.remove("is-active"));
  $(`#view-${name}`).classList.add("is-active");
  if (name === "dashboard") renderCurve();
  if (name === "share") renderPoster();
  if (name === "habits") renderHabitList();
}

/* ===================== 渲染：全部 ===================== */
function renderAll() {
  renderHabitSelect();
  renderStats();
  renderWall();
  renderCurve();
  renderHabitList();
  updateStorageNote();
}

function renderHabitSelect() {
  const sel = $("#habitSelect");
  const habits = S.getHabits();
  sel.innerHTML = habits
    .map((h) => `<option value="${h.id}">${esc(h.name)}</option>`)
    .join("");
  if (state.activeId) sel.value = state.activeId;
}

/* ===================== 渲染：统计卡 ===================== */
function renderStats() {
  const h = activeHabit();
  if (!h) return;
  const logs = S.getLogs(h.id);
  const meta = S.getMeta();
  // 历史最长按 habitId 隔离，避免多个习惯互相污染
  meta.longestByHabit = meta.longestByHabit || {};
  const storedBest = meta.longestByHabit[h.id] || 0;
  const { current, best, total, sum } = computeStreaks(logs, storedBest);

  // 持久化历史最长
  if (best > storedBest) {
    meta.longestByHabit[h.id] = best;
    S.saveMeta(meta).catch(err => toast("统计未保存：" + err.message));
  }

  $("#curStreak").textContent = current;
  $("#bestStreak").textContent = best;
  $("#totalDays").textContent = total;
  $("#yearPct").textContent = Math.round((Math.min(current, 365) / 365) * 100);

  $("#curStreakHint").textContent =
    current === 0 ? "从今天开始，别断它" : `${h.name}，已连续 ${current} 天`;
  $("#totalSumHint").textContent = `累计 ${fmtNum(sum)} ${h.unit}`;
}

/* ===================== 渲染：热力墙 ===================== */
function renderWall() {
  const h = activeHabit();
  const wall = $("#wall");
  if (!h) { wall.innerHTML = ""; return; }
  const logs = S.getLogs(h.id);
  const grid = buildWallGrid(logs, 53);

  $("#wallTitle").textContent = `${h.name} · 热力墙`;
  setAccentColor(h.color);

  const frag = document.createDocumentFragment();
  grid.forEach((col) => {
    col.forEach((day) => {
      const cell = document.createElement("div");
      cell.className = "cell";
      if (day.isFuture) cell.classList.add("is-future");
      if (day.isToday) cell.classList.add("is-today");
      cell.dataset.level = day.level;
      cell.dataset.key = day.key;
      if (!day.isFuture) {
        // 键盘可达：每个可补卡的格子都能 Tab 聚焦并用 Enter/Space 打开
        cell.tabIndex = 0;
        cell.setAttribute("role", "button");
        cell.setAttribute(
          "aria-label",
          day.has
            ? `${day.key}，${fmtNum(day.value)} ${h.unit}，回车编辑`
            : `${day.key}，未打卡，回车补卡`
        );
        cell.addEventListener("mouseenter", (e) => showTip(e, day, h));
        cell.addEventListener("mousemove", (e) => moveTip(e));
        cell.addEventListener("mouseleave", hideTip);
        cell.addEventListener("focus", (e) => showTipAt(cell, day, h));
        cell.addEventListener("blur", hideTip);
        cell.addEventListener("click", () => openCheck(day.key));
        cell.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openCheck(day.key);
          }
        });
      }
      frag.appendChild(cell);
    });
  });
  wall.innerHTML = "";
  wall.appendChild(frag);

  const first = grid[0][0].key;
  const last = grid[grid.length - 1][6].key;
  $("#wallRangeNote").textContent = `${first} → ${last}`;

  // 滚到最右（看到最近）
  requestAnimationFrame(() => {
    const sc = $(".wall-scroll");
    if (sc) sc.scrollLeft = sc.scrollWidth;
  });
}

/* ===================== 渲染：曲线 ===================== */
function renderCurve() {
  const h = activeHabit();
  const canvas = $("#curveCanvas");
  const empty = $("#curveEmpty");
  const caption = $("#curveCaption");
  if (!h) return;
  const logs = S.getLogs(h.id);
  const data = buildCurveData(logs, state.curveMode);

  if (data.points.length === 0) {
    empty.style.display = "grid";
    caption.textContent = "";
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  empty.style.display = "none";
  drawCurve(canvas, data, state.curveMode);

  const lastVal = data.points[data.points.length - 1];
  if (state.curveMode === "linear") {
    caption.innerHTML = `按累计计：你已经积累了 <b>${fmtNum(lastVal)} ${esc(h.unit)}</b>。线性视角下，每天看起来都差不多。`;
  } else {
    caption.innerHTML = `复利视角：把每天的产出视作「在昨天基础上再进一步」，当前增益系数 <b>×${lastVal.toFixed(2)}</b>。坚持越久，曲线越陡。`;
  }
}

/* ===================== Tip ===================== */
const tip = $("#tip");
function showTip(e, day, h) {
  if (day.has) {
    const noteHtml = day.note ? `<div class="tip__note">「${esc(day.note)}」</div>` : "";
    tip.innerHTML = `<b>${fmtNum(day.value)} ${esc(h.unit)}</b> <span class="tip__date">· ${day.key}</span>${noteHtml}`;
  } else {
    tip.innerHTML = `<span class="tip__date">${day.key}</span> · 这天还空着，点一下补卡`;
  }
  tip.hidden = false;
  moveTip(e);
}
function moveTip(e) {
  tip.style.left = e.clientX + "px";
  tip.style.top = e.clientY + "px";
}
// 键盘聚焦时按元素位置定位 tip（无鼠标坐标可用）
function showTipAt(cell, day, h) {
  showTip({ clientX: 0, clientY: 0 }, day, h);
  const r = cell.getBoundingClientRect();
  tip.style.left = r.left + r.width / 2 + "px";
  tip.style.top = r.top + "px";
}
function hideTip() { tip.hidden = true; }

/* ===================== 习惯列表（管理页） ===================== */
function renderHabitList() {
  const list = $("#habitList");
  const habits = S.getHabits();
  list.innerHTML = habits
    .map((h) => {
      const logs = S.getLogs(h.id);
      const total = computeStreaks(logs).total;
      return `
      <div class="habit-item" data-id="${h.id}">
        <span class="habit-item__dot" style="background:${esc(h.color)}"></span>
        <div class="habit-item__main">
          <div class="habit-item__name">${esc(h.name)}</div>
          <div class="habit-item__meta">单位：${esc(h.unit)} · 累计打卡 ${total} 天 · 建于 ${new Date(h.createdAt).toLocaleDateString("zh-CN")}</div>
        </div>
        <div class="habit-item__actions">
          <button class="btn btn--ghost btn--sm" data-act="view">查看</button>
          <button class="btn btn--ghost btn--sm" data-act="edit">编辑</button>
        </div>
      </div>`;
    })
    .join("");

  $$(".habit-item", list).forEach((el) => {
    const id = el.dataset.id;
    el.querySelector('[data-act="view"]').addEventListener("click", async () => {
      try { await S.setActiveHabitId(id); } catch (err) { toast("未保存：" + err.message); return; }
      state.activeId = id;
      renderAll();
      switchView("dashboard");
    });
    el.querySelector('[data-act="edit"]').addEventListener("click", () => openHabit(id));
  });
}

/* ===================== 模态：通用 ===================== */
function bindModals() {
  // 任何带 data-close 的元素（背景遮罩、关闭叉、取消按钮）点击即关闭
  $$("[data-close]").forEach((el) =>
    el.addEventListener("click", () => closeAllModals())
  );
}
function closeAllModals() {
  $("#checkModal").hidden = true;
  $("#habitModal").hidden = true;
  $("#celebrate").hidden = true;
}

/* ===================== 模态：今日打卡 ===================== */
function bindCheckForm() {
  $("#checkForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const h = activeHabit();
    if (!h) return;
    const key = $("#checkDate").value;
    const value = $("#checkValue").value;
    const note = $("#checkNote").value;
    if (!key || value === "") return;

    // 打卡前的连续天数（用于里程碑判定）
    const storedBest = (S.getMeta().longestByHabit || {})[h.id] || 0;
    const beforeLogs = S.getLogs(h.id);
    const before = computeStreaks(beforeLogs, storedBest).current;

    try { await S.setLog(h.id, key, value, note); }
    catch (err) { toast("打卡未保存：" + err.message); return; }

    const afterLogs = S.getLogs(h.id);
    const after = computeStreaks(afterLogs, storedBest).current;

    closeAllModals();
    renderAll();
    rippleCell(key);

    const ms = hitMilestone(before, after);
    if (ms) {
      setTimeout(() => celebrate(ms), 450);
    } else {
      toast("已记下这一格 · " + key);
    }
  });
}

function openCheck(dateKey) {
  const h = activeHabit();
  if (!h) { toast("请先创建一个习惯"); return; }
  const key = dateKey || S.dateKey();
  const logs = S.getLogs(h.id);
  const existing = logs[key];

  $("#checkHabitName").textContent = `${h.name}（${h.unit}）`;
  $("#checkUnit").textContent = `· ${h.unit}`;
  $("#checkDate").value = key;
  $("#checkDate").max = S.dateKey(); // 不允许未来
  $("#checkValue").value = existing ? existing.value : "";
  $("#checkNote").value = existing ? existing.note : "";
  $("#checkModalTitle").textContent = existing ? "编辑这一格" : "今日打卡";
  $("#checkModal").hidden = false;
  setTimeout(() => $("#checkValue").focus(), 50);
}

/* ===================== 模态：习惯编辑 ===================== */
function bindHabitForm() {
  // 色板
  const picker = $("#colorPicker");
  picker.innerHTML = S.PALETTE.map(
    (c) => `<span class="color-swatch" data-color="${c}" style="background:${c}"></span>`
  ).join("");
  picker.addEventListener("click", (e) => {
    const sw = e.target.closest(".color-swatch");
    if (!sw) return;
    $$(".color-swatch", picker).forEach((s) => s.classList.remove("is-selected"));
    sw.classList.add("is-selected");
  });

  $("#habitForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $("#habitId").value;
    const name = $("#habitName").value.trim();
    const unit = $("#habitUnit").value.trim();
    const color = $(".color-swatch.is-selected")?.dataset.color || S.PALETTE[0];
    if (!name || !unit) return;

    try {
    if (id) {
      await S.updateHabit(id, { name, unit, color });
      toast("习惯已更新");
    } else {
      const h = await S.createHabit({ name, unit, color });
      state.activeId = h.id;
      toast("新习惯已创建");
    }
    } catch (err) { toast("习惯未保存：" + err.message); return; }
    closeAllModals();
    renderAll();
  });

  $("#deleteHabitBtn").addEventListener("click", async () => {
    const id = $("#habitId").value;
    if (!id) return;
    if (S.getHabits().length <= 1) {
      toast("至少保留一个习惯");
      return;
    }
    if (confirm("删除此习惯及其全部打卡记录？此操作不可恢复。")) {
      try { await S.deleteHabit(id); } catch (err) { toast("未删除：" + err.message); return; }
      state.activeId = resolveActiveId();
      closeAllModals();
      renderAll();
      toast("已删除");
    }
  });
}

function openHabit(id) {
  const picker = $("#colorPicker");
  $$(".color-swatch", picker).forEach((s) => s.classList.remove("is-selected"));

  if (id) {
    const h = S.getHabits().find((x) => x.id === id);
    $("#habitModalTitle").textContent = "编辑习惯";
    $("#habitId").value = h.id;
    $("#habitName").value = h.name;
    $("#habitUnit").value = h.unit;
    Array.from(picker.querySelectorAll(".color-swatch")).find(el => el.dataset.color === h.color)?.classList.add("is-selected");
    $("#deleteHabitBtn").hidden = false;
  } else {
    $("#habitModalTitle").textContent = "新增习惯";
    $("#habitId").value = "";
    $("#habitName").value = "";
    $("#habitUnit").value = "";
    picker.firstElementChild?.classList.add("is-selected");
    $("#deleteHabitBtn").hidden = true;
  }
  $("#habitModal").hidden = false;
  setTimeout(() => $("#habitName").focus(), 50);
}

/* ===================== 里程碑庆祝 ===================== */
function celebrate(days) {
  const t = MILESTONE_TEXT[days];
  $("#celebrateNum").textContent = days;
  $("#celebrateTitle").textContent = t.title;
  $("#celebrateText").textContent = t.text;
  $("#celebrate").hidden = false;
}
function rippleCell(key) {
  const cell = $(`.cell[data-key="${key}"]`);
  if (cell) {
    cell.classList.add("ripple");
    cell.addEventListener("animationend", () => cell.classList.remove("ripple"), { once: true });
  }
}

/* ===================== 分享 / 导出 / 导入 ===================== */
function bindShare() {
  $("#exportPngBtn").addEventListener("click", exportPNG);
  $("#exportJsonBtn").addEventListener("click", exportJSON);
  $("#importPasteBtn").addEventListener("click", () => {
    const txt = $("#importText").value.trim();
    if (!txt) { toast("请先粘贴 JSON"); return; }
    doImport(txt);
  });
  $("#importFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => doImport(reader.result);
    reader.readAsText(file);
    e.target.value = "";
  });
}

function renderPoster() {
  const h = activeHabit();
  if (!h) return;
  const logs = S.getLogs(h.id);
  const storedBest = (S.getMeta().longestByHabit || {})[h.id] || 0;
  const { current, best, total } = computeStreaks(logs, storedBest);

  $("#posterTitle").textContent = `${h.name} · 复利墙`;
  $("#posterStats").innerHTML = `
    <div class="poster__stat"><b>${current}</b><span>当前连续</span></div>
    <div class="poster__stat"><b>${best}</b><span>历史最长</span></div>
    <div class="poster__stat"><b>${total}</b><span>累计打卡</span></div>`;

  // 海报用近 30 周的小墙
  const grid = buildWallGrid(logs, 30);
  const pw = $("#posterWall");
  pw.innerHTML = "";
  const frag = document.createDocumentFragment();
  grid.forEach((col) =>
    col.forEach((day) => {
      const c = document.createElement("div");
      c.className = "cell";
      if (day.isFuture) c.classList.add("is-future");
      c.dataset.level = day.level;
      frag.appendChild(c);
    })
  );
  pw.appendChild(frag);
}

function exportPNG() {
  renderPoster();
  const node = $("#poster");
  if (typeof window.html2canvas !== "function") {
    toast("图片导出组件未加载");
    return;
  }
  toast("正在生成图片…");
  const bg = getComputedStyle(document.body).getPropertyValue("--bg").trim() || "#faf8f3";
  window
    .html2canvas(node, { backgroundColor: bg, scale: 2, useCORS: true, logging: false })
    .then((canvas) => {
      const link = document.createElement("a");
      const h = activeHabit();
      link.download = `复利墙-${h ? h.name : "habit"}-${S.dateKey()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast("图片已导出");
    })
    .catch((err) => {
      console.error(err);
      toast("导出失败：" + err.message);
    });
}

async function exportJSON() {
  const bundle = S.exportAll();
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = `compoundwall-backup-${S.dateKey()}.json`;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
  try {
    await S.saveMeta({...S.getMeta(), lastExport: bundle.exportedAt});
    toast("数据备份已导出");
  } catch (err) { toast("备份已导出；备份时间未保存：" + err.message); }
  updateStorageNote();
}

async function doImport(text) {
  let bundle;
  try {
    bundle = JSON.parse(text);
  } catch {
    toast("JSON 解析失败，请检查格式");
    return;
  }
  if (!confirm("导入将覆盖当前全部习惯与记录，确定继续？")) return;
  try {
    const n = await S.importAll(bundle);
    state.activeId = resolveActiveId();
    $("#importText").value = "";
    renderAll();
    switchView("dashboard");
    toast(`已恢复 ${n} 个习惯`);
  } catch (err) {
    toast("导入失败：" + err.message);
  }
}

function updateStorageNote() {
  const meta = S.getMeta();
  const last = meta.lastExport ? new Date(meta.lastExport).toLocaleString("zh-CN") : "从未";
  $("#storageNote").textContent = `存储：${S.storageMode()} · 上次备份：${last}`;
}

/* ===================== 工具 ===================== */
function setAccentColor(color) {
  // 让主色随习惯标签色微调（仅按钮/边框等，不改热力墙绿阶以保持气质统一）
  if (!color) return;
  document.body.style.setProperty("--habit-color", color);
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2200);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
function fmtNum(n) {
  n = Number(n) || 0;
  if (Number.isInteger(n)) return n.toLocaleString("zh-CN");
  return n.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* 启动 */
init();
})();
