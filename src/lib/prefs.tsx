'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useData } from './data';
import { useAuth } from './auth';
import type { Item } from '@/types';

interface Prefs {
  currentEventId: string;
  setCurrentEventId: (id: string) => void;
  mineOnly: boolean;
  setMineOnly: (v: boolean) => void;
  /** Filter helper honouring the "my items" toggle. */
  isMine: (item: Item | undefined) => boolean;
}

const Ctx = createContext<Prefs | null>(null);
const KEY_EVENT = 'tsu.currentEvent';
const KEY_MINE = 'tsu.mineOnly';

const read = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const { events, loaded } = useData();
  const { me } = useAuth();
  const [currentEventId, setEvt] = useState('');
  const [mineOnly, setMine] = useState(false);

  useEffect(() => { setEvt(read(KEY_EVENT)); setMine(read(KEY_MINE) === '1'); }, []);

  // Default to the nearest upcoming event when nothing is chosen or the chosen one is gone.
  useEffect(() => {
    if (!loaded) return;
    if (currentEventId && events.some((e) => e.id === currentEventId)) return;
    const upcoming = [...events].filter((e) => e.status === 'upcoming').sort((a, b) => a.startDate.localeCompare(b.startDate));
    const pick = upcoming[0] ?? events[0];
    if (pick) { setEvt(pick.id); write(KEY_EVENT, pick.id); }
  }, [loaded, events, currentEventId]);

  const value = useMemo<Prefs>(() => ({
    currentEventId,
    setCurrentEventId: (id) => { setEvt(id); write(KEY_EVENT, id); },
    mineOnly,
    setMineOnly: (v) => { setMine(v); write(KEY_MINE, v ? '1' : '0'); },
    isMine: (item) => !mineOnly || !item || item.managerId === me,
  }), [currentEventId, mineOnly, me]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs(): Prefs {
  const c = useContext(Ctx);
  if (!c) throw new Error('usePrefs outside PrefsProvider');
  return c;
}
