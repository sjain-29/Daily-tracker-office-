// js/components.js — task cards and the add / update / close / details sheets.

import { h, clear, add, formatDate, timeAgo, todayStr, toDateStr, parseDate, addDays } from './utils.js';
import { icon, openModal, toast, confirmDialog, popMenu, field } from './ui.js';
import * as data from './data.js';
import { store } from './data.js';
import { daysOpen, heldDays, isCritical, isClosed, isOnHold, isHoldDue, isHolidayStr, workingDayOnOrAfter, historyOf, CRITICAL_DAYS } from './workdays.js';

const showError = (e) => toast(e instanceof data.ValidationError ? e.message : `Couldn’t save: ${e.message || e}`, { type: 'error' });
const fmtDay = (d) => formatDate(d, { weekday: 'short', day: 'numeric', month: 'short' });

/* ---------------------------------------------------------------- Department + person picker */

/**
 * Two linked drop-downs. Choosing a person sets their department; choosing a department filters the people.
 * Both lists end with "＋ Add new…" so departments and people can be created on the spot.
 */
export function contactPicker({ departmentId = '', personId = '', personLabel = 'Contact person' } = {}) {
  const dept = h('select', { class: 'input', 'aria-label': 'Department' });
  const person = h('select', { class: 'input', 'aria-label': personLabel });
  const p0 = store.person(personId);
  let deptVal = p0 ? p0.departmentId : (departmentId || '');
  let personVal = p0 ? p0.id : '';

  const drawDept = () => {
    clear(dept);
    add(dept, h('option', { value: '' }, 'Choose department…'),
      store.sortedDepartments().map((d) => h('option', { value: d.id, selected: d.id === deptVal }, d.name)),
      h('option', { value: '__new' }, '＋ Add new department…'));
    dept.value = deptVal;
  };
  const drawPeople = () => {
    clear(person);
    const list = store.sortedPeople().filter((p) => !deptVal || p.departmentId === deptVal);
    add(person, h('option', { value: '' }, list.length ? 'Choose person… (optional)' : 'No people yet'),
      list.map((p) => h('option', { value: p.id }, deptVal ? p.name : `${p.name} · ${store.department(p.departmentId)?.name || ''}`)),
      h('option', { value: '__new' }, '＋ Add new person…'));
    person.value = list.some((p) => p.id === personVal) ? personVal : '';
    personVal = person.value;
  };
  dept.addEventListener('change', () => {
    if (dept.value === '__new') { dept.value = deptVal; quickAddDepartment((id) => { deptVal = id; personVal = ''; drawDept(); drawPeople(); }); return; }
    deptVal = dept.value;
    drawPeople();
  });
  person.addEventListener('change', () => {
    if (person.value === '__new') { person.value = personVal; quickAddPerson(deptVal, (id) => { personVal = id; deptVal = store.person(id).departmentId; drawDept(); drawPeople(); }); return; }
    personVal = person.value;
    const p = store.person(personVal);
    if (p && p.departmentId !== deptVal) { deptVal = p.departmentId; drawDept(); drawPeople(); }
  });
  drawDept(); drawPeople();
  const el = h('div', { class: 'form-row' }, field('Department', dept), field(personLabel, person));
  return { el, value: () => ({ departmentId: deptVal || null, personId: personVal || null }) };
}

export function quickAddDepartment(onDone) {
  const name = h('input', { class: 'input', maxlength: 60, placeholder: 'e.g. Design', autofocus: true });
  const save = () => {
    try { const id = data.addDepartment(name.value); toast('Department added', { type: 'success' }); m.close(); onDone?.(id); } catch (e) { showError(e); }
  };
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  const m = openModal({ title: 'New department', size: 'sm', body: field('Department name', name),
    footer: [h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, 'Add')] });
}

export function quickAddPerson(departmentId, onDone) {
  openPersonForm({ person: null, departmentId, onDone });
}

