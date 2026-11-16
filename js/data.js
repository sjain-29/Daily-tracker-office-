// js/data.js — all Firebase reads/writes for the tracker, plus in-memory state.
//
// Data lives only under /tracker/{auth.uid}. Writes are multi-path updates touching just the changed fields.
// Every write is applied to the screen instantly and kept in a small on-device queue until Firebase confirms it,
// so changes made offline are not lost and sync automatically when the connection returns.

import { db, ref, push, update, onValue } from './firebase.js';
import { cleanText, storageGet, storageSet, storageRemove, debounce, todayStr, parseDate, toDateStr, addDays } from './utils.js';
import { isOpen, workingDayOnOrAfter } from './workdays.js';

export class ValidationError extends Error {}

export const DEFAULT_DEPARTMENTS = ['R&D', 'Production', 'Procurement', 'Quality (QA/QC)', 'Testing & Validation', 'Stores', 'Accounts', 'Management'];
const COLLECTIONS = ['departments', 'people', 'tasks'];

/* ================================================================ State */

const listeners = new Set();
const pendingKeys = new Set();
let flushScheduled = false;

export const store = {
  uid: null, user: null, role: undefined, connected: false, fromCache: false,
  loaded: { departments: false, people: false, tasks: false, meta: false },
  departments: new Map(), people: new Map(), tasks: new Map(), meta: {},
  list(name) { return [...this[name].values()]; },
  department(id) { return id ? this.departments.get(id) || null : null; },
  person(id) { return id ? this.people.get(id) || null : null; },
  isLoaded() { return this.fromCache || COLLECTIONS.every((k) => this.loaded[k]); },
  sortedDepartments() { return this.list('departments').sort((a, b) => a.name.localeCompare(b.name)); },
  sortedPeople() { return this.list('people').sort((a, b) => a.name.localeCompare(b.name)); },
  displayName() {
    const local = this.user?.email ? this.user.email.split('@')[0].replace(/[._-]+/g, ' ') : '';
    return local ? local.replace(/\b\w/g, (c) => c.toUpperCase()) : 'there';
  },
  /** Current responsible person / department for a task (live names, falling back to the saved snapshot). */
  contactOf(t) {
    const p = this.person(t.personId);
    const d = this.department(p ? p.departmentId : t.departmentId);
    return { person: p, personName: p?.name || t.personName || '', department: d, departmentName: d?.name || t.departmentName || '' };
  },
  changed(key) {
    pendingKeys.add(key);
    if (flushScheduled) return;
    flushScheduled = true;
    const flush = () => {
      flushScheduled = false;
      const keys = new Set(pendingKeys);
      pendingKeys.clear();
      for (const fn of listeners) { try { fn(keys); } catch (e) { console.error(e); } }
    };
    if (typeof requestAnimationFrame === 'function' && !document.hidden) requestAnimationFrame(flush); else setTimeout(flush, 16);
  },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
};

/* ================================================================ Sync */

let uid = null, remember = true, rootUnsubs = [], dataUnsubs = [];
let handlers = { onRoleChange: () => {}, onPermissionDenied: () => {}, onWriteError: () => {} };
const base = () => `tracker/${uid}`;

export function startSync(user, opts = {}) {
  stopSync();
  uid = user.uid;
  store.uid = uid;
  store.user = user;
  remember = opts.remember !== false;
  handlers = { ...handlers, ...opts };
  hydrateFromCache();
  if (store.role) { attachData(); queueMicrotask(() => handlers.onRoleChange(store.role)); }

  rootUnsubs.push(onValue(ref(db, '.info/connected'), (snap) => { store.connected = snap.val() === true; store.changed('connection'); maybeSeed(); }));
  rootUnsubs.push(onValue(ref(db, `roles/${uid}`), (snap) => {
    store.role = snap.val() || null;
    if (store.role) attachData(); else { detachData(); storageRemove(cacheKey()); }
    handlers.onRoleChange(store.role);
  }, (err) => { store.role = null; detachData(); handlers.onRoleChange(null, err); }));
  unsubCache = store.subscribe(saveCacheSoon);
}

