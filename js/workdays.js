// js/workdays.js — pure date rules for the tracker (no Firebase, no DOM).
//  • Saturday and Sunday are holidays.
//  • A task stays on the list every day until it is marked Completed or Failed ("carried over").
//  • "Days open" counts WORKING days (Mon–Fri) since the task was added.
//  • A task open for more than CRITICAL_DAYS working days is CRITICAL (days spent on hold don't count).
//  • ON HOLD: when a follow-up date is entered, the task is hidden until that date, then pops up again.
//  • EVERY DAY tasks (e.g. "Check mail") come back unticked on every working day.

import { parseDate, toDateStr, addDays } from './utils.js';

export const CRITICAL_DAYS = 5;
export const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;
export const isHolidayStr = (dateStr) => { const d = parseDate(dateStr); return !!d && isWeekend(d); };
export const isClosed = (t) => t.status === 'completed' || t.status === 'failed';
export const isOpen = (t) => !isClosed(t);
export const isDaily = (t) => isOpen(t) && t.daily === true;
/** A normal follow-up task that is still open (not an everyday task). */
export const isFollowUp = (t) => isOpen(t) && t.daily !== true;
/** On hold on `dayStr`: a follow-up date later than that day has been entered. */
export const isOnHold = (t, dayStr) => isFollowUp(t) && !!t.holdUntil && t.holdUntil > dayStr;
/** Came back from hold and nobody has updated it since. */
export const isHoldDue = (t, dayStr) => isFollowUp(t) && !!t.holdUntil && t.holdUntil <= dayStr;

/** Number of working days d with start < d <= end ('YYYY-MM-DD' strings). */
export function workingDaysBetween(startStr, endStr) {
  const start = parseDate(startStr), end = parseDate(endStr);
  if (!start || !end || end <= start) return 0;
  let count = 0;
  for (let d = addDays(start, 1); d <= end; d = addDays(d, 1)) if (!isWeekend(d)) count++;
  return count;
}

export function nextWorkingDay(dateStr) {
  let d = addDays(parseDate(dateStr), 1);
  while (isWeekend(d)) d = addDays(d, 1);
  return toDateStr(d);
}

export function previousWorkingDay(dateStr) {
  let d = addDays(parseDate(dateStr), -1);
  while (isWeekend(d)) d = addDays(d, -1);
  return toDateStr(d);
}

/** Working days the task has been (or was) open: from the day it was added until it closed, or until `todayStr`. */
export function daysOpen(task, todayStr) {
  return workingDaysBetween(task.createdDate, isClosed(task) && task.closedDate ? task.closedDate : todayStr);
}

/**
 * Periods the task spent on hold, rebuilt from its history so past days stay correct.
 * A hold starts on the day a follow-up date was entered and ends on that date, or earlier if the task was
 * updated / resumed / closed before then.
 */
export function holdPeriods(task) {
  const out = [];
  let cur = null;
  for (const e of historyOf(task)) {
    if (!e.date) continue;
    if (cur) { out.push({ from: cur.from, to: e.date < cur.until ? e.date : cur.until }); cur = null; }
    if (e.holdUntil && e.holdUntil > e.date) cur = { from: e.date, until: e.holdUntil };
  }
  if (cur) out.push({ from: cur.from, to: cur.until, current: true });
  return out;
}

/** Follow-up date in force on a given day (null if the task wasn't on hold that day). */
export function holdOnDay(task, dayStr, todayStr) {
  if (!isFollowUp(task) && !(isClosed(task) && task.closedDate > dayStr)) return null;
  if (dayStr >= todayStr) return task.holdUntil && task.holdUntil > dayStr ? task.holdUntil : null;
  const p = holdPeriods(task).find((x) => x.from <= dayStr && dayStr < x.to);
  return p ? p.to : null;
}

/** Working days spent on hold, up to `endStr`. */
export function heldDays(task, endStr) {
  let n = 0;
  for (const p of holdPeriods(task)) {
    const to = p.to < endStr ? p.to : endStr;
    n += workingDaysBetween(p.from, to);
  }
  return n;
}

/** Working days the task has actually been waiting (open minus on hold). This drives CRITICAL. */
export function activeDays(task, todayStr) {
  const end = isClosed(task) && task.closedDate ? task.closedDate : todayStr;
  return Math.max(0, daysOpen(task, todayStr) - heldDays(task, end));
}

export const isCritical = (task, todayStr) => isFollowUp(task) && !isOnHold(task, todayStr) && activeDays(task, todayStr) > CRITICAL_DAYS;

/** A working day on or after the given date (Saturday/Sunday move to Monday). */
export function workingDayOnOrAfter(dateStr) {
  return isHolidayStr(dateStr) ? nextWorkingDay(dateStr) : dateStr;
}

/** Everyday tasks for a day (none on weekends). `done` = ticked that day. */
export function dailyForDay(tasks, dayStr) {
  if (isHolidayStr(dayStr)) return [];
  return tasks
    .filter((t) => t.daily === true && (t.dailySince || t.createdDate) <= dayStr && (isOpen(t) || (t.closedDate && t.closedDate > dayStr)))
    .map((t) => ({ task: t, done: !!(t.doneDates && t.doneDates[dayStr]) }))
    .sort((a, b) => (a.task.createdAt || 0) - (b.task.createdAt || 0));
}

/**
 * Follow-up tasks to show for a given day (never later than today). Everyday tasks are listed separately.
 *  open   — added on or before that day and not yet closed by then (carried over from earlier days)
 *  onHold — open but waiting for a follow-up date after that day (hidden from the main list)
 *  closed — completed or failed on that day (shown struck through)
 */
export function tasksForDay(tasks, dayStr, todayStr) {
  const day = dayStr > todayStr ? todayStr : dayStr;
  const open = [], onHold = [], closed = [];
  for (const t of tasks) {
    if (!t.createdDate || t.createdDate > day || t.daily === true) continue;
    if (isClosed(t) && t.closedDate === day) closed.push(t);
    else if (isOpen(t) || (t.closedDate && t.closedDate > day)) (holdOnDay(t, day, todayStr) ? onHold : open).push(t);
  }
  return { open, onHold, closed };
}

/** Sort: critical first, then back-from-hold, then oldest first, then most recently updated. */
export function sortOpen(list, todayStr) {
  return [...list].sort((a, b) =>
    (Number(isCritical(b, todayStr)) - Number(isCritical(a, todayStr)))
    || (Number(isHoldDue(b, todayStr)) - Number(isHoldDue(a, todayStr)))
    || String(a.createdDate).localeCompare(String(b.createdDate))
    || (b.lastUpdateAt || 0) - (a.lastUpdateAt || 0));
}

/** On-hold tasks, soonest return first. */
export const sortHold = (list) => [...list].sort((a, b) => String(a.holdUntil).localeCompare(String(b.holdUntil)));

/** History entries of a task, oldest first. */
export function historyOf(task) {
  return Object.entries(task.updates || {}).map(([id, u]) => ({ id, ...u })).sort((a, b) => (a.at || 0) - (b.at || 0));
}
