'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db, googleProvider, isFirebaseConfigured } from './firebase';
import type { Staff } from '@/types';

type AuthState =
  | { phase: 'loading' }
  | { phase: 'signed_out' }
  | { phase: 'not_staff'; user: User }
  | { phase: 'ready'; user: User; staff: Staff };

interface AuthCtx {
  state: AuthState;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Lower-cased email of the signed-in staff member, '' when not ready. */
  me: string;
  meName: string;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [staff, setStaff] = useState<Staff | null | undefined>(undefined);

  useEffect(() => {
    if (!isFirebaseConfigured) { setUser(null); return; }
    // Customers on the public form sign in anonymously (no email). In the staff app that
    // counts as signed out; the Google popup replaces the anonymous user.
    return onAuthStateChanged(auth, (u) => { const staffUser = u && u.email ? u : null; setUser(staffUser); if (!staffUser) setStaff(undefined); });
  }, []);

  useEffect(() => {
    if (!user?.email) return;
    const id = user.email.toLowerCase();
    return onSnapshot(
      doc(db, 'staff', id),
      (snap) => setStaff(snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<Staff, 'id'>) }) : null),
      () => setStaff(null),
    );
  }, [user]);

  let state: AuthState;
  if (user === undefined || (user && staff === undefined)) state = { phase: 'loading' };
  else if (!user) state = { phase: 'signed_out' };
  else if (!staff || !staff.active) state = { phase: 'not_staff', user };
  else state = { phase: 'ready', user, staff };

  const value: AuthCtx = {
    state,
    signIn: async () => { await signInWithPopup(auth, googleProvider); },
    signOut: async () => { await signOut(auth); },
    me: state.phase === 'ready' ? state.staff.id : '',
    meName: state.phase === 'ready' ? state.staff.displayName : '',
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}
