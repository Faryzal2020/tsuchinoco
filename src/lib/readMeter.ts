// Estimated Firestore reads by this browser, per listener or query, for today (Pacific time,
// when the free quota resets). Firestore bills a listener's whole result set when it starts
// (or resumes after 30+ minutes away) and then one read per changed document. The client
// cannot see which of the two a resumed listener paid, so the first server snapshot of every
// listener counts its full size: an upper bound that matches the bill after a break.
import { useSyncExternalStore } from 'react';
import type { DocumentSnapshot, QuerySnapshot } from 'firebase/firestore';

export interface MeterRow {
  name: string;
  /** Documents counted from first server snapshots and one-off reads. */
  loads: number;
  /** Documents counted from later changes to live listeners. */
  updates: number;
  /** How many times a listener started or a one-off read ran. */
  starts: number;
}

export interface MeterState { day: string; rows: MeterRow[]; total: number }

const KEY = 'tsuchinoco.readMeter';
const PT_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' });
const today = () => PT_DAY.format(Date.now());

let day = today();
let rows = new Map<string, MeterRow>();
let snapshot: MeterState = { day, rows: [], total: 0 };
const subscribers = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function load() {
  if (typeof window === 'undefined') return;
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) || 'null') as { day: string; rows: MeterRow[] } | null;
    if (saved && saved.day === day) rows = new Map(saved.rows.map((r) => [r.name, r]));
  } catch { /* storage blocked: count this page only */ }
  publish();
}

function publish() {
  const list = [...rows.values()].sort((a, b) => b.loads + b.updates - (a.loads + a.updates));
  snapshot = { day, rows: list, total: list.reduce((n, r) => n + r.loads + r.updates, 0) };
  subscribers.forEach((f) => f());
}

function save() {
  if (saveTimer || typeof window === 'undefined') return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { window.localStorage.setItem(KEY, JSON.stringify({ day, rows: [...rows.values()] })); } catch { /* ignore */ }
  }, 1000);
}

function add(name: string, loads: number, updates: number, starts: number) {
  const d = today();
  if (d !== day) { day = d; rows = new Map(); }
  const r = rows.get(name) ?? { name, loads: 0, updates: 0, starts: 0 };
  r.loads += loads;
  r.updates += updates;
  r.starts += starts;
  rows.set(name, r);
  publish();
  save();
}

/** Count a one-off read (getDoc/getDocs). An empty query still costs one read. */
export function meterRead(name: string, docs: number) {
  add(name, Math.max(1, docs), 0, 1);
}

/**
 * Wrap a query listener's callback: `onSnapshot(q, metered('items', (s) => ...))`. Create it inside
 * the effect that subscribes, so each subscription counts its own first load.
 */
export function metered<T extends QuerySnapshot<any, any>>(name: string, next: (s: T) => void): (s: T) => void { // eslint-disable-line @typescript-eslint/no-explicit-any
  let first = true;
  return (s) => {
    if (!s.metadata.fromCache) {
      if (first) add(name, Math.max(1, s.size), 0, 1);
      else add(name, 0, s.docChanges().length, 0);
      first = false;
    }
    next(s);
  };
}

/** The same for a single-document listener: one read when it starts, one per change. */
export function meteredDoc<T extends DocumentSnapshot<any, any>>(name: string, next: (s: T) => void): (s: T) => void { // eslint-disable-line @typescript-eslint/no-explicit-any
  let first = true;
  return (s) => {
    if (!s.metadata.fromCache && !s.metadata.hasPendingWrites) {
      add(name, first ? 1 : 0, first ? 0 : 1, first ? 1 : 0);
      first = false;
    }
    next(s);
  };
}

export function resetReadMeter() {
  rows = new Map();
  publish();
  save();
}

// Pick up earlier counts from today before any listener adds to them.
load();

function subscribe(f: () => void) {
  subscribers.add(f);
  return () => { subscribers.delete(f); };
}

const EMPTY: MeterState = { day: '', rows: [], total: 0 };

export function useReadMeter(): MeterState {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY);
}
