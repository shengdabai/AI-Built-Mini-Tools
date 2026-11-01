(function () {
  'use strict';
  var C = globalThis.TaskEffortCore, KEY = 'taskEffortLedger.v1', RECOVERY_PREFIX = 'taskEffortLedger.corruptBackup.v1.';
  var state = C.emptyState(), editingId = null, pendingImport = null, pendingAction = null, dirty = false, corruptRaw = null;
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function today() {
    var q = new URLSearchParams(location.search).get('today');
    if (q && C.validDate(q)) { $('today-banner').textContent = '基准日 ' + q + '（由地址参数固定）'; $('today-banner').hidden = false; return q; }
    return new Date().toISOString().slice(0,10);
  }
  function load() {
    try { var raw = localStorage.getItem(KEY); if (!raw) return; var v = C.validateImport(raw); if (!v.ok) { corruptRaw=raw; throw new Error(v.error); } state = v.data; }
    catch (e) { warnStorage('浏览器中的已保存数据无法读取：' + e.message + '。当前内存数据仍可导出。'); }
  }
  function syncSynthetic() { state.synthetic = state.tasks.some(function (t) { return t.synthetic === true; }); }
  function save() {
    syncSynthetic();
    try {
      if (corruptRaw !== null) localStorage.setItem(RECOVERY_PREFIX + Date.now(), corruptRaw);
      localStorage.setItem(KEY, JSON.stringify(state));
      corruptRaw=null; $('storage-warning').hidden = true; return true;
    }
    catch (e) { warnStorage('保存失败：' + e.message + '。请立即导出 JSON 备份；当前内存中的有效数据仍会完整导出。'); return false; }
  }
  function warnStorage(msg) { $('storage-warning-text').textContent = msg; $('export-corrupt').hidden = corruptRaw === null; $('storage-warning').hidden = false; }
  function flash(msg) { $('status').textContent = msg; $('status').hidden = false; setTimeout(function(){ $('status').hidden = true; }, 3500); }
  function setDirty(v) { dirty = v; $('dirty-note').hidden = !v; }
  function money(cents) { return (cents / 100).toFixed(2); }
  function unitName(u) { return {percentage_points:'百分点',tokens:'token',requests:'请求数',credits:'额度点数',minutes:'分钟',other:u.unitLabel}[u.unit] || u.unit; }
  function outcomeName(x) { return {pending:'待验收',passed:'通过',failed:'未通过'}[x]; }
  function requiredNumber(id) { var v=$(id).value.trim(); return v === '' ? NaN : Number(v); }
  function blockIfDirty() { if (!dirty) return false; showError('表单有未保存内容。请先保存或重置表单。'); return true; }
  function showError(msg) { $('form-error').textContent = msg; $('form-error').hidden = false; $('form-error').focus(); }
  function hideError() { $('form-error').hidden = true; }
  function ask(text, action) { pendingAction = action; $('confirm-text').textContent = text; $('confirm-panel').hidden = false; $('confirm-yes').focus(); }
  function closeAsk() { pendingAction = null; $('confirm-panel').hidden = true; }
  function download(name, content, type) { var a=document.createElement('a'), url=URL.createObjectURL(new Blob([content],{type:type})); a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},0); }
  function render() {
    var s = C.summarize(state), filter = $('filter').value;
    $('stat-tasks').textContent = s.realTasks+' / '+s.tasks; $('stat-passed').textContent = s.passed; $('stat-unknown').textContent = s.unknownApi;
    $('stat-minutes').textContent = state.tasks.filter(function(t){return !t.synthetic;}).reduce(function(n,t){return n+t.workMinutes+t.reworkMinutes;},0);
    $('sample-banner').hidden = !state.synthetic;
    var list = $('task-list'); list.replaceChildren();
    var shown = state.tasks.filter(function(t){ return filter === 'all' || t.outcome === filter; });
    if (!shown.length) list.appendChild(el('p','empty',state.tasks.length ? '当前筛选没有记录。' : '还没有任务。新增第一项，或载入合成示例查看流程。'));
    shown.slice().sort(function(a,b){return b.date.localeCompare(a.date);}).forEach(function(t){ list.appendChild(taskCard(t)); });
    renderSummary(s);
  }
  function taskCard(t) {
    var a=el('article','task'), h=el('header'), title=el('div'); title.append(el('h3','',t.name),el('span','hint',t.date+' · '+t.type+' · '+outcomeName(t.outcome))); h.appendChild(title);
    var btns=el('div','actions'), edit=el('button','', '编辑'), del=el('button','danger','删除'); edit.type=del.type='button';
    edit.addEventListener('click',function(){fillForm(t);}); del.addEventListener('click',function(){ ask('删除“'+t.name+'”？该任务的时间、费用和额度观察会一并删除。',function(){state.tasks=state.tasks.filter(function(x){return x.id!==t.id;});state.synthetic=false;save();render();flash('已删除任务。');});}); btns.append(edit,del);h.appendChild(btns);a.appendChild(h);
    var dl=el('dl'); [['身份',t.synthetic?'合成示例':'本人记录'],['模型',t.model],['工作 / 返工',t.workMinutes+' / '+t.reworkMinutes+' 分钟'],['API 费用',t.api?t.api.currency+' '+money(t.api.amountCents):'未知（未计为 0）']].forEach(function(x){dl.append(el('div','', ''),);var d=dl.lastChild;d.append(el('dt','',x[0]),el('dd','',x[1]));});
    a.append(dl,el('p','acceptance','验收条件：'+t.acceptance));
    if(t.subscriptionUsage){var u=C.usageDelta(t.subscriptionUsage), value=u.status==='observed'?String(u.delta)+' '+unitName(t.subscriptionUsage):(u.status==='reset'?'窗口已重置，不比较':'窗口不可比，不比较');a.appendChild(el('p','hint','订阅额度：'+value+'；窗口：'+t.subscriptionUsage.windowLabel+'。此数值不换算成金额。'));}
    if(t.notes)a.appendChild(el('p','hint','备注：'+t.notes));return a;
  }
  function renderSummary(s) {
    var root=$('summary');root.replaceChildren();var grid=el('div','summary-grid'), cost=el('article','summary-card'), comp=el('article','summary-card');cost.appendChild(el('h3','','费用汇总（按币种分开）'));
    if(!s.apiByCurrency.length)cost.appendChild(el('p','hint','没有已知 API 费用；未知项保持未知。'));
    s.apiByCurrency.forEach(function(x){cost.appendChild(el('p','', 'API '+x.currency+' '+money(x.cents)));});
    s.humanByCurrency.forEach(function(x){cost.appendChild(el('p','', '人工估算 '+x.currency+' '+money(x.cents)));});
    cost.appendChild(el('p','hint','以下只统计 '+s.realTasks+' 条本人记录；另有 '+s.syntheticTasks+' 条合成示例不进入指标。API 费用未知 '+s.unknownApi+' 项；人工时薪未知 '+s.unknownWage+' 项。已知金额按币种分别显示，不把未知补成 0。'));
    comp.appendChild(el('h3','','同类任务通过样本')); if(!s.comparisons.length)comp.appendChild(el('p','hint','还没有可比较记录。'));
    s.comparisons.forEach(function(g){comp.appendChild(el('p','',g.type+'：全部 '+g.total+' 项，通过 '+g.passed+' 项；通过样本总耗时中位数 '+(g.medianPassedMinutes===null?'无法计算':g.medianPassedMinutes+' 分钟')));});
    grid.append(cost,comp);root.appendChild(grid);
  }
  function formValue() {
    var id=editingId || ('task_'+Date.now().toString(36)), api=null, usage=null, wage=null;
    if($('api-known').checked){var ac=C.parseMoney($('api-amount').value);api={amountCents:ac,currency:$('api-currency').value.trim().toUpperCase()};}
    if($('usage-known').checked) usage={unit:$('usage-unit').value,unitLabel:$('unit-label').value, before:requiredNumber('usage-before'),after:requiredNumber('usage-after'),windowLabel:$('window-label').value,comparable:$('usage-comparable').checked,reset:$('usage-reset').checked};
    if($('wage-known').checked) wage={centsPerHour:C.parseMoney($('wage-amount').value),currency:$('wage-currency').value.trim().toUpperCase()};
    var existing=editingId ? state.tasks.find(function(t){return t.id===editingId;}) : null;
    return {id:id,synthetic:existing ? existing.synthetic===true : false,name:$('name').value,type:$('type').value,date:$('date').value,model:$('model').value,acceptance:$('acceptance').value,outcome:$('outcome').value,workMinutes:requiredNumber('work-minutes'),reworkMinutes:requiredNumber('rework-minutes'),api:api,subscriptionUsage:usage,wage:wage,notes:$('notes').value};
  }
  function recoveryState() {
    var copy=JSON.parse(JSON.stringify(state));
    if (dirty) {
      var draft=formValue(), err=C.validateTask(draft);
      if (!err) { var i=copy.tasks.findIndex(function (t) { return t.id===draft.id; }); if(i>=0)copy.tasks[i]=draft; else copy.tasks.push(draft); }
    }
    copy.synthetic=copy.tasks.some(function(t){return t.synthetic===true;});
    var checked=C.validateState(copy); return checked.ok ? checked.data : state;
  }
  function resetForm() { editingId=null;$('task-form').reset();$('date').value=today();$('work-minutes').value='0';$('rework-minutes').value='0';$('api-currency').value='USD';$('wage-currency').value='CNY';$('usage-comparable').checked=true;toggleFields();$('form-title').textContent='新增任务';$('save-task').textContent='保存任务';$('cancel-edit').hidden=true;hideError();setDirty(false); }
  function fillForm(t){editingId=t.id;$('name').value=t.name;$('type').value=t.type;$('date').value=t.date;$('model').value=t.model;$('acceptance').value=t.acceptance;$('outcome').value=t.outcome;$('work-minutes').value=t.workMinutes;$('rework-minutes').value=t.reworkMinutes;$('api-known').checked=!!t.api;if(t.api){$('api-amount').value=money(t.api.amountCents);$('api-currency').value=t.api.currency;}$('usage-known').checked=!!t.subscriptionUsage;if(t.subscriptionUsage){$('usage-unit').value=t.subscriptionUsage.unit;$('unit-label').value=t.subscriptionUsage.unitLabel;$('usage-before').value=t.subscriptionUsage.before;$('usage-after').value=t.subscriptionUsage.after;$('window-label').value=t.subscriptionUsage.windowLabel;$('usage-comparable').checked=t.subscriptionUsage.comparable;$('usage-reset').checked=t.subscriptionUsage.reset;}$('wage-known').checked=!!t.wage;if(t.wage){$('wage-amount').value=money(t.wage.centsPerHour);$('wage-currency').value=t.wage.currency;}$('notes').value=t.notes;toggleFields();$('form-title').textContent='编辑任务';$('save-task').textContent='保存修改';$('cancel-edit').hidden=false;setDirty(false);$('form-title').scrollIntoView({behavior:'smooth'});}
  function toggleFields(){$('api-fields').hidden=!$('api-known').checked;$('usage-fields').hidden=!$('usage-known').checked;$('wage-fields').hidden=!$('wage-known').checked;$('unit-label-wrap').hidden=$('usage-unit').value!=='other';}
  $('task-form').addEventListener('submit',function(e){e.preventDefault();var t=formValue(),err=C.validateTask(t);if(err){showError(err);return;}var i=state.tasks.findIndex(function(x){return x.id===t.id;});if(i>=0)state.tasks[i]=t;else state.tasks.push(t);var persisted=save();resetForm();render();flash(persisted?'任务已保存到浏览器。':'任务仅保留在当前页面内存，请立即导出恢复 JSON。');});
  $('task-form').addEventListener('input',function(){setDirty(true);toggleFields();});
  $('reset-form').addEventListener('click',resetForm);$('cancel-edit').addEventListener('click',resetForm);$('filter').addEventListener('change',render);
  $('confirm-yes').addEventListener('click',function(){var f=pendingAction;closeAsk();if(f)f();});$('confirm-no').addEventListener('click',closeAsk);
  $('load-sample').addEventListener('click',function(){if(blockIfDirty())return;ask('载入 3 条合成示例会替换当前 '+state.tasks.length+' 条任务。',function(){var v=C.validateState(globalThis.TaskEffortSample);state=v.data;save();render();flash('已载入合成示例。');});});
  $('clear-all').addEventListener('click',function(){if(blockIfDirty())return;ask('清空全部 '+state.tasks.length+' 条任务？请先导出 JSON 备份。',function(){state=C.emptyState();save();render();flash('已清空全部任务。');});});
  $('export-json').addEventListener('click',function(){if(blockIfDirty())return;download('ai-task-effort-ledger.json',JSON.stringify(state,null,2),'application/json');});
  $('export-csv').addEventListener('click',function(){if(blockIfDirty())return;download('ai-task-effort-ledger.csv',C.exportCsv(state),'text/csv');});
  $('export-md').addEventListener('click',function(){if(blockIfDirty())return;download('ai-task-effort-report.md',C.exportMarkdown(state),'text/markdown');});
  $('export-corrupt').addEventListener('click',function(){if(corruptRaw!==null)download('ai-task-effort-ledger-corrupt-raw.txt',corruptRaw,'text/plain');});
  $('export-recovery').addEventListener('click',function(){download('ai-task-effort-ledger-recovery.json',JSON.stringify(recoveryState(),null,2),'application/json');});
  $('pick-import').addEventListener('click',function(){if(blockIfDirty())return;$('import-file').click();});
  $('import-file').addEventListener('change',function(){var file=this.files[0];this.value='';if(!file)return;var r=new FileReader();r.onload=function(){var v=C.validateImport(String(r.result));if(!v.ok){flash('导入失败：'+v.error);return;}pendingImport=v.data;$('import-preview').textContent='备份包含 '+v.data.tasks.length+' 条任务，'+(v.data.synthetic?'其中含合成示例':'全部为本人记录')+'。确认后会替换当前 '+state.tasks.length+' 条任务。';$('import-panel').hidden=false;$('import-confirm').focus();};r.readAsText(file);});
  $('import-confirm').addEventListener('click',function(){if(!pendingImport)return;state=pendingImport;pendingImport=null;$('import-panel').hidden=true;save();resetForm();render();flash('导入完成。');});$('import-cancel').addEventListener('click',function(){pendingImport=null;$('import-panel').hidden=true;});
  load();today();resetForm();render();
})();
