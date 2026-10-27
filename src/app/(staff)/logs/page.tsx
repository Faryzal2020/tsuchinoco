'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { COL } from '@/lib/repo';
import { useData } from '@/lib/data';
import { formatDateTime, titleCase } from '@/lib/format';
import { downloadCsv, toCsv } from '@/lib/csv';
import Button from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Empty, Loading, PageHeader, Pill, TableWrap } from '@/components/ui/Bits';
import { Modal } from '@/components/ui/Dialog';
import { QueryPage, useQuery } from '@/lib/useQuery';
import type { LogAction, LogEntry, LogEntityType } from '@/types';

function ActionBadge({ action }: { action: LogAction }) {
  let tone: 'neutral' | 'blue' | 'yellow' | 'green' | 'red' = 'neutral';
  const label = titleCase(action.replace('_', ' '));

  switch (action) {
    case 'create':
    case 'bulk_create':
      tone = 'green';
      break;
    case 'update':
    case 'bulk_update':
      tone = 'blue';
      break;
    case 'delete':
    case 'bulk_delete':
    case 'clear':
      tone = 'red';
      break;
    case 'publish':
      tone = 'blue';
      break;
    case 'status_change':
      tone = 'yellow';
      break;
  }

  return <Pill tone={tone}>{label}</Pill>;
}

function EntityBadge({ entityType }: { entityType: LogEntityType }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-cream-2 text-ink border border-line">
      {titleCase(entityType)}
    </span>
  );
}

function DiffValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="italic text-ink-3 text-xs">(none)</span>;
  }

  if (typeof value === 'boolean') {
    return (
      <span
        className={`inline-flex px-1.5 py-0.5 rounded text-[11px] mono font-semibold ${
          value
            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
            : 'bg-red-100 text-red-800 border border-red-200'
        }`}
      >
        {String(value)}
      </span>
    );
  }

  if (typeof value === 'number') {
    return <span className="mono text-xs font-semibold">{value.toLocaleString()}</span>;
  }

  if (typeof value === 'string') {
    if (value.trim() === '') {
      return <span className="italic text-ink-3 text-xs">(empty)</span>;
    }
    // Check if it's a hex color
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) {
      return (
        <span className="inline-flex items-center gap-1.5 mono text-xs">
          <span
            className="w-3.5 h-3.5 rounded border border-line shadow-2xs inline-block shrink-0"
            style={{ backgroundColor: value }}
          />
          <span className="font-semibold">{value}</span>
        </span>
      );
    }
    return <span className="mono text-xs whitespace-pre-wrap">{value}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="italic text-ink-3 text-xs">[ ] (empty)</span>;
    }
    return (
      <div className="space-y-1">
        <span className="text-[10px] text-ink-2 font-medium">({value.length} items)</span>
        <pre className="mono text-[11px] bg-white/80 p-1.5 rounded border border-line/60 max-h-[140px] overflow-auto whitespace-pre-wrap">
          {JSON.stringify(value, null, 2)}
        </pre>
      </div>
    );
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value as object);
    if (keys.length === 0) {
      return <span className="italic text-ink-3 text-xs">{'{ }'} (empty)</span>;
    }
    return (
      <pre className="mono text-[11px] bg-white/80 p-1.5 rounded border border-line/60 max-h-[140px] overflow-auto whitespace-pre-wrap">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  return <span className="mono text-xs">{String(value)}</span>;
}

