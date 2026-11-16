// js/app.js — start-up, login guard, navigation and the account menu.

import { configured, auth } from './firebase.js';
import { requireAuth, watchSession, rememberedDevice, signOutUser } from './auth.js';
import * as data from './data.js';
import { store } from './data.js';
import { h, clear, add, todayStr, downloadFile } from './utils.js';
import { icon, toast, popMenu, closeAllModals, closeMenu, confirmDialog } from './ui.js';
import { registerServiceWorker, canPromptInstall, promptInstall, isIOS, isStandalone } from './pwa.js';
import { parseHash } from './app-nav.js';
import { openAddTask } from './components.js';
import { isOpen, isCritical } from './workdays.js';
import today from './views/today.js';
import dashboard from './views/dashboard.js';
import all from './views/all.js';
import people from './views/people.js';

const VIEWS = { today, dashboard, all, people };
const NAV = [['today', 'Today', 'list-checks'], ['dashboard', 'Dashboard', 'layout-dashboard'], ['all', 'All tasks', 'search'], ['people', 'People', 'users']];

let root, viewEl, syncEl, shellReady = false, signingOut = false, current = null, lastDay = todayStr();

async function boot() {
  root = document.getElementById('root');
  if (!configured) { location.replace('login.html'); return; }
  const user = await requireAuth();
  registerServiceWorker({ onUpdate: (apply) => toast('A new version is available.', { timeout: 0, action: { label: 'Reload', fn: apply } }) });
  data.startSync(user, {
    remember: rememberedDevice(),
    onRoleChange: (role) => (role ? showApp() : showNotAuthorised()),
    onPermissionDenied: () => { if (!auth.currentUser) sessionEnded(); else if (store.role) showRulesProblem(); },
    onWriteError: (err, label) => toast(`Couldn’t save (${label}): ${data.isPermissionError(err) ? 'permission denied' : err.message}`, { type: 'error', timeout: 7000 }),
  });
  watchSession(() => { if (!signingOut) sessionEnded(); });
  setTimeout(() => { if (store.role === undefined) showMessage('cloud-off', 'Can’t reach Firebase', navigator.onLine === false ? 'You appear to be offline. Connect once on this device so the app can open offline next time.' : 'The database isn’t responding. Check your connection and try again.'); }, 15000);
  store.subscribe(onChange);
  // New day? Re-render so the date and carried-over tasks update automatically.
  setInterval(() => { const d = todayStr(); if (d !== lastDay) { lastDay = d; current?.view.refresh(); updateBadges(); } updateSync(); }, 30000);
  window.addEventListener('online', updateSync);
  window.addEventListener('offline', updateSync);
}

function sessionEnded() {
  data.stopSync();
  location.replace('login.html?reason=expired');
}

async function signOut() {
  const pending = data.pendingChangeCount();
  if (pending && !(await confirmDialog({ title: 'Unsynced changes', message: `${pending} change(s) haven’t reached Firebase yet. Signing out will discard them.`, confirmText: 'Sign out anyway', danger: true }))) return;
  signingOut = true;
  data.stopSync({ clearLocal: true });
  try { await signOutUser(); } catch { /* ignore */ }
  location.replace('login.html?reason=signedout');
}

/* ---------------------------------------------------------------- Shell */

function showApp() {
  hideSplash();
  if (shellReady) return;
  shellReady = true;
  clear(root);
  syncEl = h('span', { class: 'sync', role: 'status' });
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'Main' }, NAV.map(([id, label, ic]) => h('a', { href: `#/${id}`, dataset: { route: id } }, icon(ic, { size: 17 }), h('span', {}, label), id === 'dashboard' ? h('i', { class: 'crit-dot', hidden: true }) : null)));
  const header = h('header', { class: 'header' },
    h('a', { class: 'brand', href: '#/today' }, h('span', { class: 'logo' }, icon('list-checks', { size: 18 })), h('span', {}, 'Daily Tracker')),
    tabs,
    h('div', { class: 'header-right' }, syncEl,
      h('button', { class: 'icon-btn ghost', type: 'button', 'aria-label': 'Menu', onClick: (e) => openMenu(e.currentTarget) }, icon('ellipsis', { size: 20 }))));
  viewEl = h('main', { class: 'main', id: 'main' });
  const bottom = h('nav', { class: 'bottom', 'aria-label': 'Main' },
    NAV.slice(0, 2).map(navLink), h('button', { class: 'fab', type: 'button', 'aria-label': 'Add task', onClick: openAddTask }, icon('plus', { size: 24 })), NAV.slice(2).map(navLink));
  add(root, header, viewEl, bottom);
  window.addEventListener('hashchange', route);
  route();
  updateSync();
}

