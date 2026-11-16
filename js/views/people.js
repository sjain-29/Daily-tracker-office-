// js/views/people.js — manage departments and the people in them.

import { h, clear, add } from '../utils.js';
import { icon, emptyState, skeleton, toast, confirmDialog, openModal, field } from '../ui.js';
import * as data from '../data.js';
import { store } from '../data.js';
import { isOpen } from '../workdays.js';
import { openPersonForm, quickAddDepartment } from '../components.js';
import { navigate } from '../app-nav.js';

const view = {
  title: 'People',
  mount(root) { this.root = root; this.refresh(); },
  refresh() {
    const root = this.root;
    if (!root) return;
    clear(root);
    add(root, h('div', { class: 'page-head row-head' },
      h('div', {}, h('h1', {}, 'People & departments'), h('p', {}, 'Who you contact, grouped by department. Changing someone’s department moves their open tasks too.')),
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'button', onClick: () => quickAddDepartment() }, icon('building-2', { size: 16 }), 'Department'),
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => openPersonForm() }, icon('user-plus', { size: 16 }), 'Person'))));
    if (!store.isLoaded()) { add(root, skeleton(4, { height: 70 })); return; }

    const depts = store.sortedDepartments();
    const people = store.sortedPeople();
    const openCount = (pred) => store.list('tasks').filter((t) => isOpen(t) && pred(t)).length;

    if (!depts.length) {
      add(root, h('div', { class: 'card' }, emptyState({ iconName: 'building-2', title: 'No departments yet', text: 'Add the departments you work with.', action: h('button', { class: 'btn btn-primary', type: 'button', onClick: () => quickAddDepartment() }, icon('plus', { size: 16 }), 'Add department') })));
      return;
    }

    const groups = [...depts.map((d) => ({ d, list: people.filter((p) => p.departmentId === d.id) }))];
    const orphans = people.filter((p) => !store.department(p.departmentId));
    add(root, h('div', { class: 'dept-list' }, groups.map(({ d, list }) => h('section', { class: 'card dept' },
      h('div', { class: 'dept-head' },
        h('span', { class: 'card-icon' }, icon('building-2', { size: 16 })),
        h('div', { class: 'grow' }, h('h3', {}, d.name), h('p', { class: 'muted xs' }, `${list.length} ${list.length === 1 ? 'person' : 'people'} · ${openCount((t) => t.departmentId === d.id)} open tasks`)),
        h('button', { class: 'icon-btn sm ghost', type: 'button', 'aria-label': `Add person to ${d.name}`, title: 'Add person', onClick: () => openPersonForm({ departmentId: d.id }) }, icon('user-plus', { size: 16 })),
        h('button', { class: 'icon-btn sm ghost', type: 'button', 'aria-label': `Rename ${d.name}`, title: 'Rename', onClick: () => renameDept(d) }, icon('pencil', { size: 15 })),
        h('button', { class: 'icon-btn sm ghost danger', type: 'button', 'aria-label': `Delete ${d.name}`, title: 'Delete', onClick: () => deleteDept(d) }, icon('trash-2', { size: 15 }))),
      list.length ? h('ul', { class: 'people' }, list.map((p) => personRow(p, openCount((t) => t.personId === p.id))))
        : h('p', { class: 'muted sm empty-line' }, 'No people yet.'))),
    orphans.length ? h('section', { class: 'card dept' }, h('div', { class: 'dept-head' }, h('h3', {}, 'Without department')), h('ul', { class: 'people' }, orphans.map((p) => personRow(p, 0)))) : null));
  },
};

function personRow(p, open) {
  const deptSel = h('select', { class: 'input input-sm', 'aria-label': `Department of ${p.name}`, onChange: (e) => {
    try { data.updatePerson(p.id, { departmentId: e.target.value }); toast(`${p.name} moved to ${store.department(e.target.value)?.name}`, { type: 'success' }); } catch (err) { toast(err.message, { type: 'error' }); }
  } }, store.sortedDepartments().map((d) => h('option', { value: d.id, selected: d.id === p.departmentId }, d.name)));
  return h('li', {},
    h('div', { class: 'avatar' }, p.name.split(/\s+/).map((x) => x[0]).join('').slice(0, 2).toUpperCase()),
    h('div', { class: 'grow' },
      h('strong', {}, p.name),
      h('div', { class: 'muted xs row' },
        p.phone ? h('a', { href: `tel:${p.phone.replace(/[^0-9+]/g, '')}`, class: 'call' }, icon('phone', { size: 12 }), p.phone) : null,
        open ? h('button', { class: 'link', type: 'button', onClick: () => navigate(`#/all?person=${p.id}`) }, `${open} open task${open === 1 ? '' : 's'}`) : h('span', {}, 'No open tasks'))),
    deptSel,
    h('button', { class: 'icon-btn sm ghost', type: 'button', 'aria-label': `Edit ${p.name}`, onClick: () => openPersonForm({ person: p }) }, icon('pencil', { size: 15 })),
    h('button', { class: 'icon-btn sm ghost danger', type: 'button', 'aria-label': `Delete ${p.name}`, onClick: async () => {
      if (!(await confirmDialog({ title: `Delete ${p.name}?`, message: 'Their past updates stay in task history.', confirmText: 'Delete', danger: true }))) return;
      try { data.deletePerson(p.id); toast('Person deleted', { type: 'success' }); } catch (err) { toast(err.message, { type: 'error', timeout: 7000 }); }
    } }, icon('trash-2', { size: 15 })));
}

function renameDept(d) {
  const input = h('input', { class: 'input', value: d.name, maxlength: 60, autofocus: true });
  const save = () => { try { data.renameDepartment(d.id, input.value); toast('Renamed', { type: 'success' }); m.close(); } catch (e) { toast(e.message, { type: 'error' }); } };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  const m = openModal({ title: 'Rename department', size: 'sm', body: field('Name', input),
    footer: [h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, 'Save')] });
}

async function deleteDept(d) {
  if (!(await confirmDialog({ title: `Delete “${d.name}”?`, message: 'Only empty departments can be deleted.', confirmText: 'Delete', danger: true }))) return;
  try { data.deleteDepartment(d.id); toast('Department deleted', { type: 'success' }); } catch (e) { toast(e.message, { type: 'error', timeout: 7000 }); }
}

export default view;
