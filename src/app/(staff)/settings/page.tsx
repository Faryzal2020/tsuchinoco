'use client';

import React, { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { useData } from '@/lib/data';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { settingsRepo, staffRepo } from '@/lib/repo';
import { functions } from '@/lib/firebase';
import Button from '@/components/ui/Button';
import { Checkbox, Field, Input } from '@/components/ui/Field';
import { PageHeader, Panel, Pill, TableWrap } from '@/components/ui/Bits';

export default function SettingsPage() {
  const { staff, settings, items } = useData();
  const { me } = useAuth();
  const { run, error } = useToast();

  // Staff
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const addStaff = async () => {
    if (!email.includes('@') || !name.trim()) return;
    const ok = await run(() => staffRepo.upsert(email, { displayName: name.trim(), active: true }, me), 'Staff member added');
    if (ok) { setEmail(''); setName(''); }
  };

  // Defaults
  const [currency, setCurrency] = useState(settings.currency);
  const [deadline, setDeadline] = useState(String(settings.pickupDeadlineDays));
  const [types, setTypes] = useState(settings.itemTypes.join('\n'));
  useEffect(() => { setCurrency(settings.currency); setDeadline(String(settings.pickupDeadlineDays)); setTypes(settings.itemTypes.join('\n')); }, [settings]);
  const saveDefaults = () => {
    const itemTypes = types.split('\n').map((t) => t.trim().toLowerCase()).filter(Boolean);
    const inUse = new Set(items.map((i) => i.type));
    const missing = [...inUse].filter((t) => t !== 'bundle' && !itemTypes.includes(t));
    if (missing.length) { error(`Types still in use by items: ${missing.join(', ')}`); return; }
    return run(() => settingsRepo.save({ currency: currency.trim() || 'IDR', pickupDeadlineDays: Math.max(1, Number(deadline) || 30), itemTypes: [...new Set(itemTypes)] }, me), 'Settings saved');
  };

  // JotForm
  const [jf, setJf] = useState<{ state: 'idle' | 'busy' | 'ok' | 'fail'; text: string }>({ state: 'idle', text: '' });
  const testJotform = async () => {
    setJf({ state: 'busy', text: '' });
    try {
      const res = await httpsCallable<unknown, { ok: boolean; username?: string; message?: string }>(functions, 'jotformStatus')({});
      setJf(res.data.ok ? { state: 'ok', text: `Connected as ${res.data.username}` } : { state: 'fail', text: res.data.message ?? 'Not connected' });
    } catch (e) {
      setJf({ state: 'fail', text: e instanceof Error ? e.message : 'Function not reachable' });
    }
  };

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel pad={false}>
          <div className="panel-pad pb-3">
            <h2 className="font-bold">Staff</h2>
            <p className="hint">Anyone on this list can sign in with that Google account and edit everything. Deactivate instead of deleting so history keeps its names.</p>
          </div>
          <TableWrap className="rounded-none border-x-0">
            <thead><tr><th>Name</th><th>Email</th><th>Access</th><th /></tr></thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id}>
                  <td className="font-semibold">{s.displayName}</td>
                  <td className="text-ink-2">{s.email}</td>
                  <td>{s.active ? <Pill tone="green">Active</Pill> : <Pill>Inactive</Pill>}</td>
                  <td className="text-right">
                    {s.id !== me && <Button size="sm" onClick={() => run(() => staffRepo.patch(s.id, { active: !s.active }, me))}>{s.active ? 'Deactivate' : 'Activate'}</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <div className="panel-pad grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-end">
            <Field label="Google email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@gmail.com" /></Field>
            <Field label="Display name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Button variant="primary" onClick={addStaff} disabled={!email.includes('@') || !name.trim()}>Add</Button>
          </div>
        </Panel>

        <div className="grid gap-5 content-start">
          <Panel>
            <h2 className="font-bold mb-3">Defaults</h2>
            <div className="grid gap-3">
              <Field label="Currency code" hint="Display only."><Input value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-[120px]" /></Field>
              <Field label="Days before an uncollected pickup returns to stock" hint="Default for new events; each event can override it."><Input type="number" min={1} value={deadline} onChange={(e) => setDeadline(e.target.value)} className="w-[120px]" /></Field>
              <Field label="Item types, one per line" hint="Lower-case. A type still used by an item cannot be removed.">
                <textarea className="textarea font-mono text-[13px]" rows={7} value={types} onChange={(e) => setTypes(e.target.value)} />
              </Field>
              <div><Button variant="primary" onClick={saveDefaults}>Save defaults</Button></div>
            </div>
          </Panel>

          <Panel>
            <h2 className="font-bold mb-1">JotForm connection</h2>
            <p className="hint mb-3">The API key is stored as a Cloud Functions secret, not here. See docs/DEPLOYMENT.md to set or rotate it.</p>
            <div className="flex items-center gap-3">
              <Button onClick={testJotform} busy={jf.state === 'busy'}>Test connection</Button>
              {jf.state === 'ok' && <Pill tone="green">{jf.text}</Pill>}
              {jf.state === 'fail' && <Pill tone="red">{jf.text}</Pill>}
            </div>
          </Panel>

          <Panel>
            <h2 className="font-bold mb-1">Signed in as</h2>
            <p className="text-sm text-ink-2">{me}</p>
            <Checkbox className="mt-2" label="I understand everyone on the staff list can edit everything" checked readOnly />
          </Panel>
        </div>
      </div>
    </>
  );
}