/** Add or edit a person (name, department, optional phone). */
export function openPersonForm({ person = null, departmentId = '', onDone } = {}) {
  const name = h('input', { class: 'input', maxlength: 80, value: person?.name || '', placeholder: 'Full name', autofocus: true });
  const dept = h('select', { class: 'input' },
    h('option', { value: '' }, 'Choose department…'),
    store.sortedDepartments().map((d) => h('option', { value: d.id, selected: d.id === (person?.departmentId || departmentId) }, d.name)));
  const phone = h('input', { class: 'input', type: 'tel', inputmode: 'tel', maxlength: 30, value: person?.phone || '', placeholder: 'Optional — tap to call later' });
  const err = h('div', { class: 'form-error', hidden: true });
  const save = () => {
    err.hidden = true;
    try {
      const input = { name: name.value, departmentId: dept.value, phone: phone.value };
      if (person) { data.updatePerson(person.id, input); toast('Saved', { type: 'success' }); m.close(); onDone?.(person.id); }
      else { const id = data.addPerson(input); toast('Person added', { type: 'success' }); m.close(); onDone?.(id); }
    } catch (e) { err.textContent = e.message; err.hidden = false; }
  };
  const m = openModal({
    title: person ? 'Edit person' : 'New person', size: 'sm',
    body: h('form', { class: 'stack', onSubmit: (e) => { e.preventDefault(); save(); } }, err, field('Name', name, { required: true }), field('Department', dept, { required: true }), field('Phone', phone), h('button', { type: 'submit', hidden: true })),
    footer: [h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, person ? 'Save' : 'Add person')],
  });
}

/* ---------------------------------------------------------------- Add task */

export function openAddTask() {
  const today = todayStr();
  const title = h('textarea', { class: 'input', rows: 2, maxlength: 300, placeholder: 'What needs follow-up? e.g. Get quotation for GPS modules', autofocus: true });
  const status = h('textarea', { class: 'input', rows: 2, maxlength: 2000, placeholder: 'Current status — e.g. Asked vendor on call, waiting for reply' });
  const picker = contactPicker({ personLabel: 'Who do I contact?' });
  const daily = h('input', { type: 'checkbox' });
  const err = h('div', { class: 'form-error', hidden: true });
  const save = () => {
    err.hidden = true;
    try {
      data.addTask({ title: title.value, currentStatus: status.value, daily: daily.checked, ...picker.value() });
      toast(daily.checked ? 'Everyday task added — it comes back every working day' : 'Task added', { type: 'success' });
      m.close();
    } catch (e) { err.textContent = e.message; err.hidden = false; title.focus(); }
  };
  const m = openModal({
    title: 'New task', subtitle: `Date: ${fmtDay(today)} (automatic)`, size: 'md',
    body: h('div', { class: 'stack' }, err, field('Task', title, { required: true }), field('Current status', status), picker.el,
      h('label', { class: 'check-row daily-check' }, daily, icon('repeat', { size: 16 }), h('span', {}, h('strong', {}, 'Every day'), h('span', { class: 'muted sm' }, ' — repeat this on every working day (e.g. Check mail)')))),
    footer: [h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, icon('plus', { size: 16 }), 'Add task')],
  });
}

/* ---------------------------------------------------------------- Update / close */

/**
 * "Follow up again on" date. Empty = no hold. Quick buttons for common gaps; weekends move to Monday.
 */