export function stopSync({ clearLocal = false } = {}) {
  detachData();
  rootUnsubs.forEach((u) => u());
  rootUnsubs = [];
  unsubCache?.();
  if (clearLocal && uid) { storageRemove(cacheKey()); storageRemove(journalKey(), 'local'); storageRemove(journalKey(), 'session'); }
  uid = null;
  Object.assign(store, { uid: null, user: null, role: undefined, fromCache: false, departments: new Map(), people: new Map(), tasks: new Map(), meta: {} });
  for (const k of Object.keys(store.loaded)) store.loaded[k] = false;
}

function attachData() {
  if (dataUnsubs.length) return;
  for (const name of COLLECTIONS) {
    dataUnsubs.push(onValue(ref(db, `${base()}/${name}`), (snap) => {
      store[name] = toMap(snap.val());
      store.loaded[name] = true;
      if (COLLECTIONS.every((k) => store.loaded[k])) store.fromCache = false;
      store.changed(name);
      if (name === 'departments') maybeSeed();
    }, onListenError));
  }
  dataUnsubs.push(onValue(ref(db, `${base()}/meta`), (snap) => { store.meta = snap.val() || {}; store.loaded.meta = true; maybeSeed(); }, onListenError));
  replayJournal();
}

function detachData() { dataUnsubs.forEach((u) => u()); dataUnsubs = []; }

function onListenError(err) {
  console.warn('[data] listener cancelled:', err?.message || err);
  if (isPermissionError(err)) handlers.onPermissionDenied(err);
}

export const isPermissionError = (err) => /permission[_ ]denied/i.test(`${err?.code || ''} ${err?.message || ''}`);

const toMap = (obj) => new Map(Object.entries(obj || {}).filter(([, v]) => v && typeof v === 'object').map(([id, v]) => [id, { ...v, id }]));

/** First run: add a starter list of departments (once per account; they can be renamed or deleted). */
let seeding = false;
function maybeSeed() {
  if (seeding || !uid || !store.role || !store.connected || !store.loaded.meta || !store.loaded.departments || store.meta.seeded) return;
  seeding = true;
  const updates = { 'meta/seeded': true, 'meta/createdAt': Date.now() };
  if (!store.departments.size) {
    for (const name of DEFAULT_DEPARTMENTS) updates[`departments/${newKey('departments')}`] = { name, createdAt: Date.now() };
  }
  commit(updates, 'setup');
}

/* ================================================================ Writes + offline queue */

const journalArea = () => (remember ? 'local' : 'session');
const journalKey = () => `dt-journal-v1-${uid}`;
const cacheKey = () => `dt-cache-v1-${uid}`;
const readJournal = () => storageGet(journalKey(), [], journalArea()) || [];
const writeJournal = (list) => storageSet(journalKey(), list, journalArea());
export const pendingChangeCount = () => (uid ? readJournal().length : 0);
const newKey = (col) => push(ref(db, `${base()}/${col}`)).key;

function commit(updates, label) {
  if (!uid) throw new Error('Not signed in');
  for (const [k, v] of Object.entries(updates)) if (v === undefined) throw new Error(`undefined value at ${k}`);
  const entry = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, updates, label };
  writeJournal([...readJournal(), entry]);
  applyLocal(updates);
  send(entry);
}

function send(entry) {
  store.changed('sync');
  update(ref(db, base()), entry.updates)
    .then(() => { writeJournal(readJournal().filter((e) => e.id !== entry.id)); store.changed('sync'); })
    .catch((err) => {
      writeJournal(readJournal().filter((e) => e.id !== entry.id));
      store.changed('sync');
      handlers.onWriteError(err, entry.label);
      if (isPermissionError(err)) handlers.onPermissionDenied(err);
    });
}

function replayJournal() {
  for (const e of readJournal()) { applyLocal(e.updates); send(e); }
}

