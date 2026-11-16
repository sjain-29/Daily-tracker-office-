// js/views/today.js — the daily list. Open tasks carry over to every new day until completed or failed.

import { h, clear, add, todayStr, toDateStr, parseDate, addDays, formatDate } from '../utils.js';
import { icon, emptyState, skeleton } from '../ui.js';
import { store } from '../data.js';
import { tasksForDay, dailyForDay, sortOpen, sortHold, isCritical, isHoldDue, isHolidayStr, holdOnDay, nextWorkingDay } from '../workdays.js';
import { taskCard, dailyCard, openAddTask } from '../components.js';
import { navigate } from '../app-nav.js';

const view = {
  title: 'Today',
  mount(root, route) {
    this.root = root;
    const q = route.query.get('date');
    this.day = q && parseDate(q) && q <= todayStr() ? q : null; // null = follow today automatically
    this.refresh();
  },
  refresh() {
    const root = this.root;
    if (!root) return;
    clear(root);
    const today = todayStr();
    const day = this.day && this.day < today ? this.day : today;
    const isToday = day === today;
    const d = parseDate(day);
    const holiday = isHolidayStr(day);
    const step = (n) => {
      const next = toDateStr(addDays(d, n));
      if (next > today) return;
      navigate(next === today ? '#/today' : `#/today?date=${next}`);
    };

    add(root, h('div', { class: 'day-bar' },
      h('div', { class: 'day-title' },
        h('h1', {}, isToday ? 'Today' : formatDate(d, { weekday: 'long' })),
        h('p', {}, formatDate(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))),
      h('div', { class: 'day-nav' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Previous day', onClick: () => step(-1) }, icon('chevron-left')),
        !isToday ? h('button', { class: 'btn btn-sm', type: 'button', onClick: () => navigate('#/today') }, 'Today') : null,
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Next day', disabled: isToday, onClick: () => step(1) }, icon('chevron-right'))),
      h('button', { class: 'btn btn-primary add-btn', type: 'button', onClick: openAddTask }, icon('plus', { size: 17 }), 'Add task')));

    if (holiday) {
      add(root, h('div', { class: 'holiday' }, icon('tree-palm', { size: 18 }),
        h('div', {}, h('strong', {}, `${formatDate(d, { weekday: 'long' })} — holiday`),
          h('span', {}, isToday ? ` Open tasks carry over to ${formatDate(nextWorkingDay(day), { weekday: 'long', day: 'numeric', month: 'short' })} and everyday tasks start again then. Weekends don’t count towards “days open”.` : ' Weekends don’t count towards “days open”.'))));
    }

    if (!store.isLoaded()) { add(root, skeleton(4, { height: 120 })); return; }
    const all = store.list('tasks');
    const { open, onHold, closed } = tasksForDay(all, day, today);
    const daily = dailyForDay(all, day);
    const sorted = sortOpen(open, today);
    const critical = open.filter((t) => isCritical(t, today)).length;
    const due = isToday ? open.filter((t) => isHoldDue(t, today)).length : 0;
    const dailyDone = daily.filter((d) => d.done).length;

    add(root, h('div', { class: 'day-summary' },
      chip(`${open.length} open`, ''),
      critical ? chip(`${critical} critical`, 'red') : null,
      due ? chip(`${due} follow-up due`, 'blue') : null,
      chip(`${open.filter((t) => t.createdDate < day).length} carried over`, 'muted'),
      onHold.length ? chip(`${onHold.length} on hold`, 'violet') : null,
      daily.length ? chip(`Every day ${dailyDone}/${daily.length}`, dailyDone === daily.length ? 'green' : '') : null,
      closed.length ? chip(`${closed.length} closed ${isToday ? 'today' : 'this day'}`, 'green') : null));

    if (!isToday) add(root, h('p', { class: 'hint' }, icon('info', { size: 14 }), 'Looking back at a past day. Statuses show the latest information.'));

    if (daily.length) {
      add(root, h('h2', { class: 'section-label sec-daily' }, icon('repeat', { size: 14 }), `Every day · ${dailyDone} of ${daily.length} done`),
        h('div', { class: 'task-list daily-list' }, daily.map(({ task }) => dailyCard(task, { today, viewDay: day, readOnly: !isToday }))));
      if (open.length || closed.length) add(root, h('h2', { class: 'section-label' }, 'Follow-ups'));
    }

    if (!open.length && !closed.length) {
      if (daily.length && !onHold.length) return;
      add(root, h('div', { class: 'card' }, emptyState({
        iconName: 'list-checks', title: isToday ? 'Nothing to follow up' : 'No tasks on this day',
        text: isToday ? 'Add a task — note who you need to contact and the current status.' : '',
        action: isToday ? h('button', { class: 'btn btn-primary', type: 'button', onClick: openAddTask }, icon('plus', { size: 16 }), 'Add task') : null,
      })));
    } else add(root, h('div', { class: 'task-list' }, sorted.map((t) => taskCard(t, { today, viewDay: day, readOnly: !isToday }))));
    if (closed.length) {
      add(root, h('h2', { class: 'section-label' }, isToday ? 'Closed today' : 'Closed this day'),
        h('div', { class: 'task-list' }, closed.map((t) => taskCard(t, { today, viewDay: day }))));
    }
    if (onHold.length) {
      const held = sortHold(onHold.map((t) => ({ ...t, holdUntil: holdOnDay(t, day, today) || t.holdUntil })));
      const det = h('details', { class: 'hold-section', open: this.holdOpen || null },
        h('summary', { class: 'section-label' }, icon('pause', { size: 14 }), `On hold · ${onHold.length}`, h('span', { class: 'muted xs' }, ' — hidden until their follow-up date')),
        h('div', { class: 'task-list' }, held.map((t) => taskCard(store.tasks.get(t.id) || t, { today, viewDay: day, readOnly: !isToday }))));
      det.addEventListener('toggle', () => { this.holdOpen = det.open; });
      add(root, det);
    }
  },
};

function chip(text, tone) { return h('span', { class: `sum-chip ${tone}` }, text); }

export default view;