function LogsContent() {
  const { staff, staffName } = useData();
  const { get, set } = useQuery();

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [inspectLog, setInspectLog] = useState<LogEntry | null>(null);

  const actionFilter = get('action') as LogAction | '';
  const entityFilter = get('entity') as LogEntityType | '';
  const userFilter = get('user');

  // Real-time subscription to immutable audit logs
  useEffect(() => {
    const q = query(
      collection(db, COL.logs),
      orderBy('createdAt', 'desc'),
      limit(300)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        })) as LogEntry[];
        setLogs(rows);
        setLoading(false);
      },
      (err) => {
        console.error('[logs] Failed to read logs:', err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (actionFilter && log.action !== actionFilter) return false;
      if (entityFilter && log.entityType !== entityFilter) return false;
      if (userFilter && log.createdBy !== userFilter) return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        const matchAction = log.action.toLowerCase().includes(q);
        const matchEntity = log.entityType.toLowerCase().includes(q);
        const matchDetails = log.details.toLowerCase().includes(q);
        const matchBy = (log.createdBy || '').toLowerCase().includes(q);
        const matchName = (log.entityName || '').toLowerCase().includes(q);
        const matchId = (log.entityId || '').toLowerCase().includes(q);
        if (!matchAction && !matchEntity && !matchDetails && !matchBy && !matchName && !matchId) {
          return false;
        }
      }

      return true;
    });
  }, [logs, actionFilter, entityFilter, userFilter, search]);

  const exportCsv = () => {
    downloadCsv(
      'audit_logs',
      toCsv(
        filteredLogs.map((l) => ({
          id: l.id,
          timestamp: new Date(l.createdAt).toISOString(),
          formattedDate: formatDateTime(l.createdAt),
          action: l.action,
          entityType: l.entityType,
          entityId: l.entityId || '',
          entityName: l.entityName || '',
          details: l.details,
          actor: l.createdBy,
        }))
      )
    );
  };

  const hasActiveFilters = Boolean(actionFilter || entityFilter || userFilter || search);

  const resetFilters = () => {
    setSearch('');
    set({ action: '', entity: '', user: '' });
  };

  return (
    <>
      <PageHeader
        title="Audit Logs"
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={exportCsv} disabled={filteredLogs.length === 0}>
              Export CSV
            </Button>
          </div>
        }
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span>Immutable audit record of all data changes and administrative operations.</span>
        </div>
      </PageHeader>

      {/* Filter Toolbar */}
      <div className="mb-4 flex flex-wrap lg:flex-nowrap items-center gap-2 bg-white/95 p-2 rounded-xl border border-line shadow-xs">
        <Input
          placeholder="Search activity, entity, actor, details…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[220px]"
        />

        <Select
          small
          value={actionFilter}
          onChange={(e) => set({ action: e.target.value })}
          className="w-auto min-w-[140px]"
        >
          <option value="">All Actions</option>
          <option value="create">Create</option>
          <option value="update">Update</option>
          <option value="delete">Delete</option>
          <option value="bulk_create">Bulk Create</option>
          <option value="bulk_update">Bulk Update</option>
          <option value="bulk_delete">Bulk Delete</option>
          <option value="clear">Clear</option>
          <option value="publish">Publish</option>
          <option value="status_change">Status Change</option>
        </Select>

        <Select
          small
          value={entityFilter}
          onChange={(e) => set({ entity: e.target.value })}
          className="w-auto min-w-[140px]"
        >
          <option value="">All Entities</option>
          <option value="item">Item / Catalogue</option>
          <option value="event">Event</option>
          <option value="batch">Batch</option>
          <option value="order">Order</option>
          <option value="submission">Submission</option>
          <option value="form">Form</option>
          <option value="movement">Stock Movement</option>
          <option value="wrapup">Wrap-up</option>
          <option value="settings">Settings</option>
          <option value="staff">Staff</option>
        </Select>

        <Select
          small
          value={userFilter || ''}
          onChange={(e) => set({ user: e.target.value })}
          className="w-auto min-w-[140px]"
        >
          <option value="">All Staff</option>
          {staff.map((s) => (
            <option key={s.id} value={s.email || s.id}>
              {s.displayName}
            </option>
          ))}
        </Select>

        {hasActiveFilters && (
          <Button size="sm" variant="quiet" onClick={resetFilters}>
            Reset
          </Button>
        )}
      </div>

      {loading ? (
        <Loading />
      ) : filteredLogs.length === 0 ? (
        <Empty
          title={hasActiveFilters ? 'No matching logs' : 'No activity logged yet'}
          action={
            hasActiveFilters ? (
              <Button size="sm" onClick={resetFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        >
          {hasActiveFilters
            ? 'Try broadening your search or clearing selected filters.'
            : 'Any changes or data-altering activities across any pages will be recorded here.'}
        </Empty>
      ) : (
        <TableWrap>
          <thead>
            <tr>
              <th className="w-[170px]">Timestamp</th>
              <th className="w-[120px]">Action</th>
              <th className="w-[110px]">Entity</th>
              <th>Details</th>
              <th className="w-[180px]">Actor</th>
              <th className="w-[70px] text-right">View</th>
            </tr>
          </thead>
          <tbody>
            {filteredLogs.map((log) => {
              const actorDisplay = staffName(log.createdBy) || log.createdBy || 'system';

              return (
                <tr
                  key={log.id}
                  className="cursor-pointer hover:bg-surface-2/40 transition-colors"
                  onClick={() => setInspectLog(log)}
                >
                  <td className="whitespace-nowrap mono text-xs text-ink-2">
                    {formatDateTime(log.createdAt)}
                  </td>
                  <td>
                    <ActionBadge action={log.action} />
                  </td>
                  <td>
                    <EntityBadge entityType={log.entityType} />
                  </td>
                  <td>
                    <div className="font-medium text-ink break-words line-clamp-2">
                      {log.details}
                    </div>
                    {log.entityName && (
                      <div className="text-xs text-ink-2 mt-0.5">
                        Target: <span className="font-semibold">{log.entityName}</span>
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-xs text-ink-2">
                    <span className="font-medium text-ink">{actorDisplay}</span>
                  </td>
                  <td className="text-right">
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={(e) => {
                        e.stopPropagation();
                        setInspectLog(log);
                      }}
                    >
                      Inspect
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      )}

      {/* Inspect Log Modal */}
      {inspectLog && (
        <Modal
          open={!!inspectLog}
          onClose={() => setInspectLog(null)}
          title="Audit Log Details"
          footer={<Button onClick={() => setInspectLog(null)}>Close</Button>}
        >
          <div className="space-y-4">
            <div className="p-3 bg-surface-2 rounded-lg border border-line flex items-center justify-between">
              <div>
                <span className="text-xs text-ink-2 uppercase tracking-wide block">Log ID</span>
                <span className="mono text-xs font-bold text-ink">{inspectLog.id}</span>
              </div>
              <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-semibold border border-emerald-300">
                🔒 Immutable Record
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="p-2.5 rounded-lg border border-line bg-white">
                <span className="text-xs text-ink-2 block mb-1">Timestamp</span>
                <span className="font-semibold mono text-xs">
                  {formatDateTime(inspectLog.createdAt)}
                </span>
                <span className="text-[11px] text-ink-2 block mt-0.5">
                  Epoch: {inspectLog.createdAt}
                </span>
              </div>

              <div className="p-2.5 rounded-lg border border-line bg-white">
                <span className="text-xs text-ink-2 block mb-1">Actor</span>
                <span className="font-semibold text-xs">
                  {staffName(inspectLog.createdBy) || inspectLog.createdBy || 'system'}
                </span>
                <span className="text-[11px] text-ink-2 block mt-0.5">
                  ID: {inspectLog.createdBy}
                </span>
              </div>

              <div className="p-2.5 rounded-lg border border-line bg-white">
                <span className="text-xs text-ink-2 block mb-1">Action</span>
                <ActionBadge action={inspectLog.action} />
              </div>

              <div className="p-2.5 rounded-lg border border-line bg-white">
                <span className="text-xs text-ink-2 block mb-1">Entity Type</span>
                <EntityBadge entityType={inspectLog.entityType} />
              </div>
            </div>

            <div className="p-3 rounded-lg border border-line bg-white space-y-1">
              <span className="text-xs text-ink-2 block">Activity Summary</span>
              <p className="text-sm font-medium text-ink">{inspectLog.details}</p>
              {inspectLog.entityName && (
                <div className="text-xs text-ink-2 mt-1">
                  Target: <strong className="font-semibold text-ink">{inspectLog.entityName}</strong>
                </div>
              )}
            </div>

            {/* Changed Fields (Before & After) for Updates */}
            {inspectLog.changes && inspectLog.changes.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink uppercase tracking-wide">
                    Changed Fields ({inspectLog.changes.length})
                  </span>
                </div>
                <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                  {inspectLog.changes.map((change, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-lg border border-line bg-white shadow-xs space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="mono text-xs font-bold text-ink px-2 py-0.5 rounded bg-cream-2 border border-line">
                          {change.field}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        <div className="p-2.5 rounded-lg border border-red-200/80 bg-red-50/60 space-y-1">
                          <span className="text-[11px] font-semibold text-red-700 flex items-center gap-1">
                            <span>−</span> Before
                          </span>
                          <div className="text-ink break-words">
                            <DiffValue value={change.before} />
                          </div>
                        </div>
                        <div className="p-2.5 rounded-lg border border-emerald-200/80 bg-emerald-50/60 space-y-1">
                          <span className="text-[11px] font-semibold text-emerald-700 flex items-center gap-1">
                            <span>+</span> After
                          </span>
                          <div className="text-ink break-words">
                            <DiffValue value={change.after} />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

export default function LogsPage() {
  return (
    <QueryPage>
      <LogsContent />
    </QueryPage>
  );
}