function holdPicker(initial = '') {
  const today = todayStr();
  const input = h('input', { class: 'input', type: 'date', min: toDateStr(addDays(parseDate(today), 1)), value: initial, 'aria-label': 'Follow up again on' });
  const info = h('div', { class: 'field-hint' });
  const draw = () => {
    clear(info);
    const v = input.value;
    if (!v) { add(info, 'Leave empty to keep the task on the list every day.'); clearBtn.hidden = true; return; }
    clearBtn.hidden = false;
    if (v <= today) { add(info, h('span', { class: 'warn' }, 'Choose a date after today.')); return; }
    const back = workingDayOnOrAfter(v);
    const days = Math.round((parseDate(back) - parseDate(today)) / 86400000);
    add(info, icon('pause', { size: 13 }), ' On hold — hidden until ', h('strong', {}, fmtDay(back)), ` (${days} day${days === 1 ? '' : 's'}), then it pops up again.`,
      isHolidayStr(v) ? h('span', { class: 'warn' }, ` ${formatDate(v, { weekday: 'long' })} is a holiday, so it comes back on Monday.`) : null);
  };
  const quick = (label, n) => h('button', { class: 'chip', type: 'button', onClick: () => { input.value = toDateStr(addDays(parseDate(today), n)); draw(); } }, label);
  const clearBtn = h('button', { class: 'chip', type: 'button', onClick: () => { input.value = ''; draw(); } }, icon('x', { size: 12 }), 'No date');
  input.addEventListener('input', draw);
  input.addEventListener('change', draw);
  draw();
  const el = h('div', { class: 'field hold-field' },
    h('label', { class: 'field-label', htmlFor: input.id = `f-hold-${Math.random().toString(36).slice(2, 7)}` }, icon('calendar-clock', { size: 14 }), ' Did they give a date? Follow up again on (optional)'),
    h('div', { class: 'hold-row' }, input),
    h('div', { class: 'chips hold-quick' }, quick('3 days', 3), quick('1 week', 7), quick('10 days', 10), quick('2 weeks', 14), quick('1 month', 30), clearBtn),
    info);
  return { el, value: () => input.value, focus: () => input.focus() };
}

export function openUpdate(task, { focusHold = false } = {}) {
  const c = store.contactOf(task);
  const note = h('textarea', { class: 'input', rows: 3, maxlength: 2000, placeholder: `What did ${c.personName || 'they'} say? What is the status now?`, autofocus: true });
  const picker = contactPicker({ departmentId: task.departmentId, personId: task.personId, personLabel: 'Next update from' });
  const hold = task.daily === true ? null : holdPicker(task.holdUntil && task.holdUntil > todayStr() ? task.holdUntil : '');
  const err = h('div', { class: 'form-error', hidden: true });
  const save = () => {
    err.hidden = true;
    try {
      const until = data.addUpdate(task.id, { note: note.value, holdUntil: hold ? hold.value() : null, ...picker.value() });
      toast(until ? `On hold — back on ${fmtDay(until)}` : 'Status updated', { type: 'success' });
      m.close();
    } catch (e) { err.textContent = e.message; err.hidden = false; }
  };
  if (focusHold && hold) setTimeout(() => hold.focus(), 60);
  const m = openModal({
    title: 'Update status', subtitle: task.title, size: 'md',
    body: h('div', { class: 'stack' }, err,
      task.currentStatus ? h('div', { class: 'prev-status' }, h('span', {}, 'Previous status'), h('p', {}, task.currentStatus)) : null,
      field('New status', note, { required: true }),
      h('div', { class: 'field-label', style: 'margin-bottom:-6px' }, 'Who gives the next update? (change if it moves to someone else)'),
      picker.el,
      hold ? hold.el : null,
      task.daily === true ? null : h('div', { class: 'final-row' },
        h('span', { class: 'muted sm' }, 'Finished?'),
        h('button', { class: 'btn btn-sm btn-success', type: 'button', onClick: () => { m.close(); openClose(task, 'completed', note.value); } }, icon('circle-check', { size: 15 }), 'Mark completed'),
        h('button', { class: 'btn btn-sm btn-danger-soft', type: 'button', onClick: () => { m.close(); openClose(task, 'failed', note.value); } }, icon('circle-x', { size: 15 }), 'Mark failed'))),
    footer: [h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, 'Save update')],
  });
}

export function openClose(task, outcome, prefill = '') {
  const done = outcome === 'completed';
  const note = h('textarea', { class: 'input', rows: 2, maxlength: 2000, placeholder: done ? 'Optional: final note (e.g. PO received)' : 'Optional: why it failed' }, prefill || '');
  const confirm = () => {
    try {
      data.closeTask(task.id, outcome, note.value);
      toast(done ? `Completed: ${task.title}` : `Marked failed: ${task.title}`, { type: done ? 'success' : 'warning', action: { label: 'Undo', fn: () => data.reopenTask(task.id) } });
      m.close();
    } catch (e) { showError(e); }
  };
  const m = openModal({
    title: done ? 'Mark as completed?' : 'Mark as failed?', subtitle: task.title, size: 'sm',
    body: h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'This is the final step — the task stops moving to the next day and is shown struck through.'), field('Final note', note)),
    footer: [h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => m.close() }, 'Cancel'),
      h('button', { class: `btn ${done ? 'btn-success-solid' : 'btn-danger'}`, type: 'button', onClick: confirm }, done ? 'Mark completed' : 'Mark failed')],
  });
}

