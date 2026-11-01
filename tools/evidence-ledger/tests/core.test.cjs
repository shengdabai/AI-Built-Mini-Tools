const test = require('node:test');
const assert = require('node:assert');
const core = require('../core.js');

const ev = (type, stance, strength, extra = {}) => ({ id: core.newId('e'), type, stance, strength, title: 't', url: 'https://example.com/x', excerpt: '', date: '', limit: '', ...extra });
const claim = (evidence = [], text = '主张') => ({ id: core.newId('c'), text, note: '', evidence });

test('无证据 → 待验证', () => {
  assert.strictEqual(core.status(claim([])), '待验证');
});
test('任一强反对压过强支持 → 已反驳', () => {
  const c = claim([ev('official', 'support', 'strong'), ev('primary', 'oppose', 'strong')]);
  assert.strictEqual(core.status(c), '已反驳');
});
test('只有二手弱支持 → 已支持（非 AI 即可）', () => {
  assert.strictEqual(core.status(claim([ev('secondary', 'support', 'weak')])), '已支持');
});
test('只有 AI 生成的支持 → 不确定', () => {
  assert.strictEqual(core.status(claim([ev('ai', 'support', 'strong')])), '不确定');
});
test('只有弱/中反对 → 不确定', () => {
  assert.strictEqual(core.status(claim([ev('official', 'oppose', 'weak'), ev('primary', 'oppose', 'medium')])), '不确定');
});
test('只有不相关证据 → 不确定（有证据但不支持）', () => {
  assert.strictEqual(core.status(claim([ev('official', 'neutral', 'strong')])), '不确定');
});
test('缺一手证据：仅二手为 true，有官方文档为 false', () => {
  assert.strictEqual(core.flags(claim([ev('secondary', 'support', 'strong')])).noPrimary, true);
  assert.strictEqual(core.flags(claim([ev('official', 'support', 'weak')])).noPrimary, false);
  assert.strictEqual(core.flags(claim([])).noPrimary, true);
});
test('仅 AI：全部 AI 为 true，空证据为 false，混合为 false', () => {
  assert.strictEqual(core.flags(claim([ev('ai', 'support', 'weak'), ev('ai', 'oppose', 'weak')])).aiOnly, true);
  assert.strictEqual(core.flags(claim([])).aiOnly, false);
  assert.strictEqual(core.flags(claim([ev('ai', 'support', 'weak'), ev('primary', 'support', 'weak')])).aiOnly, false);
});
test('audit 四类问题各命中一次，且 strongOpposeButSupported 恒为空', () => {
  const p = { title: 'p', claims: [
    claim([], 'A 无证据'),
    claim([ev('ai', 'support', 'strong')], 'B 仅 AI'),
    claim([ev('official', 'support', 'strong', { url: '' })], 'C 官方无 URL'),
    claim([ev('observation', 'support', 'weak', { url: '' })], 'D 观察无 URL 不算'),
    claim([ev('primary', 'support', 'strong'), ev('primary', 'oppose', 'strong')], 'E 强反对')
  ] };
  const a = core.audit(p);
  assert.deepStrictEqual(a.noEvidence.map(c => c.text), ['A 无证据']);
  assert.deepStrictEqual(a.aiOnly.map(c => c.text), ['B 仅 AI']);
  assert.deepStrictEqual(a.missingUrl.map(x => x.claim.text), ['C 官方无 URL']);
  assert.strictEqual(a.strongOpposeButSupported.length, 0);
});
test('空项目 audit 不报错', () => {
  const a = core.audit({ title: 'x', claims: [] });
  assert.deepStrictEqual(a, { claimCount: 0, noEvidence: [], aiOnly: [], strongOpposeButSupported: [], missingUrl: [] });
  assert.deepStrictEqual(core.audit(null).noEvidence, []);
});
test('toMarkdown 含主张、状态、局限与警示', () => {
  const p = { title: '工具是否值得做', question: '谁付钱', date: '2026-10-20', claims: [
    claim([ev('secondary', 'support', 'weak', { title: '某文章', excerpt: '摘录|带竖线', limit: '二手转述' })], '老师愿意付费')
  ] };
  const md = core.toMarkdown(p);
  assert.ok(md.includes('### 老师愿意付费'));
  assert.ok(md.includes('状态：**已支持**'));
  assert.ok(md.includes('缺一手证据'));
  assert.ok(md.includes('摘录\\|带竖线'));
  assert.ok(md.includes('二手转述'));
  assert.ok(md.includes('[某文章](https://example.com/x)'));
});
test('toMarkdown 无证据主张写「尚无证据」', () => {
  assert.ok(core.toMarkdown({ title: 'p', claims: [claim([], 'X')] }).includes('（尚无证据）'));
});
test('search 大小写不敏感且搜摘录与来源标题', () => {
  const p = { title: 'p', claims: [
    claim([ev('official', 'support', 'strong', { excerpt: 'Shopify CSV 导入失败', title: 'Help Center' })], '主张一'),
    claim([], '主张二 HSK')
  ] };
  assert.deepStrictEqual(core.search(p, 'shopify').map(c => c.text), ['主张一']);
  assert.deepStrictEqual(core.search(p, 'help center').map(c => c.text), ['主张一']);
  assert.deepStrictEqual(core.search(p, 'hsk').map(c => c.text), ['主张二 HSK']);
  assert.strictEqual(core.search(p, '').length, 2);
});
test('validateImport 拒绝缺 claims、非法类型值，接受合法备份', () => {
  assert.strictEqual(core.validateImport({ version: 1, projects: [{ title: 'p' }] }).ok, false);
  assert.strictEqual(core.validateImport({ version: 1, projects: [{ title: 'p', claims: [{ text: 'c', evidence: [{ type: 'rumor', stance: 'support', strength: 'weak' }] }] }] }).ok, false);
  assert.strictEqual(core.validateImport({ version: 2, projects: [] }).ok, false);
  assert.strictEqual(core.validateImport([]).ok, false);
  const r = core.validateImport({ version: 1, projects: [{ title: ' p ', claims: [{ text: 'c', evidence: [{ type: 'ai', stance: 'support', strength: 'weak', url: 7 }] }] }] });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.projects[0].title, 'p');
  assert.strictEqual(r.projects[0].claims[0].evidence[0].url, '');
  assert.ok(r.projects[0].claims[0].id);
});
test('删除强反对证据后状态重算为已支持', () => {
  const bad = ev('primary', 'oppose', 'strong');
  const c = claim([ev('official', 'support', 'medium'), bad]);
  assert.strictEqual(core.status(c), '已反驳');
  core.removeEvidence(c, bad.id);
  assert.strictEqual(core.status(c), '已支持');
  assert.strictEqual(c.evidence.length, 1);
});
test('counts 分别统计支持、反对、不相关', () => {
  const c = claim([ev('official', 'support', 'weak'), ev('ai', 'support', 'weak'), ev('primary', 'oppose', 'weak'), ev('secondary', 'neutral', 'weak')]);
  assert.deepStrictEqual(core.counts(c), { support: 2, oppose: 1, neutral: 1 });
});
test('newId 连续调用不重复', () => {
  const s = new Set(Array.from({ length: 200 }, () => core.newId('x')));
  assert.strictEqual(s.size, 200);
});

