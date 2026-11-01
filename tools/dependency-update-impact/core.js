'use strict';
// 依赖更新影响说明 · 纯逻辑(无 DOM)。semver 解析自写,不引入库。
(function () {
  const SECTIONS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
  const SECTION_LABELS = {
    dependencies: 'dependencies',
    devDependencies: 'devDependencies',
    peerDependencies: 'peerDependencies',
    optionalDependencies: 'optionalDependencies',
    unknown: '未识别区块',
  };
  const NON_DEP_KEYS = new Set(['name', 'version', 'description', 'main', 'module', 'types', 'license', 'author', 'private', 'type', 'homepage', 'packageManager', 'url', 'node', 'npm']);

  // ---------- 范围符号 ----------
  const RANGE_MEANING = {
    '^': '^ 允许次版本和补丁自动升级(0.x 版本只允许补丁)',
    '~': '~ 只允许补丁自动升级',
    '': '固定版本,不会自动升级',
    x: '通配(如 1.2.x 或缺省的次版本/补丁),允许该位置的版本自动变化',
    '>=': '>= 没有上限,更高的 major 版本也可能被安装',
    '>': '> 没有上限,更高的 major 版本也可能被安装',
    '<=': '<= 只设了上限,下限不受约束',
    '<': '< 只设了上限,下限不受约束',
  };
  const rangeName = p => (p === '' ? '固定' : p === 'x' ? '通配' : p);
  // 范围类型:无前缀的通配(1.2.x、1.2)与固定版本语义不同,单独成类
  const rangeKey = p => (p.partial && p.prefix === '' ? 'x' : p.prefix);

  // ---------- semver 解析 ----------
  function nonSemverReason(s) {
    if (s === '' ) return '版本为空';
    if (/^(latest|next|beta|alpha|canary|rc)$/i.test(s)) return `使用标签 ${s},安装结果随时间变化`;
    if (s === '*' || /^[xX]$/.test(s)) return '通配版本,任何版本都可能被安装';
    if (/^workspace:/.test(s)) return 'workspace: 协议,指向本仓库内的包';
    if (/^(file|link|portal):/.test(s)) return '本地路径依赖';
    if (/^npm:/.test(s)) return 'npm: 别名依赖';
    if (/^(git\+|git:|github:|gitlab:|bitbucket:|ssh:)/.test(s) || /\.git(#|$)/.test(s)) return 'git 地址依赖';
    if (/^https?:\/\//.test(s)) return '压缩包 URL 依赖';
    if (/^[\w.-]+\/[\w.-]+(#.*)?$/.test(s)) return 'GitHub 简写依赖';
    if (/\|\||\s/.test(s)) return '复合范围表达式';
    return '无法按 主.次.补 解析';
  }

  function parseSpec(spec) {
    const raw = String(spec == null ? '' : spec).trim();
    const m = /^(\^|~|>=|<=|>|<|=)?\s*v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/.exec(raw);
    if (!m) return { semver: false, raw, reason: nonSemverReason(raw) };
    const num = x => (x === undefined || /^[xX*]$/.test(x) ? 0 : Number(x));
    const prefix = m[1] === '=' ? '' : (m[1] || '');
    return {
      semver: true,
      raw,
      prefix,
      major: Number(m[2]),
      minor: num(m[3]),
      patch: num(m[4]),
      pre: m[5] || '',
      partial: m[3] === undefined || m[4] === undefined || /^[xX*]$/.test(m[3] || '') || /^[xX*]$/.test(m[4] || ''),
    };
  }

  function comparePre(a, b) {
    if (a === b) return 0;
    if (a === '') return 1;
    if (b === '') return -1;
    const x = a.split('.');
    const y = b.split('.');
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] === undefined) return -1;
      if (y[i] === undefined) return 1;
      const xn = /^\d+$/.test(x[i]);
      const yn = /^\d+$/.test(y[i]);
      if (xn && yn) { if (Number(x[i]) !== Number(y[i])) return Number(x[i]) < Number(y[i]) ? -1 : 1; }
      else if (xn) return -1;
      else if (yn) return 1;
      else if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
    }
    return 0;
  }

  function compareParsed(a, b) {
    for (const k of ['major', 'minor', 'patch']) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
    return comparePre(a.pre, b.pre);
  }

  function describeRange(fromPrefix, toPrefix) {
    const pin = fromPrefix !== '' && toPrefix === '' ? 'pinned' : (fromPrefix === '' && toPrefix !== '' ? 'unpinned' : null);
    const text = `范围符号 ${rangeName(fromPrefix)} → ${rangeName(toPrefix)}:原来${RANGE_MEANING[fromPrefix] || fromPrefix};现在${RANGE_MEANING[toPrefix] || toPrefix}。`;
    return { from: fromPrefix, to: toPrefix, pin, text };
  }

  // 返回 {kind, direction, from, to, rangeChange}
  // kind: major | minor | patch | prerelease | nonsemver | same
  function semverDelta(from, to) {
    const a = parseSpec(from);
    const b = parseSpec(to);
    if (!a.semver || !b.semver) {
      if (a.raw === b.raw) return { kind: 'same', direction: 'same', from, to, rangeChange: null };
      return { kind: 'nonsemver', direction: 'unknown', from, to, rangeChange: null, reason: !b.semver ? b.reason : a.reason };
    }
    const rangeChange = rangeKey(a) !== rangeKey(b) ? describeRange(rangeKey(a), rangeKey(b)) : null;
    const cmp = compareParsed(a, b);
    if (cmp === 0) return { kind: 'same', direction: 'same', from, to, rangeChange };
    const direction = cmp < 0 ? 'up' : 'down';
    const hi = cmp < 0 ? b : a;
    const lo = cmp < 0 ? a : b;
    let core;
    if (hi.major !== lo.major) core = 'major';
    else if (hi.minor !== lo.minor) core = 'minor';
    else if (hi.patch !== lo.patch) core = 'patch';
    else core = 'prerelease';
    const kind = a.pre || b.pre ? 'prerelease' : core;
    const out = { kind, direction, coreKind: core, from, to, rangeChange };
    if (core === 'minor' && hi.major === 0) out.zeroX = true;
    if (a.partial || b.partial) out.partial = true;
    return out;
  }

  // ---------- JSON 与 package.json ----------
  function lineCol(text, pos) {
    const before = text.slice(0, pos);
    const line = before.split('\n').length;
    const column = pos - (before.lastIndexOf('\n') + 1) + 1;
    return { line, column };
  }

  function locateJsonError(text, e) {
    const msg = String(e && e.message ? e.message : e);
    let m = /line (\d+) column (\d+)/.exec(msg);
    if (m) return { line: Number(m[1]), column: Number(m[2]) };
    m = /position (\d+)/.exec(msg);
    if (m) return lineCol(text, Number(m[1]));
    if (/end of JSON/i.test(msg)) return lineCol(text, text.length);
    return { line: null, column: null };
  }

  function parsePackageJson(text) {
    const src = String(text == null ? '' : text);
    if (!src.trim()) return { ok: false, deps: [], error: { message: '内容为空', line: null, column: null } };
    let obj;
    try { obj = JSON.parse(src); } catch (e) {
      const loc = locateJsonError(src, e);
      const where = loc.line ? `(第 ${loc.line} 行第 ${loc.column} 列)` : '';
      return { ok: false, deps: [], error: { message: `JSON 解析失败${where}:${String(e.message).replace(/ \(line \d+ column \d+\)/, '')}`, line: loc.line, column: loc.column } };
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      return { ok: false, deps: [], error: { message: 'package.json 顶层必须是对象', line: null, column: null } };
    }
    const deps = [];
    for (const sec of SECTIONS) {
      if (!(sec in obj)) continue;
      const block = obj[sec];
      if (block === null || typeof block !== 'object' || Array.isArray(block)) {
        return { ok: false, deps: [], error: { message: `${sec} 必须是对象`, line: null, column: null } };
      }
      for (const name of Object.keys(block)) {
        if (typeof block[name] !== 'string') {
          return { ok: false, deps: [], error: { message: `${sec} 里 ${name} 的版本必须是字符串`, line: null, column: null } };
        }
        deps.push({ name, range: block[name], section: sec });
      }
    }
    return { ok: true, deps, error: null };
  }

  // 按顶层花括号切出多个 JSON 对象(识别字符串里的括号)
  function splitJsonObjects(text) {
    const docs = [];
    let depth = 0;
    let inStr = false;
    let esc = false;
    let start = -1;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') { if (depth === 0) start = i; depth++; continue; }
      if (c === '}') {
        depth--;
        if (depth === 0 && start >= 0) { docs.push({ text: text.slice(start, i + 1), start }); start = -1; }
        if (depth < 0) depth = 0;
        continue;
      }
      if (depth === 0 && !/\s/.test(c)) return { docs, stray: { position: i, ...lineCol(text, i) } };
    }
    if (depth > 0 && start >= 0) docs.push({ text: text.slice(start), start });
    return { docs, stray: null };
  }

  // ---------- git diff ----------
  const DIFF_LINE = /^([ +-])\s*"((?:[^"\\]|\\.)+)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/;
  const SECTION_OPEN = /"([^"]+)"\s*:\s*\{\s*$/;

  function unesc(s) {
    try { return JSON.parse('"' + s + '"'); } catch (e) { return s; }
  }

  function parseDiff(text) {
    const lines = String(text == null ? '' : text).replace(/\r/g, '').split('\n');
    const oldDeps = [];
    const newDeps = [];
    let section = null; // null=未知;'none'=已知不是依赖区块
    for (const line of lines) {
      if (line.startsWith('@@')) {
        section = null;
        const tail = line.replace(/^@@[^@]*@@/, '');
        const h = SECTION_OPEN.exec(tail.trim());
        if (h) section = SECTIONS.includes(h[1]) ? h[1] : 'none';
        continue;
      }
      if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) continue;
      const first = line[0];
      if (first !== ' ' && first !== '+' && first !== '-') continue;
      const body = line.slice(1);
      const open = SECTION_OPEN.exec(body.trim());
      if (open) { section = SECTIONS.includes(open[1]) ? open[1] : 'none'; continue; }
      if (/^\s*\},?\s*$/.test(body)) { if (section) section = 'none'; continue; }
      const m = DIFF_LINE.exec(line);
      if (!m) continue;
      if (section === 'none') continue;
      const name = unesc(m[2]);
      if (section === null && NON_DEP_KEYS.has(name)) continue;
      const entry = { name, range: unesc(m[3]), section: section || 'unknown' };
      if (m[1] !== '+') oldDeps.push(entry);
      if (m[1] !== '-') newDeps.push({ ...entry });
    }
    if (!oldDeps.length && !newDeps.length) {
      return { ok: false, oldDeps, newDeps, error: { message: '没有在 diff 里找到依赖行(形如 +    "pkg": "^1.0.0")', line: null, column: null } };
    }
    return { ok: true, oldDeps, newDeps, error: null };
  }

  // ---------- npm outdated ----------
  const OUTDATED_HEADER = /^\s*Package\s+Current\s+(?:Wanted\s+)?Latest\b/m;

  function parseOutdated(text, opts) {
    const target = opts && opts.target === 'wanted' ? 'wanted' : 'latest';
    const clean = String(text == null ? '' : text).replace(/\x1b\[[0-9;]*m/g, '').replace(/\r/g, '');
    const lines = clean.split('\n').map(l => l.replace(/[│┃┆║|]/g, ' '));
    const hIdx = lines.findIndex(l => /^\s*Package\s+Current\b/.test(l) && /\bLatest\b/.test(l));
    if (hIdx < 0) return { ok: false, oldDeps: [], newDeps: [], rows: [], error: { message: '没有找到 npm outdated 的表头(Package Current Wanted Latest)', line: null, column: null } };
    const cols = lines[hIdx].trim().split(/\s+/);
    const iCur = cols.indexOf('Current');
    const iWant = cols.indexOf('Wanted');
    const iLat = cols.indexOf('Latest');
    const oldDeps = [];
    const newDeps = [];
    const rows = [];
    for (let i = hIdx + 1; i < lines.length; i++) {
      const l = lines[i].trim();
      if (!l || /^[─━═┌┐└┘├┤┬┴┼\s-]+$/.test(l)) continue;
      const t = l.split(/\s+/);
      let section = 'unknown';
      let name = t[0];
      if (t[1] === '(dev)') { section = 'devDependencies'; t.splice(1, 1); }
      if (t.length <= Math.max(iCur, iLat)) continue;
      name = t[0];
      const current = t[iCur];
      const wanted = iWant >= 0 ? t[iWant] : null;
      const latest = t[iLat];
      const to = target === 'wanted' && wanted ? wanted : latest;
      rows.push({ name, current, wanted, latest });
      if (current !== 'MISSING') oldDeps.push({ name, range: current, section });
      newDeps.push({ name, range: to, section });
    }
    if (!rows.length) return { ok: false, oldDeps, newDeps, rows, error: { message: 'npm outdated 表头下面没有数据行', line: null, column: null } };
    return { ok: true, oldDeps, newDeps, rows, error: null };
  }

  // ---------- 输入识别 ----------
  function detectInput(text) {
    const s = String(text == null ? '' : text);
    if (!s.trim()) return 'empty';
    if (s.trimStart().startsWith('{')) {
      const { docs } = splitJsonObjects(s);
      if (docs.length === 2) return 'package-json-pair';
      if (docs.length === 1) return 'package-json-single';
      if (docs.length > 2) return 'package-json-many';
      return 'unknown';
    }
    if (OUTDATED_HEADER.test(s.replace(/\x1b\[[0-9;]*m/g, '').replace(/[│┃┆║|]/g, ' '))) return 'outdated';
    if (/^diff --git/m.test(s) || /^@@ .*@@/m.test(s) || (/^--- /m.test(s) && /^\+\+\+ /m.test(s))) return 'diff';
    return 'unknown';
  }

  const KIND_LABELS = {
    empty: '还没有内容',
    'package-json-pair': '两份 package.json(旧、新)',
    'package-json-single': '只有一份 package.json',
    'package-json-many': '超过两份 package.json',
    diff: 'git diff package.json',
    outdated: 'npm outdated 表格',
    unknown: '无法识别',
  };

  // ---------- 比较 ----------
  function normalizeDeps(d) {
    if (Array.isArray(d)) return d;
    if (d && typeof d === 'object') return Object.keys(d).map(name => ({ name, range: String(d[name]), section: 'dependencies' }));
    return [];
  }

  function groupByName(list) {
    const map = new Map();
    for (const e of list) {
      if (!map.has(e.name)) map.set(e.name, []);
      map.get(e.name).push(e);
    }
    return map;
  }

  function makeChange(name, type, o, n) {
    const c = { name, type, section: (n || o).section, from: o ? o.range : null, to: n ? n.range : null, duplicate: false, duplicateSections: [] };
    if (o && n && o.section !== n.section) c.fromSection = o.section;
    if (o && n) {
      c.delta = semverDelta(o.range, n.range);
    }
    return c;
  }

  const KIND_ORDER = ['major', 'downgrade', 'prerelease', 'nonsemver', 'minor', 'patch', 'range', 'moved', 'added', 'removed', 'duplicate'];

  const CATEGORY_LABELS = {
    major: 'Major', downgrade: '降级', prerelease: '预发布', nonsemver: '非 semver', minor: 'Minor', patch: 'Patch',
    range: '范围变化', moved: '移动区块', added: '新增', removed: '移除', duplicate: '重复声明',
  };

  function categoryOf(c) {
    const labels = CATEGORY_LABELS;
    let key;
    if (c.type === 'moved' && c.delta && c.delta.kind !== 'same') key = c.delta.direction === 'down' ? 'downgrade' : c.delta.kind;
    else if (c.type === 'upgraded') key = c.delta.kind;
    else if (c.type === 'downgraded') key = 'downgrade';
    else if (c.type === 'changed') key = 'nonsemver';
    else key = c.type;
    return { key, label: labels[key] || key };
  }

  function compareDeps(oldDeps, newDeps) {
    const oldList = normalizeDeps(oldDeps);
    const newList = normalizeDeps(newDeps);
    const oldMap = groupByName(oldList);
    const newMap = groupByName(newList);
    const names = [...new Set([...oldMap.keys(), ...newMap.keys()])];
    const changes = [];
    for (const name of names) {
      const os = oldMap.get(name) || [];
      const ns = newMap.get(name) || [];
      const leftOld = [];
      for (const o of os) {
        const n = ns.find(x => x.section === o.section);
        if (!n) { leftOld.push(o); continue; }
        const d = semverDelta(o.range, n.range);
        if (d.kind === 'same' && !d.rangeChange) continue;
        const ch = makeChange(name, 'range', o, n);
        if (d.kind === 'same') ch.type = 'range';
        else if (d.kind === 'nonsemver') ch.type = 'changed';
        else ch.type = d.direction === 'down' ? 'downgraded' : 'upgraded';
        changes.push(ch);
      }
      const leftNew = ns.filter(n => !os.some(o => o.section === n.section));
      const pairs = Math.min(leftOld.length, leftNew.length);
      for (let i = 0; i < pairs; i++) changes.push(makeChange(name, 'moved', leftOld[i], leftNew[i]));
      for (let i = pairs; i < leftOld.length; i++) changes.push(makeChange(name, 'removed', leftOld[i], null));
      for (let i = pairs; i < leftNew.length; i++) changes.push(makeChange(name, 'added', null, leftNew[i]));
    }
    // 同一个包同时出现在 dependencies 与 devDependencies(以新版本为准)
    for (const [name, ns] of newMap) {
      const secs = [...new Set(ns.map(e => e.section))];
      if (secs.includes('dependencies') && secs.includes('devDependencies')) {
        const mine = changes.filter(c => c.name === name && c.type !== 'removed');
        if (mine.length) for (const c of mine) { c.duplicate = true; c.duplicateSections = ['dependencies', 'devDependencies']; }
        else {
          const e = ns.find(x => x.section === 'dependencies');
          const c = makeChange(name, 'duplicate', e, e);
          c.duplicate = true;
          c.duplicateSections = ['dependencies', 'devDependencies'];
          c.to = ns.map(x => `${x.range}(${x.section})`).join(' / ');
          c.from = null;
          changes.push(c);
        }
      }
    }
    return sortChanges(changes);
  }

  function sortChanges(changes) {
    return changes.slice().sort((a, b) => {
      const ka = KIND_ORDER.indexOf(categoryOf(a).key);
      const kb = KIND_ORDER.indexOf(categoryOf(b).key);
      if (ka !== kb) return ka - kb;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
  }

  // ---------- 影响说明(确定性模板) ----------
  function advice(change) {
    const cat = categoryOf(change);
    const notes = [];
    let severity = 'info';
    let headline;
    switch (cat.key) {
      case 'major':
        severity = 'danger';
        headline = '可能有破坏性变更,必须读 CHANGELOG,建议跑全部测试与类型检查';
        break;
      case 'minor':
        severity = 'info';
        headline = '新增功能,建议跑测试';
        if (change.delta && change.delta.zeroX) notes.push('0.x 版本的次版本升级,按 semver 约定可能包含破坏性变更,请按 major 对待');
        break;
      case 'patch':
        severity = 'ok';
        headline = '修复,建议跑冒烟';
        break;
      case 'prerelease':
        severity = 'warn';
        headline = '预发布版本,接口可能还会变化,不建议直接用于生产;建议在单独分支验证并跑全部测试';
        break;
      case 'nonsemver':
        severity = 'warn';
        headline = `无法按 semver 判断影响(${(change.delta && change.delta.reason) || '版本写法特殊'});请人工核对来源与变更内容,建议跑全部测试`;
        break;
      case 'downgrade':
        severity = 'warn';
        headline = '确认是否有意为之';
        break;
      case 'added':
        headline = '新增依赖;确认确实需要它,并检查许可证与体积';
        break;
      case 'removed':
        headline = '移除依赖;确认代码里已没有引用(本工具不分析代码引用),并确认 lockfile 已更新';
        break;
      case 'moved':
        severity = 'warn';
        headline = `依赖从 ${change.fromSection} 移到 ${change.section};确认运行时与构建时是否仍能拿到它`;
        break;
      case 'range':
        headline = '版本号没变,只改了范围符号';
        break;
      case 'duplicate':
        severity = 'warn';
        headline = '同一个包在两个区块重复声明';
        break;
      default:
        headline = '';
    }
    if (change.type === 'moved' && cat.key !== 'moved') {
      notes.push(`同时从 ${change.fromSection} 移到 ${change.section},请一并确认运行时与构建时是否仍能拿到它`);
    }
    if (change.delta && change.delta.rangeChange) {
      const rc = change.delta.rangeChange;
      notes.push(rc.text);
      if (rc.pin === 'pinned') notes.push('范围改为写死版本:之后不会自动拿到补丁修复,需要手动升级');
      if (rc.pin === 'unpinned') notes.push('写死版本改为范围:之后重新安装可能拿到不同的版本,结果不再完全可复现');
    }
    if (change.duplicate) {
      notes.push('同时出现在 dependencies 与 devDependencies,请保留一处,避免两处版本不一致');
      if (severity === 'ok' || severity === 'info') severity = 'warn';
    }
    return { key: cat.key, label: cat.label, severity, headline, notes, text: [headline, ...notes].filter(Boolean).join(';') };
  }

  // ---------- 测试建议清单 ----------
  const MAJOR_ITEMS = [
    '接口签名:对照 CHANGELOG,检查你调用的函数、参数和返回值有没有变化',
    '配置项:检查配置文件和初始化选项有没有被重命名、删除或改了默认值',
    'Node 版本要求:确认新版本要求的最低 Node 版本(看它的 engines 字段或文档),与本项目的运行环境对照',
    '类型定义:跑类型检查(如 tsc --noEmit),留意新出现的类型错误',
    '测试:跑全部测试,重点看用到这个包的用例',
    'peerDependencies:检查新版本对其他包的版本要求,是否与当前依赖冲突',
  ];
  const GENERAL_ITEMS = [
    '重新安装依赖后确认 lockfile 已提交',
    '跑一次完整构建',
    '跑全部测试,再手动冒烟主要流程',
    '在 CI 或干净环境重装依赖再验证一次',
  ];

  function testChecklist(changes) {
    const perPackage = changes
      .filter(c => categoryOf(c).key === 'major' && (c.type === 'upgraded' || c.type === 'moved'))
      .map(c => ({ name: c.name, from: c.from, to: c.to, items: MAJOR_ITEMS.slice() }));
    let emptyNote = '';
    if (!perPackage.length) {
      emptyNote = changes.length
        ? '本工具仅为 major 升级生成逐包清单;其余变化请结合上方提示自行检查。'
        : '没有检测到依赖变化,所以没有逐包清单。';
    }
    return { perPackage, general: GENERAL_ITEMS.slice(), emptyNote };
  }

  function summarize(changes) {
    const counts = Object.create(null);
    for (const k of KIND_ORDER) counts[k] = 0;
    for (const c of changes) counts[categoryOf(c).key]++;
    const total = changes.length;
    return { total, counts, attention: counts.major + counts.downgrade + counts.prerelease + counts.nonsemver + counts.duplicate + counts.moved };
  }

  // ---------- 导出 ----------
  // 防公式注入:以 = + - @ 开头的字段加单引号;单独的 + 或 - 不算
  function guardFormula(v) {
    const s = String(v == null ? '' : v);
    // 先跳过前导空白/控制字符(制表符、回车等)再判断首个有效字符
    if (/^[\s\u0000-\u001f\u007f]*[=+\-@]/.test(s) && !/^[+-]$/.test(s)) return "'" + s;
    return s;
  }

  function csvField(v) {
    const s = guardFormula(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(changes, opts) {
    const sample = !!(opts && opts.sample);
    const head = ['包名', '区块', '变化', '旧版本', '新版本', '分类', '范围变化', '影响说明', '警告'];
    if (sample) head.push('数据来源');
    const rows = [head.map(csvField).join(',')];
    for (const c of changes) {
      const a = advice(c);
      const rc = c.delta && c.delta.rangeChange ? c.delta.rangeChange.text : '';
      const cells = [
        c.name, SECTION_LABELS[c.section] || c.section, a.label, c.from == null ? '' : c.from, c.to == null ? '' : c.to,
        a.key, rc, a.headline, c.duplicate ? '重复出现在 dependencies 与 devDependencies' : '',
      ];
      if (sample) cells.push('合成示例');
      rows.push(cells.map(csvField).join(','));
    }
    return rows.join('\r\n') + '\r\n';
  }

  const mdOneLine = s => String(s == null ? '' : s).replace(/\r?\n/g, ' ');
  const mdCode = s => '`' + mdOneLine(s).replace(/`/g, "'").replace(/\|/g, '\\|') + '`';
  const mdText = s => guardFormula(mdOneLine(s)).replace(/\|/g, '\\|');
  const mdCodeOrDash = s => (s == null || s === '' ? '—' : mdCode(s));

  function toMarkdown(changes, opts) {
    const o = opts || {};
    const out = [];
    out.push('## 依赖更新影响说明', '');
    out.push('> 按固定模板生成,未联网查询 registry 或 CHANGELOG;建议均为通用提示,不代表具体包的真实变更。', '');
    if (o.basis) out.push(`> 比较基准:${mdOneLine(o.basis)}。`, '');
    if (o.sample) out.push('> 数据来源:合成示例,包名与版本均为虚构,不对应任何真实项目。', '');
    if (!changes.length) {
      out.push('没有检测到依赖变化。', '');
      return out.join('\n');
    }
    const sum = summarize(changes);
    out.push('### 概览', '', '| 类别 | 数量 |', '| --- | --- |');
    for (const k of KIND_ORDER) {
      if (!sum.counts[k]) continue;
      out.push(`| ${CATEGORY_LABELS[k]} | ${sum.counts[k]} |`);
    }
    out.push('');

    const attention = changes.filter(c => ['major', 'downgrade', 'prerelease', 'nonsemver', 'moved'].includes(categoryOf(c).key) || c.duplicate);
    if (attention.length) {
      out.push('### 需要重点关注', '');
      for (const c of attention) {
        const a = advice(c);
        const ver = c.from != null && c.to != null ? ` ${mdCode(c.from)} → ${mdCode(c.to)}` : '';
        out.push(`- **${mdCode(c.name)}**${ver}(${a.label}):${a.headline}${a.notes.length ? ';' + a.notes.map(mdOneLine).join(';') : ''}`);
      }
      out.push('');
    }

    out.push('### 变更明细', '', '| 包 | 区块 | 分类 | 旧版本 | 新版本 | 影响说明 |', '| --- | --- | --- | --- | --- | --- |');
    for (const c of changes) {
      const a = advice(c);
      out.push(`| ${mdCode(c.name)} | ${mdText(SECTION_LABELS[c.section] || c.section)} | ${a.label} | ${mdCodeOrDash(c.from)} | ${mdCodeOrDash(c.to)} | ${mdText(a.text)} |`);
    }
    out.push('');

    const ranges = changes.filter(c => c.delta && c.delta.rangeChange);
    if (ranges.length) {
      out.push('### 范围符号变化', '');
      for (const c of ranges) out.push(`- ${mdCode(c.name)} ${mdCode(c.from)} → ${mdCode(c.to)}:${c.delta.rangeChange.text}`);
      out.push('');
    }

    const list = testChecklist(changes);
    out.push('### 测试建议', '');
    for (const p of list.perPackage) {
      out.push(`#### ${mdCode(p.name)} ${mdCode(p.from)} → ${mdCode(p.to)}`, '');
      for (const it of p.items) out.push(`- [ ] ${it}`);
      out.push('');
    }
    out.push('#### 通用', '');
    for (const it of list.general) out.push(`- [ ] ${it}`);
    out.push('');
    return out.join('\n');
  }

  // ---------- 总入口 ----------
  function analyze(text, opts) {
    const kind = detectInput(text);
    const base = { kind, kindLabel: KIND_LABELS[kind], ok: false, errors: [], oldDeps: [], newDeps: [], changes: [] };
    const fail = (message, extra) => ({ ...base, errors: [{ message, ...(extra || {}) }] });
    if (kind === 'empty') return fail('请先粘贴内容');
    if (kind === 'unknown') return fail('无法识别输入:请粘贴两份 package.json、一份 git diff package.json,或 npm outdated 的表格');
    if (kind === 'package-json-single') return fail('只检测到一份 package.json,需要旧、新两份(依次粘贴,中间可空行)');
    if (kind === 'package-json-many') return fail('检测到超过两份 package.json,请只粘贴旧、新两份');
    let res;
    if (kind === 'package-json-pair') {
      const { docs, stray } = splitJsonObjects(String(text));
      if (stray) return fail(`两份 package.json 之间或之后有多余内容(第 ${stray.line} 行第 ${stray.column} 列)`, { line: stray.line, column: stray.column });
      const o = parsePackageJson(docs[0].text);
      const n = parsePackageJson(docs[1].text);
      const errors = [];
      if (!o.ok) errors.push({ ...o.error, message: '旧 package.json:' + o.error.message, doc: 'old' });
      if (!n.ok) errors.push({ ...n.error, message: '新 package.json:' + n.error.message, doc: 'new' });
      if (errors.length) return { ...base, errors };
      res = { ok: true, oldDeps: o.deps, newDeps: n.deps };
    } else if (kind === 'diff') {
      res = parseDiff(text);
    } else {
      res = parseOutdated(text, opts);
    }
    if (!res.ok) return { ...base, errors: [res.error] };
    const changes = compareDeps(res.oldDeps, res.newDeps);
    let target = null;
    let basis = '旧文件 → 新文件';
    if (kind === 'outdated') {
      target = opts && opts.target === 'wanted' ? 'wanted' : 'latest';
      basis = target === 'wanted' ? 'Current → Wanted' : 'Current → Latest';
    } else if (kind === 'diff') {
      basis = 'diff 里的 - 行 → + 行';
    }
    return { ...base, ok: true, target, basis, oldDeps: res.oldDeps, newDeps: res.newDeps, changes, summary: summarize(changes) };
  }

  // ---------- 用户数据范围与文件检查 ----------
  const MAX_INPUT_CHARS = 500000;
  // 载入示例 / 载入文件 / 清空会替换什么:输入框内容(草稿)与偏离默认值的 npm outdated 目标列
  function inputScope(text, target) {
    const s = String(text == null ? '' : text);
    const has = s.trim().length > 0;
    const targetChanged = target === 'wanted';
    return {
      has, lines: has ? s.replace(/\n+$/, '').split('\n').length : 0, chars: has ? s.length : 0,
      targetChanged, any: has || targetChanged,
    };
  }
  function describeInputScope(sc) {
    const p = [];
    if (sc.has) p.push(`输入框里的 ${sc.lines} 行、${sc.chars} 个字符`);
    if (sc.targetChanged) p.push('npm outdated 目标列设置(Wanted,会恢复为默认 Latest)');
    return p.join('、');
  }
  function checkTextFile(name, text) {
    const s = String(text == null ? '' : text);
    if (!s.trim()) return { ok: false, error: `文件「${name}」是空的,没有可载入的内容。` };
    if (s.indexOf('\u0000') >= 0) return { ok: false, error: `文件「${name}」含有空字符,不是文本文件。` };
    if (s.length > MAX_INPUT_CHARS) return { ok: false, error: `文件「${name}」超过 ${MAX_INPUT_CHARS} 个字符,拒绝载入(不会截断)。` };
    return { ok: true, error: null };
  }

  const api = {
    SECTIONS, SECTION_LABELS, KIND_ORDER, KIND_LABELS,
    detectInput, parsePackageJson, parseDiff, parseOutdated, parseSpec,
    splitJsonObjects, compareDeps, semverDelta, advice, categoryOf, testChecklist, summarize,
    toMarkdown, toCsv, guardFormula, analyze, CATEGORY_LABELS,
    inputScope, describeInputScope, checkTextFile, MAX_INPUT_CHARS,
  };
  globalThis.DepImpactCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