/* ---------------------------------------------------------------- Task card */

export function badges(task, today, viewDay = today) {
  const out = [];
  if (task.status === 'completed') out.push(h('span', { class: 'badge b-done' }, icon('circle-check', { size: 12 }), 'Completed'));
  else if (task.status === 'failed') out.push(h('span', { class: 'badge b-failed' }, icon('circle-x', { size: 12 }), 'Failed'));
  else if (task.daily === true) {
    out.push(h('span', { class: 'badge b-daily' }, icon('repeat', { size: 12 }), 'Every day'));
    const done = !!(task.doneDates && task.doneDates[viewDay]);
    if (!isHolidayStr(viewDay)) out.push(h('span', { class: `badge ${done ? 'b-done' : 'b-carry'}` }, done ? 'Done today' : 'Not done today'));
  } else {
    if (isCritical(task, today)) out.push(h('span', { class: 'badge b-critical', title: `Waiting more than ${CRITICAL_DAYS} working days` }, icon('flame', { size: 12 }), 'Critical'));
    if (isOnHold(task, today)) out.push(h('span', { class: 'badge b-hold', title: 'Hidden from the daily list until this date' }, icon('pause', { size: 12 }), `On hold until ${fmtDay(task.holdUntil)}`));
    else if (isHoldDue(task, today)) out.push(h('span', { class: 'badge b-due', title: 'The follow-up date has arrived — contact them' }, icon('calendar-clock', { size: 12 }), task.holdUntil === today ? 'Follow-up due today' : `Follow-up due since ${fmtDay(task.holdUntil)}`));
    if (task.createdDate < viewDay) out.push(h('span', { class: 'badge b-carry', title: `Added ${fmtDay(task.createdDate)} — moves to the next day until completed or failed` }, icon('arrow-right', { size: 12 }), 'Carried over'));
    else out.push(h('span', { class: 'badge b-new' }, 'New today'));
  }
  return out;
}

export function contactLine(task) {
  const c = store.contactOf(task);
  if (!c.personName && !c.departmentName) return h('div', { class: 'contact muted' }, icon('user', { size: 14 }), 'No contact set');
  return h('div', { class: 'contact' },
    icon('user', { size: 14 }),
    h('span', {}, isClosed(task) ? '' : 'Waiting on ', h('strong', {}, c.personName || c.departmentName), c.personName && c.departmentName ? h('span', { class: 'dept' }, ` · ${c.departmentName}`) : null),
    c.person?.phone && !isClosed(task) ? h('a', { class: 'call', href: `tel:${c.person.phone.replace(/[^0-9+]/g, '')}`, onClick: (e) => e.stopPropagation(), title: `Call ${c.personName}` }, icon('phone', { size: 13 }), 'Call') : null);
}

function footText(task, today) {
  const closed = isClosed(task);
  if (task.daily === true && !closed) return `Every working day since ${fmtDay(task.dailySince || task.createdDate)} · updated ${timeAgo(task.lastUpdateAt || task.updatedAt)}`;
  const total = daysOpen(task, today);
  const held = heldDays(task, closed && task.closedDate ? task.closedDate : today);
  const days = closed ? `${task.status} ${fmtDay(task.closedDate)}` : `${total} working day${total === 1 ? '' : 's'} open${held ? ` (${held} on hold)` : ''}`;
  return `Since ${fmtDay(task.createdDate)} · ${days} · updated ${timeAgo(task.lastUpdateAt || task.updatedAt)}`;
}

