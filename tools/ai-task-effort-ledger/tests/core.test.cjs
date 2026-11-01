const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../core.js');

function task(overrides = {}) {
  return Object.assign({ id:'t1', name:'测试任务', type:'HTML', date:'2026-10-29', model:'Model A', acceptance:'390px 无横向溢出', outcome:'passed', workMinutes:60, reworkMinutes:15, api:null, subscriptionUsage:null, wage:null, notes:'' }, overrides);
}
function state(tasks, synthetic=false) { return { version:1, synthetic, tasks }; }

test('接受真实闰日，拒绝不存在日期', () => {
  assert.equal(C.validDate('2024-02-29'), true);
  assert.equal(C.validDate('2026-02-29'), false);
  assert.equal(C.validateTask(task({date:'2026-02-30'})).includes('日期'), true);
});
test('拒绝重复 ID 且整份导入失败', () => {
  const r = C.validateState(state([task(), task({name:'第二项'})]));
  assert.equal(r.ok, false); assert.match(r.error, /id 重复/);
});
test('tasks 含 null 时返回校验错误而不抛异常', () => {
  assert.doesNotThrow(() => C.validateState({version:1,synthetic:false,tasks:[null]}));
  const r=C.validateState({version:1,synthetic:false,tasks:[null]}); assert.equal(r.ok,false); assert.match(r.error,/任务必须是对象/);
});
test('拒绝格式非法的 ID', () => assert.match(C.validateTask(task({id:'../bad'})), /id/));
test('未知 API 费用保持 null 并单独计数', () => {
  const r=C.validateState(state([task()])); assert.equal(r.ok,true); assert.equal(r.data.tasks[0].api,null); assert.equal(C.summarize(r.data).unknownApi,1);
});
test('已知费用和未知数量同时保留', () => {
  const x=C.summarize(state([task({api:{currency:'USD',amountCents:100}}),task({id:'t2',api:null})]));
  assert.deepEqual(x.apiByCurrency,[{currency:'USD',cents:100}]); assert.equal(x.unknownApi,1);
});
test('API 费用按币种分别汇总，零费用仍是已知', () => {
  const s=state([task({api:{currency:'USD',amountCents:125}}),task({id:'t2',api:{currency:'CNY',amountCents:0}}),task({id:'t3',api:{currency:'USD',amountCents:75}})]);
  const x=C.summarize(s); assert.deepEqual(x.apiByCurrency,[{currency:'CNY',cents:0},{currency:'USD',cents:200}]); assert.equal(x.unknownApi,0);
});
test('拒绝负数、非有限或非整数 API 金额', () => {
  [-1,Infinity,1.5].forEach(v => assert.match(C.validateTask(task({api:{currency:'USD',amountCents:v}})),/API 费用/));
});
test('拒绝非法币种和负分钟', () => {
  assert.match(C.validateTask(task({api:{currency:'usd',amountCents:1}})),/币种/);
  assert.match(C.validateTask(task({workMinutes:-1})),/分钟/);
});
test('工作与返工分开保存，总耗时相加一次', () => {
  const s=state([task({workMinutes:30,reworkMinutes:10})]); const x=C.summarize(s);
  assert.equal(x.comparisons[0].medianPassedMinutes,40);
});
test('中位数只使用通过任务并显示全部与通过样本数', () => {
  const s=state([task({workMinutes:10,reworkMinutes:0}),task({id:'t2',workMinutes:30,reworkMinutes:0}),task({id:'t3',outcome:'failed',workMinutes:999,reworkMinutes:0})]);
  const g=C.summarize(s).comparisons[0]; assert.deepEqual(g,{type:'HTML',total:3,passed:2,medianPassedMinutes:20});
});
test('百分点差只返回观察差值，不生成金额', () => {
  const u={unit:'percentage_points',unitLabel:'',before:62,after:57,windowLabel:'同一窗口',comparable:true,reset:false};
  assert.deepEqual(C.usageDelta(u),{status:'observed',delta:-5,unit:'percentage_points',unitLabel:''});
});
test('窗口重置优先标记不可比较', () => {
  const u={unit:'requests',unitLabel:'',before:2,after:100,windowLabel:'一天',comparable:true,reset:true};
  assert.deepEqual(C.usageDelta(u),{status:'reset',delta:null});
});
test('不同窗口明确标记不可比较', () => {
  const u={unit:'tokens',unitLabel:'',before:20,after:10,windowLabel:'两个窗口',comparable:false,reset:false};
  assert.deepEqual(C.usageDelta(u),{status:'incomparable',delta:null});
});
test('拒绝缺窗口、未知单位和非有限额度值', () => {
  const base={unit:'tokens',unitLabel:'',before:20,after:10,windowLabel:'本周',comparable:true,reset:false};
  assert.match(C.validateTask(task({subscriptionUsage:{...base,windowLabel:''}})),/额度窗口/);
  assert.match(C.validateTask(task({subscriptionUsage:{...base,unit:'dollars'}})),/单位/);
  assert.match(C.validateTask(task({subscriptionUsage:{...base,after:NaN}})),/前后值/);
});
test('人工成本只用明确时薪并按币种分开', () => {
  const s=state([task({workMinutes:60,reworkMinutes:30,wage:{currency:'CNY',centsPerHour:20000}}),task({id:'t2',wage:null})]);
  const x=C.summarize(s); assert.deepEqual(x.humanByCurrency,[{currency:'CNY',cents:30000}]); assert.equal(x.unknownWage,1);
});
test('严格导入拒绝不支持版本与非布尔示例标记', () => {
  assert.equal(C.validateImport('{"version":2,"synthetic":false,"tasks":[]}').ok,false);
  assert.equal(C.validateState({version:1,synthetic:'false',tasks:[]}).ok,false);
});
test('导入会清理文本但不修改原对象', () => {
  const original=state([task({name:'  名称  '})]); const r=C.validateState(original);
  assert.equal(r.data.tasks[0].name,'名称'); assert.equal(original.tasks[0].name,'  名称  ');
});
test('混合示例与本人记录逐条保留身份', () => {
  const r=C.validateState({version:1,synthetic:false,tasks:[task({synthetic:true}),task({id:'t2',synthetic:false})]});
  assert.equal(r.ok,true); assert.equal(r.data.synthetic,true); assert.deepEqual(r.data.tasks.map(t=>t.synthetic),[true,false]);
  const s=C.summarize(r.data); assert.equal(s.realTasks,1); assert.equal(s.syntheticTasks,1); assert.equal(s.passed,1);
});
test('CSV 防公式注入', () => {
  const csv=C.exportCsv(state([task({name:'=2+2',notes:'\t@cmd'})])); assert.match(csv,/"'=2\+2"/); assert.match(csv,/"'\t@cmd"/);
  const csv2=C.exportCsv(state([task({name:'\r\n+SUM(A1:A2)'})])); assert.match(csv2,/"'\r\n\+SUM/);
});
test('Markdown 明示三种口径不互换和非因果结论', () => {
  const md=C.exportMarkdown(state([task()])); assert.match(md,/不互相换算/); assert.match(md,/不证明 AI 造成了节省/); assert.match(md,/API 费用：未知/);
});
test('金额只接受最多两位小数和有限上限', () => {
  assert.equal(C.parseMoney('12.34'),1234); assert.equal(C.parseMoney('1.234'),null); assert.equal(C.parseMoney('-1'),null); assert.equal(C.parseMoney('Infinity'),null);
});
