'use strict';
(function () {
  const C = globalThis.RecipeCore;
  const KEY = 'recipescaler.v1';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  const state = { recipes: [], currentId: null, opts: { autoUnit: true, format: 'decimal' } };
  const ui = { yieldError: '', mode: 'servings', servings: '', ingName: '', amount: '', unit: '', search: '' };
  let toastTimer = null;

  // ---------- 存储 ----------
  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { return; }
    if (!raw) return;
    let data = null;
    try { data = JSON.parse(raw); } catch (e) { data = null; }
    const v = data ? C.validateImport({ app: 'recipe-scaler', version: 1, recipes: data.recipes }, { draft: true }) : { ok: false };
    if (!v.ok) { toast('本机存档格式不正确,已忽略。'); return; }
    state.recipes = v.value.recipes;
    state.currentId = state.recipes.some(r => r.id === data.currentId) ? data.currentId : (state.recipes[0] ? state.recipes[0].id : null);
    if (data.opts && typeof data.opts === 'object') {
      state.opts.autoUnit = data.opts.autoUnit !== false;
      state.opts.format = data.opts.format === 'fraction' ? 'fraction' : 'decimal';
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ recipes: state.recipes, currentId: state.currentId, opts: state.opts }));
      $('save-warning').hidden = true;
      return true;
    } catch (e) {
      $('save-warning').hidden = false;
      return false;
    }
  }
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
  }
  function saved(msg) { if (save()) toast(msg); }

  const current = () => state.recipes.find(r => r.id === state.currentId) || null;

  // ---------- 配方库 ----------
  function renderList() {
    const q = ui.search.trim().toLowerCase();
    const list = state.recipes.filter(r => !q || r.name.toLowerCase().includes(q) || r.ingredients.some(i => i.name.toLowerCase().includes(q)));
    const ul = $('recipe-list');
    const focusedId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : null;
    if (!list.length) {
      ul.innerHTML = '<li class="list-empty">' + (state.recipes.length ? '没有匹配的配方。' : '还没有配方。') + '</li>';
      return;
    }
    ul.innerHTML = list.map(r => '<li><button type="button" class="recipe-item" data-id="' + esc(r.id) + '" aria-current="' + (r.id === state.currentId) + '">' +
      '<span class="name">' + esc(r.name || '未命名配方') + '</span><span class="muted">' + r.ingredients.length + ' 种配料 · 产量 ' + esc(r.yieldAmount) + ' ' + esc(r.yieldUnit) + '</span></button></li>').join('');
    if (focusedId) {
      const again = ul.querySelector('[data-id="' + (window.CSS && CSS.escape ? CSS.escape(focusedId) : focusedId) + '"]') || ul.querySelector('[data-id]');
      if (again) again.focus();
    }
  }

  // ---------- 编辑区 ----------
  function fillSelect(sel, options, value) {
    sel.innerHTML = options.map(o => '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>').join('');
    sel.value = value;
    if (sel.value !== value) sel.selectedIndex = 0;
  }
  function renderBaseSelect(r) {
    const names = Array.from(new Set(r.ingredients.map(i => i.name)));
    if (r.baseName && !names.includes(r.baseName)) r.baseName = '';
    fillSelect($('r-base'), [{ value: '', label: '(不使用烘焙百分比)' }].concat(names.map(n => ({ value: n, label: n }))), r.baseName);
  }
  function renderEditor() {
    const r = current();
    $('empty').hidden = !!r;
    $('workspace').hidden = !r;
    if (!r) return;
    $('r-name').value = r.name;
    $('r-yield').value = r.yieldAmount;
    fillSelect($('r-yield-unit'), C.YIELD_UNITS.map(u => ({ value: u, label: u })), r.yieldUnit);
    $('r-lines').value = C.ingredientsToText(r.ingredients);
    $('r-notes').value = r.notes || '';
    $('opt-auto').checked = state.opts.autoUnit;
    $('opt-format').value = state.opts.format;
    renderBaseSelect(r);
    renderWarnings();
    ui.yieldError = '';
    ui.servings = String(r.yieldAmount); ui.ingName = ''; ui.amount = '';
    $('target-servings').value = ui.servings;
    $('target-amount').value = '';
    renderIngredientPicker();
  }
  function renderWarnings() {
    const w = C.parseIngredients($('r-lines').value).warnings;
    $('parse-warnings').innerHTML = w.map(x => '<li>第 ' + x.line + ' 行:' + esc(x.reason) + '</li>').join('');
  }

  // ---------- 缩放 ----------
  function numericIngredients(r) {
    return r.ingredients.filter(i => C.parseQuantity(i.qtyText).kind === 'number');
  }
  function unitChoices(unit) {
    if (['g', 'kg', 'mg'].includes(unit)) return ['g', 'kg', 'mg'];
    if (['mL', 'L'].includes(unit)) return ['mL', 'L'];
    return [unit];
  }
  function renderIngredientPicker() {
    const r = current();
    if (!r) return;
    const nums = numericIngredients(r);
    const names = Array.from(new Set(nums.map(i => i.name)));
    if (!names.includes(ui.ingName)) ui.ingName = names[0] || '';
    fillSelect($('target-ingredient'), names.length ? names.map(n => ({ value: n, label: n })) : [{ value: '', label: '(没有可用的数值配料)' }], ui.ingName);
    renderUnitPicker();
  }
  function renderUnitPicker() {
    const r = current();
    const ing = r && r.ingredients.find(i => i.name === ui.ingName && C.parseQuantity(i.qtyText).kind === 'number');
    const base = ing ? C.normalizeUnit(ing.unit) || '' : '';
    const choices = unitChoices(base);
    if (!choices.includes(ui.unit)) ui.unit = base;
    fillSelect($('target-unit'), choices.map(u => ({ value: u, label: u || '(无单位)' })), ui.unit);
  }

  function computeScaled() {
    const r = current();
    if (!r) return { ok: false, reason: '' };
    if (ui.yieldError) return { ok: false, reason: ui.yieldError };
    let f;
    if (ui.mode === 'servings') f = C.factorFromServings(r.yieldAmount, ui.servings);
    else f = C.factorFromIngredient(r, ui.ingName, ui.amount, ui.unit);
    if (!f.ok) return f;
    return C.scale(r, f, state.opts);
  }

  function renderResult() {
    const r = current();
    if (!r) return;
    $('by-servings').hidden = ui.mode !== 'servings';
    $('by-ingredient').hidden = ui.mode !== 'ingredient';
    $('yield-error').textContent = ui.yieldError ? '原始产量有误:' + ui.yieldError + ' 修正前不会计算结果和导出。' : '';
    $('yield-error').hidden = !ui.yieldError;
    $('servings-hint').textContent = '原始产量 ' + r.yieldAmount + ' ' + r.yieldUnit;
    const s = computeScaled();
    const err = $('scale-error');
    const body = $('result-body');
    if (!s.ok) {
      $('factor-out').textContent = '—';
      err.textContent = s.reason ? '无法计算:' + s.reason : '';
      err.hidden = !s.reason;
      $('result-yield').textContent = '';
      body.innerHTML = '';
      $('md-preview').textContent = '';
      $('export-md').disabled = true; $('export-csv').disabled = true;
      $('export-hint').textContent = '倍数还没有算出来,导出按钮已停用。请先修正上面的数值。';
      renderBakers();
      return;
    }
    err.hidden = true;
    $('factor-out').textContent = '×' + s.factor.text;
    $('result-yield').textContent = '产量:' + s.yieldOrig + ' → ' + s.yieldText;
    body.innerHTML = s.items.length ? s.items.map(i => '<tr>' +
      '<td class="name-cell">' + esc(i.name) + '</td>' +
      '<td data-label="原量">' + esc(i.origText || '—') + '</td>' +
      '<td data-label="缩放后" class="num">' + (i.scaled ? esc(i.qtyText) + (i.unit ? ' <span class="unit">' + esc(i.unit) + '</span>' : '') : '<span class="tag">不缩放</span> ' + esc(i.text)) + '</td>' +
      '<td data-label="计数取整">' + (i.roundedText ? esc(i.roundedText) : '—') + '</td>' +
      '<td data-label="备注">' + esc(i.note || '') + '</td></tr>').join('')
      : '<tr><td colspan="5">这份配方还没有配料。</td></tr>';
    $('md-preview').textContent = C.toMarkdown(s);
    $('export-md').disabled = false; $('export-csv').disabled = false;
    $('export-hint').textContent = '导出内容与上面的缩放结果一致(倍数 ×' + s.factor.text + ')。';
    renderBakers();
  }

  function renderBakers() {
    const r = current();
    const box = $('bp-box');
    if (!r) return;
    if (!r.baseName) { box.innerHTML = '<p class="muted">在「配方」里选一个基准配料(通常是面粉),这里会显示每种配料相对它的百分比。</p>'; return; }
    const b = C.bakersPercent(r, r.baseName);
    if (!b.ok) { box.innerHTML = '<p class="error">' + esc(b.reason) + '</p>'; return; }
    box.innerHTML = '<p>基准:<strong>' + esc(b.base.name) + '</strong> = ' + esc(C.formatRat(C.parseQuantity(String(Number(b.base.grams.toFixed(4)))).r)) + ' g(100%)</p>' +
      '<div class="table-wrap"><table><thead><tr><th scope="col">配料</th><th scope="col">相对基准</th><th scope="col">说明</th></tr></thead><tbody>' +
      b.rows.map(x => '<tr><td class="name-cell">' + esc(x.name) + '</td><td data-label="相对基准" class="pct">' + esc(x.text) + '</td><td data-label="说明">' + esc(x.reason) + '</td></tr>').join('') +
      '</tbody></table></div>';
  }

  function renderAll() { renderList(); renderEditor(); renderResult(); }

  // ---------- 下载 ----------
  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const safeName = s => (String(s || '配方').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || '配方');

  // ---------- 事件 ----------
  function touch() { const ok = save(); renderList(); return ok; }
  function bind() {
    function doLoadSample() {
      globalThis.RECIPE_SAMPLES.forEach(s => {
        const rec = { id: s.id, name: s.name, yieldAmount: s.yieldAmount, yieldUnit: s.yieldUnit, baseName: s.baseName, notes: s.notes, ingredients: C.parseIngredients(s.ingredientsText).items };
        const i = state.recipes.findIndex(r => r.id === rec.id);
        if (i >= 0) state.recipes[i] = rec; else state.recipes.push(rec);
      });
      state.currentId = globalThis.RECIPE_SAMPLES[0].id;
      const ok = save(); renderAll(); if (ok) toast('已载入 3 份合成示例。');
    }
    $('load-sample').onclick = () => {
      const clash = globalThis.RECIPE_SAMPLES.filter(s => state.recipes.some(r => r.id === s.id));
      if (clash.length) { $('sample-confirm').hidden = false; return; }
      doLoadSample();
    };
    $('sample-yes').onclick = () => { $('sample-confirm').hidden = true; doLoadSample(); };
    $('sample-no').onclick = () => { $('sample-confirm').hidden = true; };
    $('new-recipe').onclick = () => {
      const r = C.emptyRecipe(); r.name = '新配方';
      state.recipes.unshift(r); state.currentId = r.id;
      const ok = save(); renderAll(); $('r-name').focus(); $('r-name').select(); if (ok) toast('已新建配方。');
    };
    $('search').oninput = e => { ui.search = e.target.value; renderList(); };
    $('recipe-list').onclick = e => {
      const b = e.target.closest('[data-id]'); if (!b) return;
      state.currentId = b.dataset.id; ui.mode = 'servings'; $('mode-servings').checked = true; save(); renderAll();
    };

    $('r-name').oninput = e => { const r = current(); r.name = e.target.value; touch(); renderResult(); };
    $('r-yield').oninput = e => {
      const r = current(); const y = C.parseYield(e.target.value);
      ui.yieldError = y.ok ? '' : y.reason;
      if (y.ok) { r.yieldAmount = y.value; ui.servings = String(y.value); $('target-servings').value = ui.servings; touch(); }
      renderResult();
    };
    $('r-yield-unit').onchange = e => { current().yieldUnit = e.target.value; touch(); renderResult(); };
    $('r-lines').oninput = e => {
      const r = current(); r.ingredients = C.parseIngredients(e.target.value).items;
      renderBaseSelect(r); renderWarnings(); renderIngredientPicker(); touch(); renderResult();
    };
    $('r-base').onchange = e => { current().baseName = e.target.value; touch(); renderBakers(); };
    $('r-notes').oninput = e => { current().notes = e.target.value; touch(); renderResult(); };

    document.querySelectorAll('input[name="mode"]').forEach(el => { el.onchange = () => { ui.mode = el.value; renderResult(); }; });
    $('target-servings').oninput = e => { ui.servings = e.target.value; renderResult(); };
    $('target-ingredient').onchange = e => { ui.ingName = e.target.value; ui.unit = ''; renderUnitPicker(); renderResult(); };
    $('target-amount').oninput = e => { ui.amount = e.target.value; renderResult(); };
    $('target-unit').onchange = e => { ui.unit = e.target.value; renderResult(); };
    $('opt-auto').onchange = e => { state.opts.autoUnit = e.target.checked; save(); renderResult(); };
    $('opt-format').onchange = e => { state.opts.format = e.target.value; save(); renderResult(); };

    $('delete-recipe').onclick = () => {
      const r = current();
      $('delete-title').textContent = '确认删除配方「' + (r.name || '未命名配方') + '」?';
      $('delete-detail').textContent = '会一并删除它的 ' + r.ingredients.length + ' 种配料、备注和基准配料设置,无法恢复。建议先导出全部配方 JSON 备份。';
      $('delete-confirm').hidden = false; $('delete-no').focus();
    };
    $('delete-no').onclick = () => { $('delete-confirm').hidden = true; };
    $('delete-yes').onclick = () => {
      state.recipes = state.recipes.filter(r => r.id !== state.currentId);
      state.currentId = state.recipes[0] ? state.recipes[0].id : null;
      $('delete-confirm').hidden = true;
      const ok = save(); renderAll(); if (ok) toast('配方已删除。');
    };

    $('pct-make').onclick = () => {
      const err = $('pct-error'); err.hidden = true;
      const p = C.parsePercentLines($('pct-lines').value);
      const base = C.parseQuantity($('pct-base').value);
      const problems = p.errors.slice();
      if (base.kind !== 'number') problems.push('基准重量要填一个数字(单位 g)');
      const res = problems.length ? { ok: false, errors: problems } : C.fromPercent(p.items, base.value);
      if (!res.ok) {
        err.textContent = '无法生成:' + res.errors.join(';'); err.hidden = false;
        (base.kind !== 'number' && !p.errors.length ? $('pct-base') : $('pct-lines')).focus();
        return;
      }
      const r = C.emptyRecipe();
      r.name = $('pct-name').value.trim() || '按百分比生成的配方';
      r.baseName = res.baseName; r.ingredients = res.items;
      state.recipes.unshift(r); state.currentId = r.id;
      const ok = save(); renderAll(); if (ok) toast('已按百分比生成新配方。');
    };

    const exportName = ext => safeName(current().name) + '-缩放.' + ext;
    $('export-md').onclick = () => { const s = computeScaled(); if (!s.ok) return; download(exportName('md'), C.toMarkdown(s), 'text/markdown;charset=utf-8'); };
    $('export-csv').onclick = () => { const s = computeScaled(); if (!s.ok) return; download(exportName('csv'), '\uFEFF' + C.toCsv(s), 'text/csv;charset=utf-8'); };
    $('export-json').onclick = () => download('配方备份.json', JSON.stringify(C.makeBackup(state.recipes), null, 2), 'application/json');

    $('import-btn').onclick = () => $('import-file').click();
    let pendingImport = null;
    $('import-file').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const box = $('import-error'); box.hidden = true; $('import-confirm').hidden = true; pendingImport = null;
      const rd = new FileReader();
      rd.onload = () => {
        const v = C.validateImport(String(rd.result));
        if (!v.ok) {
          box.innerHTML = '<strong>导入被拒绝,没有任何数据被改动:</strong><ul>' + v.errors.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
          box.hidden = false; e.target.value = ''; $('import-btn').focus(); return;
        }
        const plan = C.importPlan(state.recipes, v.value.recipes);
        pendingImport = v.value.recipes;
        $('import-confirm-title').textContent = '将导入 ' + pendingImport.length + ' 份配方:新增 ' + plan.added.length + ' 份,覆盖 ' + plan.replaced.length + ' 份同 ID 配方。确认前现有配方不变。';
        const ul = $('import-confirm-list'); ul.innerHTML = '';
        plan.replaced.slice(0, 20).forEach(x => { const li = document.createElement('li'); li.textContent = '覆盖:' + (x.oldName || '未命名配方') + ' → ' + (x.newName || '未命名配方'); ul.appendChild(li); });
        plan.added.slice(0, 20).forEach(x => { const li = document.createElement('li'); li.textContent = '新增:' + (x.name || '未命名配方'); ul.appendChild(li); });
        if (plan.replaced.length > 20 || plan.added.length > 20) { const li = document.createElement('li'); li.textContent = '只列出前 20 条,其余同样会导入。'; ul.appendChild(li); }
        $('import-confirm').hidden = false; $('import-yes').focus();
      };
      rd.onerror = () => { box.textContent = '读取文件失败。'; box.hidden = false; };
      rd.readAsText(f);
    };
    $('import-no').onclick = () => { pendingImport = null; $('import-confirm').hidden = true; $('import-file').value = ''; $('import-btn').focus(); };
    $('import-yes').onclick = () => {
      if (!pendingImport) return;
      let added = 0, replaced = 0;
      pendingImport.forEach(r => {
        const i = state.recipes.findIndex(x => x.id === r.id);
        if (i >= 0) { state.recipes[i] = r; replaced++; } else { state.recipes.push(r); added++; }
      });
      pendingImport = null; $('import-confirm').hidden = true; $('import-file').value = '';
      if (!state.currentId && state.recipes[0]) state.currentId = state.recipes[0].id;
      const ok = save(); renderAll();
      if (ok) toast('导入完成:新增 ' + added + ' 份,覆盖 ' + replaced + ' 份。');
      $('import-btn').focus();
    };

    $('clear-data').onclick = () => {
      $('clear-detail').textContent = '本机保存的 ' + state.recipes.length + ' 份配方会被全部删除,无法恢复。建议先导出全部配方 JSON 备份。';
      $('clear-confirm').hidden = false; $('clear-no').focus();
    };
    $('clear-no').onclick = () => { $('clear-confirm').hidden = true; };
    $('clear-yes').onclick = () => {
      state.recipes = []; state.currentId = null; $('clear-confirm').hidden = true;
      const ok = save(); renderAll(); if (ok) toast('本机数据已清空。');
    };
  }

  load();
  bind();
  renderAll();
})();