export function taskCard(task, { today = todayStr(), viewDay = today, readOnly = false } = {}) {
  const closed = isClosed(task);
  const critical = isCritical(task, today);
  const onHold = isOnHold(task, today);
  if (task.daily === true && !closed) return dailyCard(task, { today, viewDay, readOnly });
  return h('article', { class: `task ${closed ? 'is-closed' : ''} ${critical ? 'is-critical' : ''} ${onHold ? 'is-hold' : ''} ${isHoldDue(task, today) ? 'is-due' : ''}`, dataset: { id: task.id } },
    h('div', { class: 'task-top' },
      h('div', { class: 'badges' }, badges(task, today, viewDay)),
      h('button', { class: 'icon-btn sm ghost', type: 'button', 'aria-label': 'More actions', onClick: (e) => taskMenu(e.currentTarget, task) }, icon('ellipsis', { size: 16 }))),
    h('h3', { class: 'task-title', onClick: () => openTaskSheet(task.id) }, task.title),
    task.currentStatus ? h('p', { class: 'task-status' }, task.currentStatus) : null,
    contactLine(task),
    h('div', { class: 'task-foot' },
      h('span', { class: 'muted xs' }, footText(task, today)),
      !closed && !readOnly ? h('div', { class: 'task-actions' },
        h('button', { class: 'btn btn-sm btn-primary', type: 'button', onClick: () => openUpdate(store.tasks.get(task.id) || task) }, icon('message-square-text', { size: 15 }), 'Update'),
        h('button', { class: 'btn btn-sm btn-success', type: 'button', 'aria-label': 'Mark completed', title: 'Mark completed', onClick: () => openClose(task, 'completed') }, icon('check', { size: 15 }), h('span', { class: 'lbl' }, 'Completed')),
        h('button', { class: 'btn btn-sm btn-danger-soft', type: 'button', 'aria-label': 'Mark failed', title: 'Mark failed', onClick: () => openClose(task, 'failed') }, icon('x', { size: 15 }), h('span', { class: 'lbl' }, 'Failed'))) : null));
}

/** An everyday task: a tick box for the day. Unticked again on the next working day. */
export function dailyCard(task, { today = todayStr(), viewDay = today, readOnly = false } = {}) {
  const holiday = isHolidayStr(viewDay);
  const done = !!(task.doneDates && task.doneDates[viewDay]);
  const canTick = !readOnly && !holiday && viewDay === today;
  const toggle = () => {
    if (!canTick) return;
    try { data.setDailyDone(task.id, viewDay, !done); if (!done) toast(`Done for today: ${task.title}`, { type: 'success', timeout: 2500 }); } catch (e) { showError(e); }
  };
  return h('article', { class: `task daily ${done ? 'is-done-today' : ''}`, dataset: { id: task.id } },
    h('div', { class: 'daily-main' },
      h('button', { class: `tick ${done ? 'on' : ''}`, type: 'button', role: 'checkbox', 'aria-checked': String(done), 'aria-label': `${done ? 'Untick' : 'Tick'} ${task.title}`, disabled: !canTick, onClick: toggle },
        icon(done ? 'square-check-big' : 'square', { size: 22 })),
      h('div', { class: 'daily-text' },
        h('h3', { class: 'task-title', onClick: () => openTaskSheet(task.id) }, task.title),
        task.currentStatus ? h('p', { class: 'task-status' }, task.currentStatus) : null,
        task.personId || task.departmentId ? contactLine(task) : null),
      h('div', { class: 'daily-side' },
        h('span', { class: 'badge b-daily' }, icon('repeat', { size: 12 }), 'Every day'),
        h('button', { class: 'icon-btn sm ghost', type: 'button', 'aria-label': 'More actions', onClick: (e) => taskMenu(e.currentTarget, task) }, icon('ellipsis', { size: 16 })))));
}

