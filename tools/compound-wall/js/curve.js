(function () {
/* =========================================================
   curve.js — 原生 Canvas 绘制累计增长曲线
   高 DPI 适配，暖绿渐变填充，参考线 + 当前值标注。
   ========================================================= */

function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function drawCurve(canvas, data, mode) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const W = Math.max(1, rect.width);
  const H = Math.max(1, rect.height);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const points = data.points;
  if (!points || points.length === 0) return;

  const padL = 12, padR = 14, padT = 16, padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const max = Math.max(...points);
  const min = Math.min(...points, 0);
  const range = max - min || 1;

  const n = points.length;
  const xAt = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v) => padT + plotH - ((v - min) / range) * plotH;

  const accent = cssVar("--accent") || "#6b8e23";
  const accentDeep = cssVar("--accent-deep") || "#4e6b18";
  const line = cssVar("--line") || "#e6e0d2";
  const ink3 = cssVar("--ink-3") || "#8c8579";

  // 基线网格（3 条）
  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  for (let g = 0; g <= 2; g++) {
    const y = padT + (plotH / 2) * g;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 渐变填充
  const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
  grad.addColorStop(0, hexA(accent, 0.28));
  grad.addColorStop(1, hexA(accent, 0.02));

  // 路径（平滑）
  const path = new Path2D();
  path.moveTo(xAt(0), yAt(points[0]));
  for (let i = 1; i < n; i++) {
    const x0 = xAt(i - 1), y0 = yAt(points[i - 1]);
    const x1 = xAt(i), y1 = yAt(points[i]);
    const mx = (x0 + x1) / 2;
    path.bezierCurveTo(mx, y0, mx, y1, x1, y1);
  }

  // 填充区域
  const fill = new Path2D(path);
  fill.lineTo(xAt(n - 1), padT + plotH);
  fill.lineTo(xAt(0), padT + plotH);
  fill.closePath();
  ctx.fillStyle = grad;
  ctx.fill(fill);

  // 描线
  ctx.strokeStyle = accentDeep;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.stroke(path);

  // 终点圆点
  const ex = xAt(n - 1), ey = yAt(points[n - 1]);
  ctx.fillStyle = accentDeep;
  ctx.beginPath();
  ctx.arc(ex, ey, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = cssVar("--paper") || "#fff";
  ctx.beginPath();
  ctx.arc(ex, ey, 1.4, 0, Math.PI * 2);
  ctx.fill();

  // 终值标注
  ctx.fillStyle = ink3;
  ctx.font = "11px -apple-system, sans-serif";
  ctx.textAlign = "right";
  const label = mode === "compound" ? `×${points[n - 1].toFixed(2)}` : fmt(points[n - 1]);
  ctx.fillText(label, W - padR, padT + 4);
}

function fmt(n) {
  if (n >= 10000) return (n / 10000).toFixed(1) + "万";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return Math.round(n).toString();
}

/* 把 hex 颜色加 alpha；兼容 #rgb / #rrggbb */
function hexA(hex, a) {
  hex = hex.replace("#", "");
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return `rgba(107,142,35,${a})`;
  return `rgba(${r},${g},${b},${a})`;
}

window.CW.drawCurve = drawCurve;
})();