const navLink = ([id, label, ic]) => h('a', { href: `#/${id}`, dataset: { route: id } }, icon(ic, { size: 20 }), h('span', {}, label), id === 'dashboard' ? h('i', { class: 'crit-dot', hidden: true }) : null);

function route() {
  closeMenu(); closeAllModals();
  const r = parseHash();
  const name = VIEWS[r.name] ? r.name : 'today';
  clear(viewEl);
  current = { name, view: VIEWS[name] };
  document.title = `${current.view.title} — Daily Tracker`;
  root.querySelectorAll('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  current.view.mount(viewEl, r);
  window.scrollTo({ top: 0 });
  updateBadges();
}

function onChange(keys) {
  if (!shellReady) return;
  if (keys.has('connection') || keys.has('sync')) updateSync();
  if (['tasks', 'people', 'departments', 'cache'].some((k) => keys.has(k))) { current?.view.refresh(); updateBadges(); }
}

function updateBadges() {
  const t = todayStr();
  const crit = store.list('tasks').filter((x) => isOpen(x) && isCritical(x, t)).length;
  root.querySelectorAll('.crit-dot').forEach((el) => { el.hidden = !crit; el.textContent = crit > 9 ? '9+' : String(crit); });
}

function updateSync() {
  if (!syncEl) return;
  const pending = data.pendingChangeCount();
  const online = store.connected && navigator.onLine !== false;
  syncEl.className = `sync ${online ? (pending ? 'busy' : 'ok') : 'off'}`;
  clear(syncEl);
  add(syncEl, h('i'), h('span', {}, online ? (pending ? 'Saving…' : 'Saved') : pending ? `Offline · ${pending} waiting` : 'Offline'));
  syncEl.title = online ? 'All changes are saved to Firebase.' : 'No connection. Changes are kept on this device and sync when you are back online.';
}

function openMenu(anchor) {
  const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  popMenu(anchor, [
    { heading: store.user?.email || '' },
    { label: theme === 'dark' ? 'Light theme' : 'Dark theme', icon: theme === 'dark' ? 'sun' : 'moon', onClick: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
    { label: 'Download backup', icon: 'download', onClick: () => downloadFile(`daily-tracker-backup-${todayStr()}.json`, JSON.stringify(data.exportAll(), null, 2)) },
    !isStandalone() ? { label: 'Install app', icon: 'smartphone', onClick: install } : null,
    { separator: true },
    { label: 'Sign out', icon: 'log-out', danger: true, onClick: signOut },
  ]);
}

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('dt-theme', t); } catch { /* ignore */ }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#f3f5f9' : '#0a0b0f');
}

async function install() {
  if (canPromptInstall()) { await promptInstall(); return; }
  toast(isIOS() ? 'On iPhone: tap Share (□↑) in Safari, then “Add to Home Screen”.' : 'Use your browser menu → “Install app” or “Add to Home screen”.', { timeout: 8000 });
}

/* ---------------------------------------------------------------- Full-page messages */

function hideSplash() { document.getElementById('splash')?.remove(); }

function showMessage(ic, title, text, extra = []) {
  if (shellReady) return;
  hideSplash();
  clear(root);
  add(root, h('div', { class: 'center' }, h('div', { class: 'card center-card' },
    h('div', { class: 'big-icon' }, icon(ic, { size: 24 })), h('h1', {}, title), h('p', { class: 'muted' }, text), ...extra,
    h('div', { class: 'row' },
      h('button', { class: 'btn btn-primary', type: 'button', onClick: () => location.reload() }, icon('refresh-cw', { size: 16 }), 'Try again'),
      h('button', { class: 'btn btn-ghost', type: 'button', onClick: signOut }, icon('log-out', { size: 16 }), 'Sign out')))));
}

function showNotAuthorised() {
  shellReady = false;
  const uid = store.uid || auth.currentUser?.uid || '';
  showMessage('lock', 'Account not authorised yet', `Signed in as ${auth.currentUser?.email || ''}. In Firebase Console → Realtime Database → Data, add  roles → ${uid} : "owner".`,
    [h('div', { class: 'code' }, uid), h('button', { class: 'btn btn-sm', type: 'button', onClick: () => navigator.clipboard?.writeText(uid).then(() => toast('UID copied', { type: 'success' })) }, icon('copy', { size: 14 }), 'Copy UID')]);
}

function showRulesProblem() {
  shellReady = false;
  showMessage('lock', 'Database rules need updating', 'Your account is authorised, but the database rules don’t allow the new tracker yet. Open Firebase Console → Realtime Database → Rules, paste the contents of database.rules.json and click Publish.');
}

try { const t = localStorage.getItem('dt-theme'); if (t) setTheme(t); } catch { /* ignore */ }
boot().catch((err) => { console.error(err); showMessage('triangle-alert', 'The app failed to start', String(err.message || err)); });
