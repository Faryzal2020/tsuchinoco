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
import { usePrefs } from '@/lib/prefs';
import { FREE_LIMITS, FREE_STORAGE_REGIONS, useUsageReport } from '@/lib/usage';
import { meterRead } from '@/lib/readMeter';
import BrowserReadsPanel from '@/components/settings/BrowserReadsPanel';
import { DailyBars, Meter, fmtBytes, fmtCount } from '@/components/settings/UsageMeters';
import type { Media } from '@/types';
import Button from '@/components/ui/Button';
import { Checkbox, Field, Input } from '@/components/ui/Field';
import StorefrontPanel from '@/components/settings/StorefrontPanel';
import NotificationsPanel from '@/components/settings/NotificationsPanel';
import { PageHeader, Panel, Pill, TableWrap } from '@/components/ui/Bits';

export default function SettingsPage() {
  const { staff, settings, items } = useData();
  const { me } = useAuth();
  const { run, error, toast } = useToast();
  const { allowDelete, setAllowDelete } = usePrefs();
  const usage = useUsageReport();

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

          <SignaturePanel />

          <StorefrontPanel />

          <NotificationsPanel />

          <CloudStoragePanel usage={usage} />

          <UsageTrafficPanel usage={usage} />

          <BrowserReadsPanel />

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
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-bold">Deletion Safety Controls</h2>
              {allowDelete ? (
                <Pill tone="yellow">Deletions Enabled</Pill>
              ) : (
                <Pill tone="green">Protected (Delete Buttons Disabled)</Pill>
              )}
            </div>
            <p className="hint mb-3">
              Personal safety preference bound to your browser user session. When turned off, all delete buttons (delete item, bulk delete, clear catalogue, delete batch) will be greyed out across all pages to prevent accidental data loss.
            </p>
            <div className="flex items-center gap-3">
              <Checkbox
                label="Enable delete and clear actions"
                checked={allowDelete}
                onChange={(e) => {
                  setAllowDelete(e.target.checked);
                  toast(e.target.checked ? 'Delete actions enabled' : 'Delete actions locked and disabled');
                }}
              />
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

type Usage = ReturnType<typeof useUsageReport>;

function CloudStoragePanel({ usage }: { usage: Usage }) {
  const { run } = useToast();
  const [stats, setStats] = useState<{ total: number; storage: number; inline: number; storageBytes: number; inlineBytes: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [progress, setProgress] = useState('');

  const checkMedia = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, COL.media));
      meterRead('settings:media', snap.size);
      let inStorage = 0;
      let inline = 0;
      let storageBytes = 0;
      let inlineBytes = 0;
      snap.forEach((d) => {
        const m = d.data() as Media;
        if (m.url) { inStorage++; storageBytes += m.bytes || 0; }
        else if (m.dataUrl) { inline++; inlineBytes += m.dataUrl.length; }
      });
      setStats({ total: snap.size, storage: inStorage, inline, storageBytes, inlineBytes });
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const migrateMedia = async () => {
    setMigrating(true);
    setProgress('Finding inline media…');
    await run(async () => {
      const snap = await getDocs(collection(db, COL.media));
      meterRead('settings:media', snap.size);
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
  const r = usage.report;
  const L = FREE_LIMITS.storage;
  const location = r?.storage.location?.toLowerCase();
  const freeRegion = !location || FREE_STORAGE_REGIONS.includes(location);

  return (
    <Panel>
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="font-bold">Cloud Storage & Media (Phase 4)</h2>
        {location && (freeRegion ? <Pill tone="green">{location}</Pill> : <Pill tone="yellow">{location} · no free tier</Pill>)}
      </div>
      <p className="hint mb-3">
        Cloud Storage stores catalogue images and receipt uploads as files instead of 1 MB Firestore base64 documents.
      </p>
      <div className="grid gap-2 text-xs mb-3">
        <div className="flex items-center gap-2">
          <span className="text-ink-2 font-medium">Bucket:</span>
          <span className="mono">{bucket || 'Not configured'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-ink-2 font-medium">Media:</span>
          {stats ? (
            <span>
              <b>{stats.storage}</b> in Cloud Storage ({fmtBytes(stats.storageBytes)}) · <b>{stats.inline}</b> inline in Firestore ({fmtBytes(stats.inlineBytes)}) · total {stats.total}
            </span>
          ) : (
            <span className="text-muted">Not counted. Counting reads every media record once.</span>
          )}
        </div>
      </div>

      <div className="grid gap-4 border-t border-line pt-3 mb-3">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-bold">Capacity against the free plan</h3>
          <span className="text-xs text-muted">{r ? `Month since ${new Date(r.monthStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}</span>
        </div>
        {!freeRegion && (
          <p className="hint text-xs">
            The no-cost Cloud Storage allowance only applies to buckets in {FREE_STORAGE_REGIONS.join(', ')}. This bucket is billed from the first byte; the bars show how far you would be into the free allowance.
          </p>
        )}
        <Meter
          label="Files stored"
          used={r?.storage.storedBytes}
          limit={L.storedBytes}
          format={fmtBytes}
          sub={r?.storage.objects != null ? `${fmtCount(r.storage.objects)} files, includes receipts and soft-deleted copies` : 'Includes receipts and soft-deleted copies'}
        />
        <Meter label="Downloaded this month" used={r?.storage.egressMonth} limit={L.egressPerMonth} per="month" format={fmtBytes} sub="Images served to the form and staff app" />
        <Meter label="Upload operations this month" used={r?.storage.classAMonth} limit={L.uploadsPerMonth} per="month" sub="Uploads, listings and metadata changes (Class A)" />
        <Meter label="Download operations this month" used={r?.storage.classBMonth} limit={L.downloadsPerMonth} per="month" sub="File and metadata reads (Class B)" />
        {r && r.storage.ops.length > 0 && (
          <details className="text-xs text-muted -mt-2">
            <summary className="cursor-pointer">Operations by type this month</summary>
            <div className="mt-1 grid gap-0.5">
              {r.storage.ops.map((o) => (
                <div key={o.method} className="flex justify-between gap-4"><span className="mono">{o.method}</span><span className="tabular-nums">{fmtCount(o.count)}</span></div>
              ))}
            </div>
          </details>
        )}
        <Meter
          label="Firestore database size"
          used={r?.firestore.storedBytes}
          limit={FREE_LIMITS.firestore.storedBytes}
          format={fmtBytes}
          sub={stats?.inline ? `Includes ${fmtBytes(stats.inlineBytes)} of inline images` : 'Documents and indexes'}
        />
        <Meter label="Hosting files" used={r?.hosting.storedBytes} limit={FREE_LIMITS.hosting.storedBytes} format={fmtBytes} sub="Deployed app, all kept releases" />
        {usage.error && <p className="hint text-xs">Usage figures are unavailable; see Usage &amp; traffic below.</p>}
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={usage.refresh} busy={usage.loading} disabled={migrating}>
          Refresh status
        </Button>
        <Button size="sm" onClick={checkMedia} busy={loading} disabled={migrating}>
          {stats ? 'Count media again' : 'Count media'}
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

function UsageError({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-line bg-cream-2 p-3 text-xs">
      <p className="font-semibold">Usage figures are unavailable: {message}</p>
      <p className="text-ink-2 mt-1">
        They come from the <span className="mono">usageMetrics</span> Cloud Function. Deploy it with{' '}
        <span className="mono">firebase deploy --only functions:usageMetrics</span>, and make sure the Cloud Monitoring API is enabled for the project.
      </p>
    </div>
  );
}

function UsageTrafficPanel({ usage }: { usage: Usage }) {
  const { report: r, loading, error, refresh } = usage;
  const F = FREE_LIMITS.firestore;
  const reset = r ? new Date(r.dayStart + 86_400_000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <Panel>
      <div className="flex items-center justify-between gap-3 mb-1">
        <h2 className="font-bold">Usage & traffic</h2>
        <Button size="sm" onClick={refresh} busy={loading}>Refresh</Button>
      </div>
      <p className="hint mb-3">
        Compared with Firebase&apos;s no-cost quotas. Daily quotas reset at midnight Pacific time{reset ? ` (${reset} your time)` : ''}. Figures lag a few minutes; Hosting traffic can lag about an hour.
      </p>

      {error && !r && <UsageError message={error} />}
      {r && (
        <div className="grid gap-5">
          <section className="grid gap-3">
            <h3 className="text-sm font-bold">Firestore today{reset ? <span className="font-normal text-muted"> · counters reset at {reset}</span> : null}</h3>
            <Meter label="Document reads" used={r.firestore.reads} limit={F.readsPerDay} per="day" sub="Every document a page or form loads" />
            <Meter label="Document writes" used={r.firestore.writes} limit={F.writesPerDay} per="day" sub="Orders, submissions, edits, logs" />
            <Meter label="Document deletes" used={r.firestore.deletes} limit={F.deletesPerDay} per="day" />
            <DailyBars label="Reads per day" days={r.firestore.daily.reads} today={r.firestore.reads} />
            <DailyBars label="Writes per day" days={r.firestore.daily.writes} today={r.firestore.writes} />
          </section>

          <section className="grid gap-3 border-t border-line pt-3">
            <h3 className="text-sm font-bold">Website traffic</h3>
            <Meter label="Hosting transfer today" used={r.hosting.egressToday} limit={FREE_LIMITS.hosting.egressPerDay} per="day" format={fmtBytes} sub="App and public form pages served" />
            <DailyBars label="Hosting transfer per day" days={r.hosting.egressDaily} today={r.hosting.egressToday} format={fmtBytes} />
            <DailyBars label="Image downloads per day (Cloud Storage)" days={r.storage.egressDaily} format={fmtBytes} />
          </section>

          <section className="grid gap-3 border-t border-line pt-3">
            <h3 className="text-sm font-bold">Cloud Functions this month</h3>
            <Meter label="Invocations" used={r.functions.requestsMonth} limit={FREE_LIMITS.functions.invocationsPerMonth} per="month" sub="Email broadcasts and this usage check" />
            {r.functions.byService.length > 0 && (
              <div className="grid gap-0.5 text-xs">
                {r.functions.byService.map((f) => (
                  <div key={f.name} className="flex justify-between gap-3">
                    <span className="mono text-ink-2">{f.name}</span>
                    <span className="tabular-nums">{fmtCount(f.count)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="border-t border-line pt-3 text-xs text-muted">
            <span>Updated {new Date(r.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · project <span className="mono">{r.projectId}</span></span>
          </div>
          {r.errors.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-red-ink">{r.errors.length} metric{r.errors.length === 1 ? '' : 's'} could not be read</summary>
              <ul className="mt-1 grid gap-1 text-ink-2">
                {r.errors.map((e) => <li key={e} className="mono break-all">{e}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}
    </Panel>
  );
}

/** The signed-in staff member's reply signature for the shared inbox. */
function SignaturePanel() {
  const { state, me } = useAuth();
  const { run } = useToast();
  const saved = state.phase === 'ready' ? state.staff.mailSignature ?? '' : '';
  const [text, setText] = useState(saved);
  useEffect(() => { setText(saved); }, [saved]);
  return (
    <Panel>
      <h2 className="font-bold">Your reply signature</h2>
      <p className="hint mb-3">Added under every reply you send from the shared inbox, so customers know who answered. Only you see and change yours.</p>
      <textarea className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={'— Rina, Tsuchinoco'} maxLength={500} />
      <div className="mt-2"><Button variant="primary" disabled={text === saved} onClick={() => run(() => staffRepo.patch(me, { mailSignature: text.trim() }, me), 'Signature saved')}>Save signature</Button></div>
    </Panel>
  );
}