// ---- 2026-10-20 Codex 审核后补充 ----
test('validateImport 拒绝 javascript: URL,接受 https,空串放行', () => {
  const mk = url => ({ version: 1, projects: [{ title: 'p', claims: [{ text: 'c', evidence: [{ type: 'official', stance: 'support', strength: 'weak', url }] }] }] });
  assert.strictEqual(core.validateImport(mk('javascript:alert(1)')).ok, false);
  assert.strictEqual(core.validateImport(mk('data:text/html,x')).ok, false);
  assert.strictEqual(core.validateImport(mk('https://example.com/a')).ok, true);
  assert.strictEqual(core.validateImport(mk('')).ok, true);
  assert.strictEqual(core.safeUrl('javascript:alert(1)'), '');
  assert.strictEqual(core.safeUrl(' https://example.com/x '), 'https://example.com/x');
});
test('toMarkdown 不把非 http(s) URL 渲染成链接', () => {
  const p = { title: 'p', claims: [{ id: 'c', text: 'X', evidence: [{ id: 'e', type: 'ai', stance: 'support', strength: 'weak', title: 'T', url: 'javascript:alert(1)', excerpt: '', limit: '' }] }] };
  const md = core.toMarkdown(p);
  assert.ok(!md.includes('javascript:'));
  assert.ok(md.includes('| T |'));
});
test('validateImport 拒绝 evidence 不是数组的主张（不静默清空）', () => {
  const r = core.validateImport({ version: 1, projects: [{ title: 'p', claims: [{ text: 'c', evidence: { bad: true } }] }] });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('evidence'));
  assert.strictEqual(core.validateImport({ version: 1, projects: [{ title: 'p', claims: [{ text: 'c' }] }] }).ok, false);
});
test('validateImport 拒绝重复的证据 / 主张 / 项目 ID', () => {
  const e = { id: 'dup', type: 'official', stance: 'support', strength: 'weak', url: 'https://example.com' };
  assert.strictEqual(core.validateImport({ version: 1, projects: [{ title: 'p', claims: [{ text: 'c', evidence: [e, { ...e }] }] }] }).ok, false);
  assert.strictEqual(core.validateImport({ version: 1, projects: [{ title: 'p', claims: [{ id: 'c1', text: 'a', evidence: [] }, { id: 'c1', text: 'b', evidence: [] }] }] }).ok, false);
  assert.strictEqual(core.validateImport({ version: 1, projects: [{ id: 'p1', title: 'p', claims: [] }, { id: 'p1', title: 'q', claims: [] }] }).ok, false);
  assert.strictEqual(core.validateImport({ version: 1, projects: [{ title: 'p', claims: [{ text: 'c', evidence: [e, { ...e, id: 'other' }] }] }] }).ok, true);
});

