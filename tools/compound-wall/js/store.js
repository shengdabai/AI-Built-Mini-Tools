/* Local-first storage. Each successful mutation commits one complete snapshot.
   Legacy keys are retained. Conflicting legacy copies remain read-only/exportable. */
window.CW = (function () {
const SNAPSHOT = 'cw:snapshot:v2';
const PALETTE = ["#6b8e23", "#3f7d6b", "#a8763c", "#8a6db0", "#a8503c", "#4f72a8", "#6e8a3a", "#9c6b4f"];

/* ---------- 日期工具（本地时区，避免 UTC 偏移） ---------- */
function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function diffDays(a, b) {
  const ms = parseKey(dateKey(a)) - parseKey(dateKey(b));
  return Math.round(ms / 86400000);
}


let current = { version: 2, revision: 0, habits: [], logs: {}, meta: {longestStreak: 0, lastExport: null}, active: null };
let ready = false, mode = 'localStorage', blocked = '', recovery = null, queue = Promise.resolve();
let idbReady;
function openIDB() {
  if (idbReady) return idbReady;
  const opening = new Promise((resolve, reject) => {
    try {
      if (!window.indexedDB) return resolve(null);
      const req = window.indexedDB.open('compoundwall', 1);
      let failed = false;
      const fail = () => { failed = true; reject(new Error('IndexedDB 无法打开；无法确认最新记录，已暂停保存。')); };
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => { if (failed) req.result.close(); else resolve(req.result); };
      req.onerror = req.onblocked = fail;
    } catch { reject(new Error('IndexedDB 无法打开；已暂停保存。')); }
  });
  idbReady = opening.catch(error => { idbReady = null; throw error; });
  return idbReady;
}
async function idbRead() {
  const db = await openIDB();
  if (!db) return {};
  return new Promise((resolve, reject) => {
    const data = {}, tx = db.transaction('kv', 'readonly');
    const req = tx.objectStore('kv').openCursor();
    req.onsuccess = () => { const c = req.result; if (c) { data[c.key] = c.value; c.continue(); } };
    tx.oncomplete = () => resolve(data);
    tx.onerror = tx.onabort = () => {
      const error = new Error('IndexedDB 读取失败；为保护已有记录，暂停保存。');
      error.partial = data;
      reject(error);
    };
  });
}
async function idbWrite(snapshot) {
  const db = await openIDB();
  if (!db) throw new Error('localStorage 与 IndexedDB 均不可写，数据未保存。');
  await new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(JSON.stringify(snapshot), SNAPSHOT);
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () => reject(new Error('IndexedDB 提交失败，数据未保存。'));
  });
}
function readLS(data) {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('cw:') && k !== 'cw:theme') data[k] = localStorage.getItem(k);
    }
  } catch { throw new Error('localStorage 无法完整读取；已暂停保存。'); }
  return data;
}
function parseSnapshot(raw) {
  if (raw == null) return null;
  const s = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const fail = () => { throw new Error('存储快照损坏；未覆盖原数据，请先导出恢复副本。'); };
  if (!record(s) || s.version !== 2 || !Number.isSafeInteger(s.revision) || s.revision < 0 || !Array.isArray(s.habits) || !record(s.logs) || !record(s.meta)) fail();
  const ids = new Set();
  for (const h of s.habits) {
    if (!record(h) || typeof h.id !== 'string' || !/^h_[a-z0-9_]+$/i.test(h.id) || ids.has(h.id) || typeof h.name !== 'string' || typeof h.unit !== 'string' || typeof h.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(h.color) || !finite(h.createdAt)) fail();
    ids.add(h.id);
  }
  if (s.active !== null && (typeof s.active !== 'string' || !ids.has(s.active))) fail();
  for (const [id, entries] of Object.entries(s.logs)) {
    if (!ids.has(id) || !record(entries)) fail();
    for (const [key, entry] of Object.entries(entries)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || dateKey(parseKey(key)) !== key || !record(entry) || !finite(entry.value) || typeof entry.note !== 'string' || !finite(entry.ts)) fail();
    }
  }
  if ('longestStreak' in s.meta && !finite(s.meta.longestStreak)) fail();
  if (s.meta.lastExport != null && (typeof s.meta.lastExport !== 'string' || !Number.isFinite(Date.parse(s.meta.lastExport)))) fail();
  if (s.meta.longestByHabit != null && (!record(s.meta.longestByHabit) || Object.values(s.meta.longestByHabit).some(n => !finite(n)))) fail();
  return s;
}
function legacySnapshot(data) {
  const read = (k, fallback) => data[k] == null ? fallback : JSON.parse(data[k]);
  const habits = read('cw:habits', []), logs = {};
  if (!Array.isArray(habits)) throw new Error('旧版习惯数据损坏，已停止自动迁移。');
  for (const h of habits) { if (!h || typeof h.id !== 'string') throw new Error('旧版习惯 ID 损坏。'); logs[h.id] = read('cw:logs:' + h.id, {}); }
  return {version: 2, revision: 0, habits, logs, meta: read('cw:meta', {longestStreak: 0, lastExport: null}), active: data['cw:active'] || habits[0]?.id || null};
}
async function loadCurrent() {
  recovery = {localStorage: {}, indexedDB: null, localStorageError: null, indexedDBError: null};
  let ls, idb;
  try { ls = readLS(recovery.localStorage); }
  catch (e) { recovery.localStorageError = e.message; ls = recovery.localStorage; }
  try { idb = await idbRead(); recovery.indexedDB = idb; }
  catch (e) {
    recovery.indexedDBError = e.message;
    recovery.indexedDB = e.partial ?? null;
    recovery.indexedDBIncomplete = true;
    idb = {};
  }
  if (recovery.localStorageError || recovery.indexedDBError) throw new Error([recovery.localStorageError, recovery.indexedDBError].filter(Boolean).join(" "));
  const a = parseSnapshot(ls[SNAPSHOT]), b = parseSnapshot(idb[SNAPSHOT]);
  if (a || b) {
    if (a && b && a.revision === b.revision && JSON.stringify(a) !== JSON.stringify(b)) throw new Error('两份存储快照冲突；暂停保存，请导出恢复副本。');
    const useB = b && (!a || b.revision > a.revision);
    current = structuredClone(useB ? b : a); mode = useB ? 'IndexedDB' : 'localStorage';
    return;
  }
  // Only merge missing keys. Differing versions cannot be ordered reliably.
  const merged = {...idb, ...ls};
  const conflicts = Object.keys(idb).filter(k => k.startsWith('cw:') && k !== 'cw:theme' && idb[k] != null && ls[k] != null && idb[k] !== ls[k]);
  current = parseSnapshot(legacySnapshot(merged));
  if (conflicts.length) blocked = '旧版两份存储存在冲突；当前只读。请导出包含两份原始数据的备份后再选择恢复内容。';
  mode = Object.keys(idb).length ? '旧版合并读取（原始副本保留）' : 'localStorage';
}
async function hydrateFromIDB() {
  if (ready) return;
  try { await loadCurrent(); } catch (e) { blocked = e.message; }
  ready = true;
}
function storageMode() { return blocked || mode; }
function mutate(change) {
  const run = async () => {
    await hydrateFromIDB();
    if (blocked) throw new Error(blocked);
    // Re-read under the browser lock to retain changes from another open tab.
    try { await loadCurrent(); } catch (e) { blocked = e.message; throw e; }
    if (blocked) throw new Error(blocked);
    const next = structuredClone(current), result = change(next);
    next.revision++;
    parseSnapshot(next); // Refuse invalid imports or internal mutations before any write.
    if (mode === 'IndexedDB') await idbWrite(next);
    else {
      try { localStorage.setItem(SNAPSHOT, JSON.stringify(next)); mode = 'localStorage'; }
      catch { await idbWrite(next); mode = 'IndexedDB'; }
    }
    current = next;
    return result;
  };
  const job = queue.then(() => window.navigator?.locks ? window.navigator.locks.request('compoundwall-storage-v2', run) : run());
  queue = job.catch(() => {});
  return job;
}
const getHabits = () => structuredClone(current.habits);
const getMeta = () => structuredClone(current.meta);
const getLogs = id => structuredClone(current.logs[id] || {});
const getActiveHabitId = () => current.active;
const saveHabits = habits => mutate(s => { s.habits = structuredClone(habits); });
const saveMeta = meta => mutate(s => { s.meta = structuredClone(meta); });
const setActiveHabitId = id => mutate(s => { s.active = id; });
const saveLogs = (id, logs) => mutate(s => { s.logs[id] = structuredClone(logs); });
function setLog(id, key, value, note) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return Promise.reject(new Error('打卡日期或数值无效。'));
  return mutate(s => { if (!s.habits.some(h => h.id === id)) throw new Error('习惯不存在。'); (s.logs[id] ||= {})[key] = {value: n, note: note || '', ts: Date.now()}; return structuredClone(s.logs[id]); });
}
const removeLog = (id, key) => mutate(s => { if (s.logs[id]) delete s.logs[id][key]; return structuredClone(s.logs[id] || {}); });
function createHabit({name, unit, color}) {
  return mutate(s => {
    const habit = {id: 'h_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), name: name.trim(), unit: unit.trim(), color: color || PALETTE[s.habits.length % PALETTE.length], createdAt: Date.now()};
    if (s.habits.some(h => h.id === habit.id)) throw new Error('习惯 ID 冲突，请重试。');
    s.habits.push(habit); s.active = habit.id; s.logs[habit.id] = {}; return structuredClone(habit);
  });
}
const updateHabit = (id, patch) => mutate(s => { const h = s.habits.find(h => h.id === id); if (!h) throw new Error('习惯不存在。'); for (const key of ['name','unit','color']) if (key in patch) h[key] = patch[key]; return structuredClone(h); });
const deleteHabit = id => mutate(s => { s.habits = s.habits.filter(h => h.id !== id); delete s.logs[id]; if (s.active === id) s.active = s.habits[0]?.id || null; });
function exportAll() {
  if (blocked) return {app:'CompoundWall-Recovery', version:1, exportedAt:new Date().toISOString(), recovery:structuredClone(recovery), lastCommittedInMemory:structuredClone(current), memoryCopyWarning:'仅供人工恢复参考，不代表完整或最新记录，不能直接导入。', recoveryWarning:blocked};
  return {app:'CompoundWall', version:1, exportedAt:new Date().toISOString(), habits:getHabits(), logs:structuredClone(current.logs), meta:getMeta()};
}
function cleanHabit(h) {
  h = h && typeof h === "object" ? h : {};
  const id = (typeof h.id === "string" && /^h_[a-z0-9_]+$/i.test(h.id))
    ? h.id : ("h_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  return {
    id,
    name: String((h && h.name) || "未命名").slice(0, 20),
    unit: String((h && h.unit) || "次").slice(0, 8),
    color: PALETTE.includes(h && h.color) ? h.color : PALETTE[0],
    createdAt: Number(h && h.createdAt) || Date.now(),
  };
}

function importAll(bundle) {
  if (bundle?.recovery || bundle?.recoveryWarning) return Promise.reject(new Error('这是恢复诊断副本，包含未裁决的原始数据；请先选择并整理有效备份，不能直接导入。'));
  if (!bundle || !Array.isArray(bundle.habits)) return Promise.reject(new Error('数据格式不正确：缺少 habits 列表'));
  const sourceIds = bundle.habits.map(h => h && h.id).filter(id => typeof id === 'string' && id);
  if (new Set(sourceIds).size !== sourceIds.length) return Promise.reject(new Error('备份含重复习惯 ID，未覆盖现有数据。'));
  const habits = bundle.habits.map(cleanHabit), logs = {};
  if (new Set(habits.map(h => h.id)).size !== habits.length) return Promise.reject(new Error('习惯 ID 冲突。'));
  habits.forEach((h,i) => { logs[h.id] = {}; const src = bundle.logs?.[bundle.habits[i]?.id] || {}; for (const [key, entry] of Object.entries(src)) if (/^\d{4}-\d{2}-\d{2}$/.test(key) && entry && typeof entry === 'object' && Number.isFinite(Number(entry.value)) && Number(entry.value) >= 0) logs[h.id][key] = {value:Number(entry.value),note:String(entry.note || ''),ts:Number(entry.ts)||0}; });
  return mutate(s => { s.habits = habits; s.logs = logs; s.meta = bundle.meta && typeof bundle.meta === 'object' && !Array.isArray(bundle.meta) ? structuredClone(bundle.meta) : {longestStreak:0,lastExport:null}; s.active = habits[0]?.id || null; return habits.length; });
}
return { dateKey, parseKey, addDays, diffDays, storageMode, getHabits, saveHabits, getMeta, saveMeta, getActiveHabitId, setActiveHabitId, getLogs, saveLogs, setLog, removeLog, createHabit, updateHabit, deleteHabit, exportAll, importAll, hydrateFromIDB, PALETTE };
})();
