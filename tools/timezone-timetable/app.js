'use strict';
(function () {
  const C = globalThis.TzCore;
  const KEY = 'tzcheck.v1';
  const WD = C.WEEKDAY_NAMES;
  const $ = (id) => document.getElementById(id);

  const realToday = (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
  const today = C.resolveToday(location.search, realToday);

  let state = { version: 1, teacherTz: guessTz(), students: [], rules: [], exceptions: [] };
  let generated = null; /* { sig, weekStart, lessons, warnings, dst } */
  let toastTimer = null;
  let pendingConfirm = null;
  let confirmTrigger = null;
  let editingId = null;
  const baseFixed = C.resolveToday(location.search, '') !== '';
  const DEMO_WEEK = '2026-10-26';

  function guessTz() {
    try { const z = Intl.DateTimeFormat().resolvedOptions().timeZone; if (C.isValidTz(z)) return z; } catch (e) { /* 回退 */ }
    return 'UTC';
  }
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function h(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  /* ---------- 存储 ---------- */
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      $('storage-warning').hidden = true;
      return true;
    } catch (e) {
      $('storage-warning').hidden = false;
      return false;
    }
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const v = C.validateImport(raw);
      if (v.ok) state = v.data;
    } catch (e) { /* 读取失败当作空数据 */ }
  }
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2500);
  }
  function commit(okMsg) {
    const ok = save();
    if (ok && okMsg) toast(okMsg);
    renderAll();
  }
  function setMsg(id, text, isErr) { const e = $(id); e.textContent = text; e.classList.toggle('is-error', !!isErr); }

  /* ---------- 确认区 ---------- */
  function askConfirm(text, fn, trigger) {
    pendingConfirm = fn;
    confirmTrigger = trigger || document.activeElement;
    $('confirm-text').textContent = text;
    $('confirm-area').hidden = false;
    $('confirm-no').focus();
  }
  function closeConfirm(restore) {
    pendingConfirm = null; $('confirm-area').hidden = true;
    const t = confirmTrigger; confirmTrigger = null;
    if (restore && t && document.contains(t) && typeof t.focus === 'function') t.focus();
  }
  function hasUserData() {
    return state.students.length + state.rules.length + state.exceptions.length > 0 || editingId !== null || $('stu-name').value.trim() !== '';
  }
  function dataCounts(st) { return st.students.length + ' 位学员、' + st.rules.length + ' 节课、' + st.exceptions.length + ' 条例外'; }
  /* 重绘后把焦点放回同一条目或相邻条目,没有条目时放到表单第一项 */
  function focusNear(listId, index, fallbackId) {
    const btns = document.querySelectorAll('#' + listId + ' .item .btn-danger');
    if (btns.length) { btns[Math.min(index, btns.length - 1)].focus(); return; }
    const f = $(fallbackId); if (f) f.focus();
  }
  function clearInvalid() { document.querySelectorAll('[aria-invalid]').forEach((n) => n.removeAttribute('aria-invalid')); }
  /* 校验失败:原因写在表单旁,出错控件标红并获得焦点 */
  function fail(msgId, text, ctrlId) {
    clearInvalid(); setMsg(msgId, text, true);
    if (ctrlId) { const c = $(ctrlId); c.setAttribute('aria-invalid', 'true'); c.focus(); }
  }
  function endEdit() {
    editingId = null; $('stu-name').value = ''; $('stu-submit').textContent = '添加学员'; $('stu-cancel').hidden = true;
  }

  /* ---------- 下拉 ---------- */
  function fillTz(sel, value) {
    if (!sel.options.length) {
      for (const z of C.tzList()) { const o = document.createElement('option'); o.value = z; o.textContent = z; sel.appendChild(o); }
    }
    if (value) {
      if (![...sel.options].some((o) => o.value === value)) { const o = document.createElement('option'); o.value = value; o.textContent = value; sel.appendChild(o); }
      sel.value = value;
    }
  }
  function studentName(id) { const s = state.students.find((x) => x.id === id); return s ? s.name : '(已删除学员)'; }
  function ruleLabel(r) { return WD[r.weekday] + ' ' + r.start + ' · ' + studentName(r.studentId); }

  /* ---------- 渲染:设置区 ---------- */
  function renderSetup() {
    fillTz($('teacher-tz'), state.teacherTz);
    fillTz($('stu-tz'));
    const sl = $('student-list'); sl.textContent = '';
    for (const s of state.students) {
      const li = h('li', 'item');
      const m = h('span', 'item-main'); m.appendChild(h('strong', '', s.name)); m.appendChild(h('span', 'muted', '  ' + s.tz));
      const eb = h('button', 'btn', '编辑'); eb.type = 'button'; eb.id = 'edit-' + s.id; eb.setAttribute('aria-label', '编辑学员 ' + s.name);
      eb.addEventListener('click', () => {
        editingId = s.id; clearInvalid(); setMsg('msg-student', '', false);
        $('stu-name').value = s.name; fillTz($('stu-tz'), s.tz);
        $('stu-submit').textContent = '保存学员修改'; $('stu-cancel').hidden = false;
        $('stu-name').focus(); renderResult();
      });
      const b = h('button', 'btn btn-danger', '删除'); b.type = 'button'; b.setAttribute('aria-label', '删除学员 ' + s.name);
      b.addEventListener('click', () => {
        const n = C.countStudentImpact(state, s.id);
        askConfirm('删除学员「' + s.name + '」会一并删除他的 ' + n.rules + ' 节课和这些课的 ' + n.exceptions + ' 条例外,确认前数据不变。', () => {
          const idx = state.students.findIndex((x) => x.id === s.id);
          const ruleIds = new Set(state.rules.filter((r) => r.studentId === s.id).map((r) => r.id));
          state.students = state.students.filter((x) => x.id !== s.id);
          state.rules = state.rules.filter((r) => r.studentId !== s.id);
          state.exceptions = state.exceptions.filter((e) => !ruleIds.has(e.ruleId));
          if (editingId === s.id) endEdit();
          commit('已删除学员');
          focusNear('student-list', idx, 'stu-name');
        }, b);
      });
      const acts = h('span', 'confirm-actions'); acts.append(eb, b);
      li.append(m, acts); sl.appendChild(li);
    }
    const rs = $('rule-student'); const keep = rs.value; rs.textContent = '';
    for (const s of state.students) { const o = document.createElement('option'); o.value = s.id; o.textContent = s.name; rs.appendChild(o); }
    if (keep && state.students.some((s) => s.id === keep)) rs.value = keep;

    const rl = $('rule-list'); rl.textContent = '';
    for (const r of state.rules) {
      const li = h('li', 'item');
      const m = h('span', 'item-main', ruleLabel(r) + ' · ' + r.duration + ' 分钟');
      const b = h('button', 'btn btn-danger', '删除'); b.type = 'button'; b.setAttribute('aria-label', '删除课节 ' + ruleLabel(r));
      b.addEventListener('click', () => {
        const n = C.countRuleImpact(state, r.id);
        askConfirm('删除课节「' + ruleLabel(r) + '」会一并删除这节课的 ' + n.exceptions + ' 条例外,确认前数据不变。', () => {
          const idx = state.rules.findIndex((x) => x.id === r.id);
          state.rules = state.rules.filter((x) => x.id !== r.id);
          state.exceptions = state.exceptions.filter((e) => e.ruleId !== r.id);
          commit('已删除课节');
          focusNear('rule-list', idx, 'rule-start');
        }, b);
      });
      li.append(m, b); rl.appendChild(li);
    }
    const er = $('ex-rule'); const keepR = er.value; er.textContent = '';
    for (const r of state.rules) { const o = document.createElement('option'); o.value = r.id; o.textContent = ruleLabel(r); er.appendChild(o); }
    if (keepR && state.rules.some((r) => r.id === keepR)) er.value = keepR;

    const el = $('ex-list'); el.textContent = '';
    for (const e of state.exceptions) {
      const r = state.rules.find((x) => x.id === e.ruleId);
      const li = h('li', 'item');
      const desc = e.type === 'cancel' ? '取消' : '改到 ' + e.start + '(' + (e.duration || (r && r.duration)) + ' 分钟)';
      const m = h('span', 'item-main', e.date + ' · ' + (r ? ruleLabel(r) : '') + ' · ' + desc);
      const b = h('button', 'btn btn-danger', '删除'); b.type = 'button'; b.setAttribute('aria-label', '删除例外 ' + e.date);
      b.addEventListener('click', () => askConfirm('删除例外「' + e.date + ' · ' + (r ? ruleLabel(r) : '') + ' · ' + desc + '」后,这一天按每周固定课表上课,确认前数据不变。', () => {
        const idx = state.exceptions.findIndex((x) => x.id === e.id);
        state.exceptions = state.exceptions.filter((x) => x.id !== e.id);
        commit('已删除例外');
        focusNear('ex-list', idx, 'ex-date');
      }, b));
      li.append(m, b); el.appendChild(li);
    }
    const moving = $('ex-type').value === 'move';
    document.querySelectorAll('.ex-move').forEach((n) => { n.hidden = !moving; });
  }

  /* ---------- 对照表 ---------- */
  function weekStart() { const v = $('week-date').value; return C.weekStartOf(C.isValidISODate(v) ? v : today); }
  function signature() { return JSON.stringify([state, weekStart()]); }
  function computeAll(ws) {
    const mk = (w) => C.withStudentTimes(C.weekSchedule(state.rules, state.exceptions, w, state.teacherTz), state.students);
    const prev = mk(C.addDays(ws, -7)), cur = mk(ws), next = mk(C.addDays(ws, 7));
    const warnings = []
      .concat(C.switchWarnings(prev, cur).map((w) => Object.assign(w, { kind: '本周已切换', fromWeek: '上周', toWeek: '本周' })))
      .concat(C.switchWarnings(cur, next).map((w) => Object.assign(w, { kind: '下周切换', fromWeek: '本周', toWeek: '下周' })));
    const tzs = new Map();
    for (const s of state.students) { if (!tzs.has(s.tz)) tzs.set(s.tz, []); tzs.get(s.tz).push(s.name); }
    const dst = [];
    for (const [tz, names] of tzs) for (const t of C.dstTransitions(tz, today, 60)) dst.push({ tz, names, t });
    dst.sort((a, b) => a.t.date.localeCompare(b.t.date));
    return { sig: signature(), weekStart: ws, lessons: cur, warnings, dst };
  }
  function fmtOffset(m) { const sign = m < 0 ? '-' : '+'; const a = Math.abs(m); return 'UTC' + sign + String(Math.floor(a / 60)).padStart(2, '0') + ':' + String(a % 60).padStart(2, '0'); }

  function renderResult() {
    const ws = weekStart();
    $('week-range').textContent = '所选周:' + ws + '(周一)至 ' + C.addDays(ws, 6) + '(周日)。今天是 ' + today + '。';
    const box = $('result'); box.textContent = '';
    const stale = !!generated && generated.sig !== signature();
    $('stale-note').hidden = !stale;
    const fresh = !!generated && !stale && editingId === null;
    $('btn-md').disabled = !fresh;
    $('btn-ics').disabled = !fresh;
    $('export-note').textContent = editingId !== null ? '正在编辑学员:请先保存学员修改或取消编辑,再导出 Markdown 与 ICS。'
      : fresh ? 'Markdown 每位学员一段,可直接发送;ICS 只含教师时区的事件。' : '先生成对照表(且生成后不再改动),Markdown 与 ICS 才可导出。ICS 只含教师时区的事件。';
    $('base-date').textContent = baseFixed ? '基准日 ' + today + '(由地址参数固定)' : '基准日 ' + today + '(今天)';
    $('btn-demo-week').hidden = !state.students.some((x) => /^demo-/.test(x.id));
    $('sample-badge').hidden = !state.students.some((x) => /^demo-/.test(x.id));
    if (!generated) { box.appendChild(h('p', 'empty-result', state.rules.length ? '点「生成对照表」查看所选周。' : '还没有课节。')); }
    else {
      const groups = new Map();
      for (const l of generated.lessons) { if (!groups.has(l.studentId)) groups.set(l.studentId, []); groups.get(l.studentId).push(l); }
      if (!groups.size) box.appendChild(h('p', 'empty-result', '所选周没有课。'));
      for (const s of state.students) {
        const ls = groups.get(s.id); if (!ls) continue;
        const card = h('article', 'card');
        const head = h('div', 'card-head');
        head.appendChild(h('h3', '', s.name + ' · ' + s.tz));
        for (const w of generated.warnings.filter((x) => x.studentId === s.id)) {
          head.appendChild(h('span', 'tag tag-warn', '切换周(' + w.kind + '):学员本地时间从 ' + w.from + ' 变 ' + w.to));
        }
        card.appendChild(head);
        const body = h('div', 'card-body');
        for (const l of ls) {
          const row = h('div', 'lesson' + (l.status === 'cancelled' ? ' is-cancelled' : ''));
          const a = h('div'); a.appendChild(h('span', 'label', '教师本地 ' + l.teacherTz)); a.appendChild(h('span', 'time', WD[C.weekdayOf(l.date)] + ' ' + l.date.slice(5) + ' ' + l.start));
          const b = h('div'); b.appendChild(h('span', 'label', '学员本地'));
          const lab = C.dayLabel(l.local.dayOffset);
          b.appendChild(h('span', 'time', WD[C.weekdayOf(l.local.date)] + ' ' + l.local.date.slice(5) + ' ' + l.local.time + (lab ? '(' + lab + ')' : '')));
          const c = h('div', 'side'); c.appendChild(h('span', 'label', l.duration + ' 分钟'));
          if (l.status === 'cancelled') c.appendChild(h('span', 'tag tag-off', '已取消'));
          if (l.status === 'moved') c.appendChild(h('span', 'tag', '已改时间'));
          row.append(a, b, c); body.appendChild(row);
        }
        card.appendChild(body); box.appendChild(card);
      }
    }
    const dl = $('dst-list'); dl.textContent = '';
    if (!generated) dl.appendChild(h('li', 'muted', '生成对照表后显示。'));
    else if (!generated.dst.length) dl.appendChild(h('li', 'muted', '学员时区在未来 60 天内没有夏令时切换。'));
    for (const d of (generated ? generated.dst : [])) {
      const li = h('li', 'item');
      li.appendChild(h('span', 'item-main', d.t.date + ' · ' + d.tz + '(' + d.names.join('、') + '):' + fmtOffset(d.t.fromOffset) + ' 变 ' + fmtOffset(d.t.toOffset) + ',' + (d.t.deltaMin > 0 ? '拨快 ' : '拨慢 ') + Math.abs(d.t.deltaMin) + ' 分钟'));
      dl.appendChild(li);
    }
  }

  function renderAll() {
    renderSetup();
    renderResult();
    $('empty-guide').hidden = state.students.length + state.rules.length > 0;
  }

  /* ---------- 导出 ---------- */
  function download(name, mime, text) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function freshOrNull() { return generated && generated.sig === signature() ? generated : null; }

  /* ---------- 事件 ---------- */
  function bind() {
    $('teacher-tz').addEventListener('change', (e) => { state.teacherTz = e.target.value; commit('已保存'); });
    $('ex-type').addEventListener('change', renderSetup);
    $('week-date').addEventListener('change', renderResult);
    $('form-student').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const name = $('stu-name').value.trim(), tz = $('stu-tz').value;
      if (editingId !== null) {
        const res = C.updateStudent(state, editingId, { name, tz });
        if (!res.ok) return fail('msg-student', res.error, res.field === 'tz' ? 'stu-tz' : 'stu-name');
        const keepId = editingId;
        state = res.state; clearInvalid(); setMsg('msg-student', '', false); endEdit();
        commit('已保存学员修改;已有的对照结果标为过期,请重新生成');
        const eb = $('edit-' + keepId); if (eb) eb.focus();
        return;
      }
      if (!name) return fail('msg-student', '请填写姓名', 'stu-name');
      if (!C.isValidTz(tz)) return fail('msg-student', '时区不合法', 'stu-tz');
      state.students.push({ id: uid('s'), name, tz });
      $('stu-name').value = ''; clearInvalid(); setMsg('msg-student', '', false);
      commit('已添加学员');
    });
    $('form-rule').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const studentId = $('rule-student').value, start = $('rule-start').value, duration = Number($('rule-dur').value);
      if (!studentId) return fail('msg-rule', '请先添加学员', 'rule-student');
      if (!C.isValidTime(start)) return fail('msg-rule', '开始时间不合法', 'rule-start');
      if (!Number.isInteger(duration) || duration < 5 || duration > 480) return fail('msg-rule', '时长需为 5 到 480 的整数分钟', 'rule-dur');
      state.rules.push({ id: uid('r'), studentId, weekday: Number($('rule-weekday').value), start, duration });
      clearInvalid(); setMsg('msg-rule', '', false); commit('已添加课节');
    });
    $('form-ex').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const ruleId = $('ex-rule').value, date = $('ex-date').value, type = $('ex-type').value;
      const r = state.rules.find((x) => x.id === ruleId);
      if (!r) return fail('msg-ex', '请先添加课节', 'ex-rule');
      if (!C.isValidISODate(date)) return fail('msg-ex', '请选择日期', 'ex-date');
      if (C.weekdayOf(date) !== r.weekday) return fail('msg-ex', '该日期是' + WD[C.weekdayOf(date)] + ',这节课在' + WD[r.weekday], 'ex-date');
      if (state.exceptions.some((e) => e.ruleId === ruleId && e.date === date)) return fail('msg-ex', '这一天已有例外,请先删除再添加', 'ex-date');
      const ex = { id: uid('e'), ruleId, date, type };
      if (type === 'move') {
        const start = $('ex-start').value, duration = Number($('ex-dur').value);
        if (!C.isValidTime(start)) return fail('msg-ex', '新开始时间不合法', 'ex-start');
        if (!Number.isInteger(duration) || duration < 5 || duration > 480) return fail('msg-ex', '时长需为 5 到 480 的整数分钟', 'ex-dur');
        ex.start = start; ex.duration = duration;
      }
      state.exceptions.push(ex); clearInvalid(); setMsg('msg-ex', '', false); commit('已添加例外');
    });
    $('btn-generate').addEventListener('click', () => { generated = computeAll(weekStart()); renderResult(); toast('已生成对照表'); });
    const loadSample = () => {
      const apply = () => {
        const v = C.validateImport(globalThis.TZ_SAMPLE);
        state = v.data; generated = null; endEdit();
        $('week-date').value = today;
        commit('已载入示例(合成数据)');
      };
      if (hasUserData()) askConfirm('载入合成示例会替换当前 ' + dataCounts(state) + (editingId !== null || $('stu-name').value.trim() ? ',以及未提交的学员姓名草稿' : '') + ',确认前数据不变。', apply, document.activeElement); else apply();
    };
    $('btn-sample').addEventListener('click', loadSample);
    $('btn-sample-2').addEventListener('click', loadSample);
    $('btn-clear').addEventListener('click', () => askConfirm('清空会删除当前 ' + dataCounts(state) + '(以及未提交的学员姓名草稿)。此操作不能撤销,建议先导出 JSON 备份。', () => {
      state = { version: 1, teacherTz: state.teacherTz, students: [], rules: [], exceptions: [] }; generated = null; endEdit();
      commit('已清空');
    }, $('btn-clear')));
    $('stu-cancel').addEventListener('click', () => { const id = editingId; endEdit(); clearInvalid(); setMsg('msg-student', '', false); renderResult(); const eb = id && $('edit-' + id); if (eb) eb.focus(); });
    $('btn-demo-week').addEventListener('click', () => { $('week-date').value = DEMO_WEEK; renderResult(); toast('已切到 ' + DEMO_WEEK + ' 所在周,请点「生成所选周对照表」'); $('btn-generate').focus(); });
    $('btn-import').addEventListener('click', () => $('file-import').click());
    $('confirm-yes').addEventListener('click', () => { const f = pendingConfirm; closeConfirm(false); if (f) f(); });
    $('confirm-no').addEventListener('click', () => closeConfirm(true));

    $('btn-md').addEventListener('click', () => {
      const g = freshOrNull(); if (!g) return;
      download('课表对照-' + g.weekStart + '.md', 'text/markdown;charset=utf-8', C.toMarkdown(g.lessons, state.students, g.weekStart, state.teacherTz, g.warnings));
    });
    $('btn-ics').addEventListener('click', () => {
      const g = freshOrNull(); if (!g) return;
      download('课表-' + g.weekStart + '.ics', 'text/calendar;charset=utf-8', C.toIcs(g.lessons, state.teacherTz, new Date().toISOString()));
    });
    $('btn-json').addEventListener('click', () => download('课表备份.json', 'application/json', JSON.stringify(state, null, 2)));
    $('file-import').addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0]; ev.target.value = '';
      if (!f) return;
      const rd = new FileReader();
      rd.onerror = () => setMsg('msg-import', '读取文件失败', true);
      rd.onload = () => {
        const v = C.validateImport(String(rd.result));
        if (!v.ok) { setMsg('msg-import', '导入被拒绝:' + v.error, true); return; }
        setMsg('msg-import', '', false);
        const apply = () => { state = v.data; generated = null; endEdit(); commit('已导入'); };
        askConfirm('备份文件校验通过:含 ' + dataCounts(v.data) + '。确认后会替换当前 ' + dataCounts(state) + (hasUserData() && editingId !== null ? '和未保存的学员修改' : '') + ',确认前数据不变。', apply, $('btn-import'));
      };
      rd.readAsText(f);
    });
  }

  load();
  $('week-date').value = today;
  bind();
  renderAll();
})();