test('[第五轮] parseToday:只认真实 YYYY-MM-DD,2026-02-30 回退', () => {
  assert.deepStrictEqual(core.parseToday('?today=2026-10-20', '2026-01-01'), { date: '2026-10-20', fixed: true });
  assert.deepStrictEqual(core.parseToday('?today=2026-02-30', '2026-01-01'), { date: '2026-01-01', fixed: false });
  assert.deepStrictEqual(core.parseToday('?today=x', '2026-01-01'), { date: '2026-01-01', fixed: false });
  assert.deepStrictEqual(core.parseToday('', '2026-01-01'), { date: '2026-01-01', fixed: false });
});

test('[第五轮] 示例标记 sample 经导入校验保留,并写进 Markdown', () => {
  const base = { version: 1, projects: [{ id: 'p1', title: 'T', question: '', date: '', sample: true, claims: [] }] };
  const v = core.validateImport(base);
  assert.strictEqual(v.projects[0].sample, true);
  assert.match(core.toMarkdown(v.projects[0]), /数据来源：合成示例/);
  const plain = core.validateImport({ version: 1, projects: [{ id: 'p2', title: 'T2', claims: [] }] });
  assert.strictEqual(plain.projects[0].sample, false);
  assert.doesNotMatch(core.toMarkdown(plain.projects[0]), /合成示例/);
});

test('[第五轮] summarizeImport:先列出新增与会被替换的同 ID 项目(含主张与证据数)', () => {
  const mk = (id, title, nEv) => ({ id, title, claims: [{ id: id + 'c', text: 'x', note: '', evidence: Array.from({ length: nEv }, (_, i) => ev('official', 'support', 'strong', { id: id + 'e' + i })) }] });
  const cur = [mk('a', '甲', 2), mk('b', '乙', 0)];
  const inc = [mk('b', '乙新', 1), mk('c', '丙', 3)];
  const r = core.summarizeImport(cur, inc);
  assert.deepStrictEqual(r.added.map(p => p.title), ['丙']);
  assert.deepStrictEqual(r.replaced.map(p => [p.title, p.claims, p.evidence]), [['乙', 1, 0]]);
  assert.deepStrictEqual(r.keep.map(p => p.title), ['甲']);
  assert.strictEqual(r.added[0].evidence, 3);
});

test('[第五轮] statusAfterRemove:删除证据前预告主张状态变化,不改原对象', () => {
  const e1 = ev('official', 'support', 'strong', { id: 'e1' });
  const c = claim([e1]);
  const r = core.statusAfterRemove(c, 'e1');
  assert.deepStrictEqual(r, { before: '已支持', after: '待验证', changed: true });
  assert.strictEqual(c.evidence.length, 1);
  const c2 = claim([e1, ev('primary', 'support', 'weak', { id: 'e2' })]);
  assert.strictEqual(core.statusAfterRemove(c2, 'e2').changed, false);
});

test('[第五轮] audit 返回 claimCount,空项目为 0(界面据此写「暂无主张可检查」)', () => {
  assert.strictEqual(core.audit({ claims: [] }).claimCount, 0);
  assert.strictEqual(core.audit({ claims: [claim([])] }).claimCount, 1);
});