function applyLocal(updates) {
  const touched = new Set();
  for (const [path, value] of Object.entries(updates)) {
    const [col, id, ...rest] = path.split('/');
    if (col === 'meta') { store.meta = { ...store.meta, [id]: value }; continue; }
    if (!COLLECTIONS.includes(col) || !id) continue;
    const map = store[col];
    if (!rest.length) { if (value === null) map.delete(id); else map.set(id, { ...structuredClone(value), id }); }
    else {
      const rec = structuredClone(map.get(id) || { id });
      let o = rec;
      for (let i = 0; i < rest.length - 1; i++) { if (!o[rest[i]] || typeof o[rest[i]] !== 'object') o[rest[i]] = {}; o = o[rest[i]]; }
      if (value === null) delete o[rest[rest.length - 1]]; else o[rest[rest.length - 1]] = structuredClone(value);
      map.set(id, rec);
    }
    touched.add(col);
  }
  touched.forEach((c) => store.changed(c));
}

/* ================================================================ Local cache (opens offline) */

let unsubCache = null;
function hydrateFromCache() {
  if (!remember) return;
  const c = storageGet(cacheKey(), null);
  if (!c || c.v !== 1) return;
  for (const name of COLLECTIONS) store[name] = toMap(c[name]);
  store.meta = c.meta || {};
  store.role = c.role || undefined;
  store.fromCache = true;
  store.changed('cache');
}
function saveCacheNow() {
  if (!uid || !remember || !store.role || !store.isLoaded()) return;
  const strip = (map) => Object.fromEntries([...map.entries()].map(([id, { id: _x, ...rest }]) => [id, rest]));
  storageSet(cacheKey(), { v: 1, role: store.role, meta: store.meta, departments: strip(store.departments), people: strip(store.people), tasks: strip(store.tasks) });
}
const saveCacheSoon = debounce(saveCacheNow, 800);
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', saveCacheNow);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveCacheNow(); });
}

/* ================================================================ Validation helpers */

const validId = (v) => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);
const PHONE_RE = /^[0-9+() .-]*$/;

/** Resolve person/department choice into stored ids + name snapshots (the person's department wins). */
function contactFields({ personId, departmentId }) {
  const p = store.person(validId(personId));
  const d = store.department(p ? p.departmentId : validId(departmentId));
  return { personId: p ? p.id : null, personName: p ? p.name : null, departmentId: d ? d.id : null, departmentName: d ? d.name : null };
}

function historyEntry(type, note, contact, holdUntil = null) {
  const e = { at: Date.now(), date: todayStr(), type };
  if (note) e.note = note;
  if (holdUntil) e.holdUntil = holdUntil;
  for (const k of ['personId', 'personName', 'departmentId', 'departmentName']) if (contact && contact[k]) e[k] = contact[k];
  return e;
}

/* ================================================================ Tasks */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * Check a follow-up ("on hold until") date. Empty = no hold.
 * Must be after today; Saturday/Sunday move to the following Monday.
 */
export function cleanHoldDate(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  if (!DATE_RE.test(v) || !parseDate(v)) throw new ValidationError('Choose a valid follow-up date.');
  const today = todayStr();
  if (v <= today) throw new ValidationError('The follow-up date must be after today.');
  if (v > toDateStr(addDays(parseDate(today), 730))) throw new ValidationError('Choose a follow-up date within the next 2 years.');
  return workingDayOnOrAfter(v);
}

export function addTask({ title, currentStatus, personId, departmentId, daily = false }) {
  const t = cleanText(title, 300);
  if (!t) throw new ValidationError('Write what the task is.');
  const note = cleanText(currentStatus, 2000, { multiline: true });
  const contact = contactFields({ personId, departmentId });
  const id = newKey('tasks');
  const now = Date.now();
  const rec = { title: t, status: 'open', createdDate: todayStr(), createdAt: now, updatedAt: now, lastUpdateAt: now };
  if (note) rec.currentStatus = note;
  for (const [k, v] of Object.entries(contact)) if (v) rec[k] = v;
  if (daily) { rec.daily = true; rec.dailySince = rec.createdDate; }
  rec.updates = { [newKey('tasks')]: historyEntry('created', note, contact) };
  commit({ [`tasks/${id}`]: rec }, 'task');
  return id;
}

/**
 * Record what the contact said, and who gives the next update.
 * `holdUntil` (optional): the date they promised — the task is on hold until then and pops up again that day.
 * Leaving it empty takes the task off hold.
 */
