'use client';

import React, { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { useData } from '@/lib/data';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/ui/Toast';
import { collection, deleteField, doc, getDocs, updateDoc } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, functions, storage } from '@/lib/firebase';
import { dataUrlToBlob } from '@/lib/media';
import { COL, settingsRepo, staffRepo } from '@/lib/repo';
import type { Media } from '@/types';
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

          <CloudStoragePanel />

          <Panel>
            <h2 className="font-bold mb-1">JotForm connection (legacy)</h2>
            <p className="hint mb-3">Only for batches that still use a JotForm. Needs the Cloud Functions deployed, which needs the Blaze plan. New batches use the in-house form.</p>
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

function CloudStoragePanel() {
  const { run } = useToast();
  const [stats, setStats] = useState<{ total: number; storage: number; inline: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [progress, setProgress] = useState('');

  const checkMedia = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, COL.media));
      let inStorage = 0;
      let inline = 0;
      snap.forEach((d) => {
        const m = d.data() as Media;
        if (m.url) inStorage++;
        else if (m.dataUrl) inline++;
      });
      setStats({ total: snap.size, storage: inStorage, inline });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkMedia();
  }, []);

  const migrateMedia = async () => {
    setMigrating(true);
    setProgress('Finding inline media…');
    await run(async () => {
      const snap = await getDocs(collection(db, COL.media));
      const unmigrated: { id: string; data: Media }[] = [];
      snap.forEach((d) => {
        const m = { id: d.id, ...(d.data() as Omit<Media, 'id'>) };
        if (!m.url && m.dataUrl) unmigrated.push({ id: d.id, data: m });
      });

      if (unmigrated.length === 0) {
        setProgress('All media are already stored in Cloud Storage!');
        return;
      }

      let count = 0;
      for (const item of unmigrated) {
        count++;
        setProgress(`Migrating ${count}/${unmigrated.length}: ${item.data.name || item.id}…`);
        try {
          const blob = dataUrlToBlob(item.data.dataUrl!);
          const safeName = (item.data.name || 'image').replace(/[^a-zA-Z0-9.-]/g, '_');
          const storagePath = `media/${item.id}_${safeName}`;
          const storageRef = ref(storage, storagePath);
          const uploadSnap = await uploadBytes(storageRef, blob, { contentType: item.data.mime || 'image/jpeg' });
          const url = await getDownloadURL(uploadSnap.ref);

          await updateDoc(doc(db, COL.media, item.id), {
            url,
            storagePath,
            dataUrl: deleteField(),
          });
        } catch (err) {
          console.error(`Failed to migrate media ${item.id}:`, err);
        }
      }
      setProgress(`Finished migrating ${count} media objects.`);
      await checkMedia();
    }, 'Media migration completed');
    setMigrating(false);
  };

  const bucket = storage.app.options.storageBucket;

  return (
    <Panel>
      <h2 className="font-bold mb-1">Cloud Storage & Media (Phase 4)</h2>
      <p className="hint mb-3">
        Cloud Storage stores catalogue images and receipt uploads as files instead of 1 MB Firestore base64 documents.
      </p>
      <div className="grid gap-2 text-xs mb-3">
        <div className="flex items-center gap-2">
          <span className="text-ink-2 font-medium">Bucket:</span>
          <span className="mono">{bucket || 'Not configured'}</span>
        </div>
        {stats && (
          <div className="flex items-center gap-2">
            <span className="text-ink-2 font-medium">Media:</span>
            <span>
              <b>{stats.storage}</b> in Cloud Storage · <b>{stats.inline}</b> inline in Firestore (total {stats.total})
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={checkMedia} busy={loading} disabled={migrating}>
          Refresh status
        </Button>
        {stats && stats.inline > 0 && (
          <Button size="sm" variant="primary" onClick={migrateMedia} busy={migrating}>
            Migrate {stats.inline} inline images
          </Button>
        )}
      </div>
      {progress && <p className="hint mt-2 text-xs font-mono">{progress}</p>}
    </Panel>
  );
}
