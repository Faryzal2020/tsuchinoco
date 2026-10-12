'use client';

import React, { createContext, useCallback, useContext, useState } from 'react';
import { cn } from '@/lib/utils';

interface Toast { id: number; text: string; error?: boolean }
interface ToastCtx {
  toast: (text: string) => void;
  error: (text: string) => void;
  /** Run an async action, toasting the outcome. Returns true on success. */
  run: (action: () => Promise<unknown>, okText?: string) => Promise<boolean>;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((text: string, error?: boolean) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, text, error }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), error ? 6000 : 3000);
  }, []);
  const value: ToastCtx = {
    toast: (t) => push(t),
    error: (t) => push(t, true),
    run: async (action, okText) => {
      try {
        await action();
        if (okText) push(okText);
        return true;
      } catch (e) {
        console.error(e);
        push(e instanceof Error ? e.message : 'Something went wrong', true);
        return false;
      }
    },
  };
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
        {list.map((t) => (
          <div key={t.id} className={cn('toast', t.error && 'toast-error')} role="status">{t.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast outside ToastProvider');
  return c;
}