export function addUpdate(taskId, { note, personId, departmentId, holdUntil = null }) {
  const t = store.tasks.get(taskId);
  if (!t) throw new Error('Task not found');
  const text = cleanText(note, 2000, { multiline: true });
  if (!text) throw new ValidationError('Write the latest status.');
  const hold = t.daily === true ? null : cleanHoldDate(holdUntil);
  const contact = contactFields({ personId, departmentId });
  const now = Date.now();
  const p = `tasks/${taskId}`;
  commit({
    [`${p}/currentStatus`]: text,
    [`${p}/personId`]: contact.personId, [`${p}/personName`]: contact.personName,
    [`${p}/departmentId`]: contact.departmentId, [`${p}/departmentName`]: contact.departmentName,
    [`${p}/holdUntil`]: hold,
    [`${p}/lastUpdateAt`]: now, [`${p}/updatedAt`]: now,
    [`${p}/updates/${newKey('tasks')}`]: historyEntry('update', text, contact, hold),
  }, 'update');
  return hold;
}

/** Bring an on-hold task back to the list now. */
export function resumeTask(taskId) {
  const now = Date.now();
  const p = `tasks/${taskId}`;
  commit({
    [`${p}/holdUntil`]: null, [`${p}/updatedAt`]: now,
    [`${p}/updates/${newKey('tasks')}`]: historyEntry('resumed', null, null),
  }, 'resume');
}

/** Turn a task into an everyday task (comes back unticked every working day), or back into a normal follow-up. */
export function setDaily(taskId, on) {
  const t = store.tasks.get(taskId);
  if (!t) throw new Error('Task not found');
  const now = Date.now();
  const p = `tasks/${taskId}`;
  const today = todayStr();
  const updates = {
    [`${p}/daily`]: on ? true : null, [`${p}/dailySince`]: on ? today : null,
    [`${p}/updatedAt`]: now,
    [`${p}/updates/${newKey('tasks')}`]: historyEntry(on ? 'daily-on' : 'daily-off', null, null),
  };
  if (on) {
    updates[`${p}/holdUntil`] = null;
    if (!isOpen(t)) Object.assign(updates, { [`${p}/status`]: 'open', [`${p}/closedAt`]: null, [`${p}/closedDate`]: null });
  } else {
    updates[`${p}/doneDates`] = null;
    // A normal task starts its own clock today, so a long-running routine doesn't show up as critical.
    updates[`${p}/createdDate`] = today;
  }
  commit(updates, 'task');
}

/** Tick / untick an everyday task for a day. */
export function setDailyDone(taskId, dayStr, done) {
  if (!DATE_RE.test(dayStr)) throw new Error('Bad date');
  commit({ [`tasks/${taskId}/doneDates/${dayStr}`]: done ? Date.now() : null }, 'tick');
}

/** Final step: completed or failed. The task stops carrying over and is shown struck through. */
export function closeTask(taskId, outcome, note) {
  const t = store.tasks.get(taskId);
  if (!t) throw new Error('Task not found');
  if (outcome !== 'completed' && outcome !== 'failed') throw new Error('Bad outcome');
  const text = cleanText(note, 2000, { multiline: true });
  const now = Date.now();
  const p = `tasks/${taskId}`;
  const updates = {
    [`${p}/status`]: outcome, [`${p}/closedAt`]: now, [`${p}/closedDate`]: todayStr(), [`${p}/holdUntil`]: null,
    [`${p}/lastUpdateAt`]: now, [`${p}/updatedAt`]: now,
    [`${p}/updates/${newKey('tasks')}`]: historyEntry(outcome, text, null),
  };
  if (text) updates[`${p}/currentStatus`] = text;
  commit(updates, outcome);
}

export function reopenTask(taskId) {
  const now = Date.now();
  const p = `tasks/${taskId}`;
  commit({
    [`${p}/status`]: 'open', [`${p}/closedAt`]: null, [`${p}/closedDate`]: null, [`${p}/lastUpdateAt`]: now, [`${p}/updatedAt`]: now,
    [`${p}/updates/${newKey('tasks')}`]: historyEntry('reopened', null, null),
  }, 'reopen');
}

