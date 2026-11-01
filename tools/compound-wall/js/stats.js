(function () {
var CW = window.CW;
var dateKey = CW.dateKey, parseKey = CW.parseKey, addDays = CW.addDays;
/* =========================================================
   stats.js — 计算层
   连续天数 / 分级 / 累计曲线，全部纯函数，无副作用。
   ========================================================= */



/** 当日相对强度 → 0..4 分级。
 *  以该习惯历史「非零打卡值」的分位为基准做相对分级，
 *  这样无论单位是页/分钟/字，深浅都有意义。*/
function buildLeveler(logs) {
  const values = Object.values(logs)
    .map((l) => Number(l.value))
    .filter((v) => v > 0)
    .sort((a, b) => a - b);

  if (values.length === 0) return () => 0;

  // 四分位阈值（相对强度）
  const q = (p) => values[Math.min(values.length - 1, Math.floor(p * values.length))];
  const t1 = q(0.25), t2 = q(0.5), t3 = q(0.8);

  return (value) => {
    if (!value || value <= 0) return 0;
    if (value <= t1) return 1;
    if (value <= t2) return 2;
    if (value <= t3) return 3;
    return 4;
  };
}

/** 计算 streak 信息。基于今天（含今天）向前数连续打卡。
 *  打卡规则：当日数值 > 0 才算打卡（与 buildLeveler 口径一致）；
 *  数值为 0 的旧记录保留在数据里，但不计入连续、最长和累计天数。*/
function computeStreaks(logs, storedLongest = 0) {
  const isCheckin = (l) => !!l && Number(l.value) > 0;
  const keys = Object.keys(logs).filter((k) => isCheckin(logs[k]));
  const has = (d) => isCheckin(logs[dateKey(d)]);

  // 当前连续：从今天往回；若今天没打、但昨天打了，仍计入（宽限到今天结束）
  let current = 0;
  const today = new Date();
  let cursor = new Date(today);
  if (!has(cursor)) cursor = addDays(cursor, -1); // 今天还没打卡也不立即清零
  while (has(cursor)) {
    current++;
    cursor = addDays(cursor, -1);
  }
  // 若今天和昨天都没打，current 应为 0
  if (!has(today) && !has(addDays(today, -1))) current = 0;

  // 历史最长：扫描全部
  let best = 0;
  if (keys.length) {
    const sorted = keys.slice().sort();
    let run = 1;
    best = 1;
    for (let i = 1; i < sorted.length; i++) {
      const prev = parseKey(sorted[i - 1]);
      const cur = parseKey(sorted[i]);
      const gap = Math.round((cur - prev) / 86400000);
      run = gap === 1 ? run + 1 : 1;
      if (run > best) best = run;
    }
  }
  best = Math.max(best, current, storedLongest);

  const total = keys.length;
  const sum = Object.values(logs).reduce((s, l) => s + (Number(l.value) || 0), 0);

  return { current, best, total, sum };
}

/** 生成热力墙网格数据：53 周 × 7 天，列优先，末列含今天。
 *  返回二维：weeks[col] = [{key, level, value, note, isFuture, isToday}] */
function buildWallGrid(logs, weeks = 53) {
  const leveler = buildLeveler(logs);
  const today = new Date();
  const todayKey = dateKey(today);

  // 让最后一列的本周对齐：找出本周的周日(0)起点
  // 网格右下角是今天；从今天往回推到能放满 weeks*7 的起点。
  const dow = today.getDay(); // 0=周日
  // 末列顶端 = 本周周日
  const lastSunday = addDays(today, -dow);
  const startSunday = addDays(lastSunday, -(weeks - 1) * 7);

  const grid = [];
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let r = 0; r < 7; r++) {
      const d = addDays(startSunday, w * 7 + r);
      const key = dateKey(d);
      const log = logs[key];
      const isFuture = d > today;
      col.push({
        key,
        date: d,
        isFuture,
        isToday: key === todayKey,
        value: log ? log.value : null,
        note: log ? log.note : "",
        level: log ? leveler(log.value) : 0,
        has: !!log,
      });
    }
    grid.push(col);
  }
  return grid;
}

/** 累计曲线数据点。按日期排序的打卡，输出累计和序列。
 *  linear: 直接累计求和；compound: 把每日值当作「相对增长率」复利累乘。*/
function buildCurveData(logs, mode = "linear") {
  const keys = Object.keys(logs).sort();
  if (keys.length === 0) return { points: [], labels: [] };

  const dailyAvg =
    keys.reduce((s, k) => s + (Number(logs[k].value) || 0), 0) / keys.length || 1;

  const points = [];
  const labels = [];
  let cumLinear = 0;
  let cumCompound = 1; // 起始基数 1（=100%）

  keys.forEach((k) => {
    const v = Number(logs[k].value) || 0;
    cumLinear += v;
    // 复利：把当日产出归一化成「相对日均的增益率」，再乘进基数。
    // 例如做到日均 → +当日/日均 的比率，体现「每天在自己基础上再进一步」。
    const rate = dailyAvg > 0 ? v / dailyAvg : 0;
    cumCompound *= 1 + rate * 0.05; // 0.05 为温和复利系数，避免数值爆炸
    points.push(mode === "compound" ? cumCompound : cumLinear);
    labels.push(k);
  });

  return { points, labels, dailyAvg };
}

/** 里程碑阈值 */
const MILESTONES = [7, 30, 100, 365];
const MILESTONE_TEXT = {
  7: { title: "连续 7 天", text: "一周了。习惯的种子，开始扎根。" },
  30: { title: "连续 30 天", text: "一个月。你已经不是当初那个容易放弃的人。" },
  100: { title: "连续 100 天", text: "百日筑基。复利的拐点，往往就在此后悄悄到来。" },
  365: { title: "连续 365 天", text: "整整一年。这面墙，已经长成了你的一部分。" },
};

/** 判断本次打卡是否刚好命中某个里程碑（current 是更新后的连续天数） */
function hitMilestone(prevCurrent, newCurrent) {
  return MILESTONES.find((m) => newCurrent >= m && prevCurrent < m) || null;
}

Object.assign(window.CW, { buildLeveler, computeStreaks, buildWallGrid, buildCurveData, MILESTONES, MILESTONE_TEXT, hitMilestone });
})();
