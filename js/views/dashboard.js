// js/views/dashboard.js — one-screen summary: counts, critical tasks, who you're waiting on, departments, recent activity.

import { h, clear, add, todayStr, formatDate, timeAgo, pct, parseDate } from '../utils.js';
import { icon, emptyState, skeleton } from '../ui.js';
import { store } from '../data.js';
import { isFollowUp, isCritical, isOnHold, isHoldDue, activeDays, dailyForDay, sortHold, historyOf, CRITICAL_DAYS } from '../workdays.js';
import { openTaskSheet, TYPE_LABEL } from '../components.js';
import { navigate } from '../app-nav.js';

const view = {
  title: 'Dashboard',
  mount(root) { this.root = root; this.refresh(); },
  refresh() {
    const root = this.root;
    if (!root) return;
    clear(root);
    const today = todayStr();
    add(root, h('div', { class: 'page-head' }, h('h1', {}, 'Dashboard'), h('p', {}, formatDate(new Date(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))));
    if (!store.isLoaded()) { add(root, skeleton(4, { height: 100 })); return; }

    const tasks = store.list('tasks');
    const open = tasks.filter(isFollowUp); // everyday tasks are counted separately
    const onHold = sortHold(open.filter((t) => isOnHold(t, today)));
    const active = open.filter((t) => !isOnHold(t, today));
    const due = active.filter((t) => isHoldDue(t, today));
    const daily = dailyForDay(tasks, today);
    const dailyDone = daily.filter((d) => d.done).length;
    const critical = open.filter((t) => isCritical(t, today)).sort((a, b) => activeDays(b, today) - activeDays(a, today));
    const month = today.slice(0, 7);
    const completed = tasks.filter((t) => t.status === 'completed');
    const failed = tasks.filter((t) => t.status === 'failed');
    const updatedToday = tasks.filter((t) => historyOf(t).some((u) => u.date === today && u.type !== 'created')).length;
    const addedToday = tasks.filter((t) => t.createdDate === today).length;

    const tile = (label, value, tone, hash, sub) => h('button', { class: `kpi ${tone}`, type: 'button', onClick: () => navigate(hash) },
      h('span', { class: 'kpi-label' }, label), h('strong', {}, String(value)), sub ? h('span', { class: 'kpi-sub' }, sub) : null);
    add(root, h('div', { class: 'kpis' },
      tile('Open', open.length, '', '#/all?filter=open', `${active.length} active · ${onHold.length} on hold`),
      tile('Critical', critical.length, critical.length ? 'red' : '', '#/all?filter=critical', `waiting > ${CRITICAL_DAYS} working days`),
      tile('On hold', onHold.length, onHold.length ? 'violet' : '', '#/all?filter=hold', onHold.length ? `next back ${shortDay(onHold[0].holdUntil)}` : 'none'),
      daily.length ? tile('Every day', `${dailyDone}/${daily.length}`, dailyDone === daily.length ? 'green' : '', '#/today', 'done today') : null,
      tile('Updated today', updatedToday, 'blue', '#/today'),
      tile('Added today', addedToday, '', '#/today', due.length ? `${due.length} follow-up due` : null),
      tile('Completed', completed.length, 'green', '#/all?filter=completed', `${completed.filter((t) => (t.closedDate || '').startsWith(month)).length} this month`),
      tile('Failed', failed.length, failed.length ? 'amber' : '', '#/all?filter=failed', `${failed.filter((t) => (t.closedDate || '').startsWith(month)).length} this month`)));

    const grid = h('div', { class: 'dash' });
    add(root, grid);

    // Critical tasks
    add(grid, card('Critical tasks', `Open more than ${CRITICAL_DAYS} working days`, 'flame',
      critical.length
        ? h('div', { class: 'rows' }, critical.slice(0, 8).map((t) => row(t, today)), critical.length > 8 ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => navigate('#/all?filter=critical') }, `View all ${critical.length}`) : null)
        : emptyState({ iconName: 'circle-check', title: 'Nothing critical', text: 'Every open task is within 5 working days.' }), 'span-2'));

    // On hold — hidden from Today until their follow-up date
    add(grid, card('On hold', 'Waiting for the date they gave you', 'pause',
      onHold.length
        ? h('div', { class: 'rows' }, onHold.slice(0, 10).map((t) => holdRow(t, today)), onHold.length > 10 ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onClick: () => navigate('#/all?filter=hold') }, `View all ${onHold.length}`) : null)
        : emptyState({ iconName: 'calendar-clock', title: 'Nothing on hold', text: 'When someone gives you a date, enter it in Update — the task is hidden until then.' })));

    // Waiting on — people
    const byPerson = new Map();
    for (const t of active) {
      const c = store.contactOf(t);
      const key = t.personId || (c.personName ? `name:${c.personName}` : c.departmentName ? `dept:${c.departmentName}` : 'none');
      if (!byPerson.has(key)) byPerson.set(key, { name: c.personName || c.departmentName || 'No contact', dept: c.personName ? c.departmentName : '', personId: t.personId, n: 0, crit: 0, oldest: 0 });
      const e = byPerson.get(key);
      e.n++; if (isCritical(t, today)) e.crit++; e.oldest = Math.max(e.oldest, activeDays(t, today));
    }
    const people = [...byPerson.values()].sort((a, b) => b.crit - a.crit || b.n - a.n);
    add(grid, card('Waiting on', 'Who owes you an update', 'users',
      people.length ? h('div', { class: 'rows' }, people.slice(0, 8).map((p) => h('button', { class: 'row-btn', type: 'button', onClick: () => p.personId && navigate(`#/all?person=${p.personId}`) },
        h('div', { class: 'row-main' }, h('strong', {}, p.name), p.dept ? h('span', { class: 'muted xs' }, p.dept) : null),
        p.crit ? h('span', { class: 'badge b-critical' }, `${p.crit} critical`) : null,
        h('span', { class: 'count' }, String(p.n)),
        h('span', { class: 'muted xs oldest' }, `oldest ${p.oldest}d`))))
        : emptyState({ iconName: 'users', title: 'No open follow-ups' })));

    // Departments
    const byDept = new Map();
    for (const t of open) {
      const name = store.contactOf(t).departmentName || 'No department';
      if (!byDept.has(name)) byDept.set(name, { name, n: 0, crit: 0, hold: 0 });
      const e = byDept.get(name); e.n++; if (isCritical(t, today)) e.crit++; if (isOnHold(t, today)) e.hold++;
    }
    const depts = [...byDept.values()].sort((a, b) => b.n - a.n);
    const max = Math.max(1, ...depts.map((d) => d.n));
    add(grid, card('By department', 'Open tasks (red = critical, purple = on hold)', 'building-2',
      depts.length ? h('div', { class: 'bars' }, depts.map((d) => h('div', { class: 'bar-row' },
        h('span', { class: 'bar-name' }, d.name),
        h('div', { class: 'bar-track' }, h('div', { class: 'bar-fill', style: { width: `${(d.n / max) * 100}%` } },
          d.crit ? h('div', { class: 'bar-crit', style: { width: `${(d.crit / d.n) * 100}%` } }) : null,
          d.hold ? h('div', { class: 'bar-hold', style: { width: `${(d.hold / d.n) * 100}%` } }) : null)),
        h('span', { class: 'count' }, String(d.n)))))
        : emptyState({ iconName: 'building-2', title: 'No open tasks' })));

    // Outcome
    const closedTotal = completed.length + failed.length;
    add(grid, card('Outcome', 'All closed tasks', 'circle-check',
      closedTotal ? h('div', { class: 'stack' },
        h('div', { class: 'outcome-bar' }, h('div', { class: 'ok', style: { width: `${pct(completed.length, closedTotal)}%` } }), h('div', { class: 'ko', style: { width: `${pct(failed.length, closedTotal)}%` } })),
        h('div', { class: 'outcome-legend' },
          h('span', {}, h('i', { class: 'dot ok' }), `Completed ${completed.length} (${pct(completed.length, closedTotal)}%)`),
          h('span', {}, h('i', { class: 'dot ko' }), `Failed ${failed.length} (${pct(failed.length, closedTotal)}%)`)))
        : emptyState({ iconName: 'circle-check', title: 'Nothing closed yet' })));

    // Recent activity
    const activity = tasks.flatMap((t) => historyOf(t).map((u) => ({ ...u, task: t }))).sort((a, b) => b.at - a.at).slice(0, 10);
    add(grid, card('Recent activity', 'Latest updates', 'history',
      activity.length ? h('ol', { class: 'activity' }, activity.map((u) => h('li', { onClick: () => openTaskSheet(u.task.id) },
        h('span', { class: `act-dot act-${u.type}` }),
        h('div', {}, h('div', {}, h('strong', {}, TYPE_LABEL[u.type] || u.type), ' · ', u.task.title),
          u.note ? h('div', { class: 'muted sm clamp' }, u.note) : null,
          u.holdUntil ? h('div', { class: 'muted xs' }, `On hold until ${shortDay(u.holdUntil)}`) : null,
          h('div', { class: 'muted xs' }, timeAgo(u.at))))))
        : emptyState({ iconName: 'history', title: 'No activity yet' }), 'span-2'));
  },
};

