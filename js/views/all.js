// js/views/all.js — every task (including closed ones) with search and simple filters.

import { h, clear, add, todayStr, debounce } from '../utils.js';
import { icon, emptyState, skeleton } from '../ui.js';
import { store } from '../data.js';
import { isOpen, isCritical, isOnHold, sortOpen } from '../workdays.js';
import { taskCard, openAddTask } from '../components.js';

const FILTERS = [['open', 'Open'], ['critical', 'Critical'], ['hold', 'On hold'], ['daily', 'Every day'], ['completed', 'Completed'], ['failed', 'Failed'], ['all', 'All']];

const view = {
  title: 'All tasks',
  mount(root, route) {
    this.root = root;
    this.filter = FILTERS.some(([k]) => k === route.query.get('filter')) ? route.query.get('filter') : 'open';
    this.person = route.query.get('person') || '';
    this.dept = '';
    this.q = '';
    this.list = h('div', { class: 'task-list' });
    this.chips = h('div', { class: 'chips' });
    this.deptSel = h('select', { class: 'input input-sm', 'aria-label': 'Department', onChange: (e) => { this.dept = e.target.value; this.person = ''; this.refresh(); } });
    this.personSel = h('select', { class: 'input input-sm', 'aria-label': 'Person', onChange: (e) => { this.person = e.target.value; this.refresh(); } });
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Search tasks, status, people…', 'aria-label': 'Search', onInput: debounce((e) => { this.q = e.target.value.trim().toLowerCase(); this.refresh(); }, 150) });
    add(root,
      h('div', { class: 'page-head row-head' }, h('div', {}, h('h1', {}, 'All tasks'), h('p', {}, 'Search everything, including completed and failed tasks.')),
        h('button', { class: 'btn btn-primary add-btn', type: 'button', onClick: openAddTask }, icon('plus', { size: 17 }), 'Add task')),
      h('div', { class: 'search-box' }, icon('search', { size: 16 }), search),
      this.chips,
      h('div', { class: 'filter-row' }, this.deptSel, this.personSel),
      this.count = h('p', { class: 'muted sm' }),
      this.list);
    this.refresh();
  },
  refresh() {
    if (!this.root) return;
    const today = todayStr();
    clear(this.chips);
    for (const [k, label] of FILTERS) add(this.chips, h('button', { class: `chip ${this.filter === k ? 'active' : ''}`, type: 'button', onClick: () => { this.filter = k; this.refresh(); } }, label));
    add(clear(this.deptSel), h('option', { value: '' }, 'All departments'), store.sortedDepartments().map((d) => h('option', { value: d.id, selected: d.id === this.dept }, d.name)));
    add(clear(this.personSel), h('option', { value: '' }, 'All people'),
      store.sortedPeople().filter((p) => !this.dept || p.departmentId === this.dept).map((p) => h('option', { value: p.id, selected: p.id === this.person }, p.name)));
    clear(this.list);
    if (!store.isLoaded()) { add(this.list, skeleton(4, { height: 110 })); return; }
    let tasks = store.list('tasks').filter((t) => {
      if (this.filter === 'open' && !isOpen(t)) return false;
      if (this.filter === 'critical' && !isCritical(t, today)) return false;
      if (this.filter === 'hold' && !isOnHold(t, today)) return false;
      if (this.filter === 'daily' && !(isOpen(t) && t.daily === true)) return false;
      if ((this.filter === 'completed' || this.filter === 'failed') && t.status !== this.filter) return false;
      if (this.person && t.personId !== this.person) return false;
      if (this.dept) { const c = store.contactOf(t); if ((c.department?.id || t.departmentId) !== this.dept) return false; }
      if (this.q) {
        const c = store.contactOf(t);
        const hay = [t.title, t.currentStatus, c.personName, c.departmentName].join(' ').toLowerCase();
        if (!this.q.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    const open = this.filter === 'hold'
      ? tasks.sort((a, b) => String(a.holdUntil).localeCompare(String(b.holdUntil)))
      : sortOpen(tasks.filter(isOpen), today);
    const closed = tasks.filter((t) => !isOpen(t)).sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0));
    tasks = [...open, ...closed];
    this.count.textContent = `${tasks.length} task${tasks.length === 1 ? '' : 's'}`;
    if (!tasks.length) { add(this.list, h('div', { class: 'card' }, emptyState({ iconName: 'search', title: 'No tasks found', text: 'Try another filter or search.' }))); return; }
    add(this.list, tasks.slice(0, 200).map((t) => taskCard(t, { today })));
  },
};

export default view;
