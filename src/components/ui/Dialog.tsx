'use client';

import React, { useEffect, useRef } from 'react';
import Button from './Button';

export function Modal({ open, onClose, title, children, footer, wide }: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" style={wide ? { maxWidth: 'min(860px, calc(100vw - 32px))' } : undefined} onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      {open && (
        <div>
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-base font-bold">{title}</h2>
            <Button variant="quiet" size="sm" onClick={onClose} aria-label="Close">Close</Button>
          </div>
          <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3 bg-cream">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}

export function Confirm({ open, onClose, onConfirm, title, children, confirmLabel = 'Confirm', danger, busy }: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  children?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} busy={busy}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="text-sm text-ink-2">{children}</div>
    </Modal>
  );
}