export function renameTask(taskId, title) {
  const t = cleanText(title, 300);
  if (!t) throw new ValidationError('Write what the task is.');
  commit({ [`tasks/${taskId}/title`]: t, [`tasks/${taskId}/updatedAt`]: Date.now() }, 'task');
}

export function deleteTask(taskId) { commit({ [`tasks/${taskId}`]: null }, 'delete'); }

/* ================================================================ Departments */

function cleanDeptName(name, exceptId) {
  const n = cleanText(name, 60);
  if (!n) throw new ValidationError('Enter a department name.');
  if (store.list('departments').some((d) => d.id !== exceptId && d.name.toLowerCase() === n.toLowerCase())) throw new ValidationError(`“${n}” already exists.`);
  return n;
}

export function addDepartment(name) {
  const id = newKey('departments');
  commit({ [`departments/${id}`]: { name: cleanDeptName(name), createdAt: Date.now() } }, 'department');
  return id;
}

export function renameDepartment(id, name) {
  commit({ [`departments/${id}/name`]: cleanDeptName(name, id), [`departments/${id}/updatedAt`]: Date.now() }, 'department');
}

export function deleteDepartment(id) {
  const people = store.list('people').filter((p) => p.departmentId === id).length;
  if (people) throw new ValidationError(`Move or delete the ${people} ${people === 1 ? 'person' : 'people'} in this department first.`);
  const openTasks = store.list('tasks').filter((t) => isOpen(t) && t.departmentId === id).length;
  if (openTasks) throw new ValidationError(`${openTasks} open task${openTasks === 1 ? ' is' : 's are'} waiting on this department.`);
  commit({ [`departments/${id}`]: null }, 'department');
}

/* ================================================================ People */

function cleanPerson({ name, departmentId, phone }) {
  const n = cleanText(name, 80);
  if (!n) throw new ValidationError('Enter the person’s name.');
  const d = store.department(validId(departmentId));
  if (!d) throw new ValidationError('Choose a department.');
  const ph = cleanText(phone, 30);
  if (ph && !PHONE_RE.test(ph)) throw new ValidationError('Phone can contain only digits, spaces, +, -, ( and ).');
  return { name: n, departmentId: d.id, phone: ph || null };
}

export function addPerson(input) {
  const id = newKey('people');
  const p = cleanPerson(input);
  const rec = { name: p.name, departmentId: p.departmentId, createdAt: Date.now(), updatedAt: Date.now() };
  if (p.phone) rec.phone = p.phone;
  commit({ [`people/${id}`]: rec }, 'person');
  return id;
}

/** Edit a person. If their department changes, open tasks waiting on them move with them. */
export function updatePerson(id, input) {
  const cur = store.person(id);
  if (!cur) throw new Error('Person not found');
  const p = cleanPerson({ ...cur, ...input });
  const now = Date.now();
  const updates = { [`people/${id}/name`]: p.name, [`people/${id}/departmentId`]: p.departmentId, [`people/${id}/phone`]: p.phone, [`people/${id}/updatedAt`]: now };
  const deptName = store.department(p.departmentId).name;
  for (const t of store.list('tasks')) {
    if (!isOpen(t) || t.personId !== id) continue;
    updates[`tasks/${t.id}/personName`] = p.name;
    updates[`tasks/${t.id}/departmentId`] = p.departmentId;
    updates[`tasks/${t.id}/departmentName`] = deptName;
  }
  commit(updates, 'person');
}

export function deletePerson(id) {
  const open = store.list('tasks').filter((t) => isOpen(t) && t.personId === id).length;
  if (open) throw new ValidationError(`${open} open task${open === 1 ? ' is' : 's are'} waiting on this person. Pass ${open === 1 ? 'it' : 'them'} to someone else first.`);
  commit({ [`people/${id}`]: null }, 'person');
}

/* ================================================================ Backup */

export function exportAll() {
  const strip = (map) => Object.fromEntries([...map.entries()].map(([id, { id: _x, ...rest }]) => [id, rest]));
  return { app: 'Daily Tracker', exportedAt: new Date().toISOString(), departments: strip(store.departments), people: strip(store.people), tasks: strip(store.tasks) };
}