function card(title, sub, iconName, content, cls = '') {
  return h('section', { class: `card ${cls}` },
    h('div', { class: 'card-head' }, h('span', { class: 'card-icon' }, icon(iconName, { size: 16 })), h('div', {}, h('h3', {}, title), h('p', {}, sub))),
    content);
}

function row(t, today) {
  const c = store.contactOf(t);
  return h('button', { class: 'row-btn', type: 'button', onClick: () => openTaskSheet(t.id) },
    h('div', { class: 'row-main' }, h('strong', {}, t.title), h('span', { class: 'muted xs' }, [c.personName, c.departmentName].filter(Boolean).join(' · ') || 'No contact')),
    h('span', { class: 'badge b-critical' }, `${activeDays(t, today)} days`));
}

const shortDay = (d) => formatDate(d, { weekday: 'short', day: 'numeric', month: 'short' });

function holdRow(t, today) {
  const c = store.contactOf(t);
  const days = Math.round((parseDate(t.holdUntil) - parseDate(today)) / 86400000);
  return h('button', { class: 'row-btn', type: 'button', onClick: () => openTaskSheet(t.id) },
    h('div', { class: 'row-main' }, h('strong', {}, t.title), h('span', { class: 'muted xs' }, [c.personName, c.departmentName].filter(Boolean).join(' · ') || 'No contact')),
    h('span', { class: 'badge b-hold' }, shortDay(t.holdUntil)),
    h('span', { class: 'muted xs oldest' }, days === 1 ? 'tomorrow' : `in ${days}d`));
}

export default view;