export function taskMenu(anchor, task) {
  const t = store.tasks.get(task.id) || task;
  const today = todayStr();
  const open = !isClosed(t);
  const daily = open && t.daily === true;
  popMenu(anchor, [
    { label: 'Details & history', icon: 'history', onClick: () => openTaskSheet(t.id) },
    open ? { label: daily ? 'Add a note' : 'Update status', icon: 'message-square-text', onClick: () => openUpdate(t) } : null,
    open && !daily && !isOnHold(t, today) ? { label: 'Put on hold until a date…', icon: 'pause', onClick: () => openUpdate(t, { focusHold: true }) } : null,
    open && !daily && isOnHold(t, today) ? { label: 'Bring back now (end hold)', icon: 'play', onClick: () => { data.resumeTask(t.id); toast('Back on today’s list', { type: 'success' }); } } : null,
    open && !daily ? { label: 'Make it an everyday task', icon: 'repeat', onClick: () => { data.setDaily(t.id, true); toast('Now repeats every working day', { type: 'success' }); } } : null,
    daily ? { label: 'Stop repeating every day', icon: 'repeat', onClick: () => stopDaily(t) } : null,
    { label: 'Edit task text', icon: 'pencil', onClick: () => openRename(t) },
    isClosed(t) ? { label: 'Reopen', icon: 'rotate-ccw', onClick: () => { data.reopenTask(t.id); toast('Task reopened', { type: 'success' }); } } : null,
    { separator: true },
    { label: 'Delete…', icon: 'trash-2', danger: true, onClick: () => confirmDelete(t) },
  ]);
}

async function stopDaily(task) {
  const ok = await confirmDialog({ title: 'Stop repeating every day?', message: `“${task.title}” becomes a normal follow-up task starting today. You can then mark it Completed or Failed, or delete it.`, confirmText: 'Stop repeating' });
  if (ok) { data.setDaily(task.id, false); toast('No longer repeats', { type: 'success' }); }
}

function openRename(task) {
  const input = h('textarea', { class: 'input', rows: 2, maxlength: 300, autofocus: true }, task.title);
  const save = () => { try { data.renameTask(task.id, input.value); toast('Saved', { type: 'success' }); m.close(); } catch (e) { showError(e); } };
  const m = openModal({ title: 'Edit task', size: 'sm', body: field('Task', input),
    footer: [h('button', { class: 'btn btn-ghost', type: 'button', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn btn-primary', type: 'button', onClick: save }, 'Save')] });
}

export async function confirmDelete(task) {
  const ok = await confirmDialog({ title: 'Delete this task?', message: `“${task.title}” and its history will be removed permanently. To keep a record, mark it Completed or Failed instead.`, confirmText: 'Delete', danger: true });
  if (ok) { data.deleteTask(task.id); toast('Task deleted', { type: 'success' }); }
  return ok;
}

/* ---------------------------------------------------------------- Details + history */

export const TYPE_LABEL = { created: 'Added', update: 'Update', completed: 'Completed', failed: 'Failed', reopened: 'Reopened', resumed: 'Back from hold', 'daily-on': 'Made an everyday task', 'daily-off': 'Stopped repeating' };

export function openTaskSheet(id) {
  const body = h('div', { class: 'stack' });
  let unsub = null;
  openModal({ title: 'Task', size: 'md', body, onClose: () => unsub?.() });
  const render = () => {
    const t = store.tasks.get(id);
    if (!t) { add(clear(body), h('p', { class: 'muted' }, 'This task no longer exists.')); return; }
    const today = todayStr();
    add(clear(body),
      taskCard(t, { today }),
      h('h4', { class: 'section-label' }, 'History'),
      h('ol', { class: 'timeline' }, historyOf(t).reverse().map((u) => h('li', { class: `tl-${u.type}` },
        h('div', { class: 'tl-head' }, h('strong', {}, TYPE_LABEL[u.type] || u.type), h('span', { class: 'muted xs' }, `${fmtDay(u.date)} · ${new Date(u.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`)),
        u.note ? h('p', {}, u.note) : null,
        u.holdUntil ? h('div', { class: 'tl-hold' }, icon('pause', { size: 12 }), ` On hold until ${fmtDay(u.holdUntil)}`) : null,
        u.personName || u.departmentName ? h('div', { class: 'muted xs' }, `${u.type === 'created' ? 'Contact' : 'Next update from'}: ${[u.personName, u.departmentName].filter(Boolean).join(' · ')}`) : null))));
  };
  render();
  unsub = store.subscribe((keys) => { if (keys.has('tasks') || keys.has('people') || keys.has('departments')) render(); });
}
