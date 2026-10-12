'use client';

import React from 'react';
import { useData, useEventOrders } from '@/lib/data';
import { formatDate } from '@/lib/format';
import { QueryPage, useQuery } from '@/lib/useQuery';
import Button from '@/components/ui/Button';
import { Loading, PageHeader, Panel, StatusPill, Tabs } from '@/components/ui/Bits';
import OverviewTab from '@/components/event/OverviewTab';
import BatchesTab from '@/components/event/BatchesTab';
import OrdersTab from '@/components/event/OrdersTab';
import PlanningTab from '@/components/event/PlanningTab';
import WrapupTab from '@/components/event/WrapupTab';
import ReportTab from '@/components/event/ReportTab';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'batches', label: 'Batches' },
  { id: 'orders', label: 'Orders' },
  { id: 'planning', label: 'Planning' },
  { id: 'wrapup', label: 'Wrap-up' },
  { id: 'report', label: 'Report' },
];

function EventView() {
  const { get } = useQuery();
  const id = get('id');
  const tab = get('tab', 'overview');
  const { events, batches } = useData();
  const event = events.find((e) => e.id === id);
  const eventBatches = batches.filter((b) => b.eventId === id);
  const { orders, loaded } = useEventOrders(id || undefined);

  if (!event) return <Panel>This event does not exist. <Button href="/events/" variant="quiet" size="sm">Back to events</Button></Panel>;

  const openBatch = eventBatches.find((b) => b.status === 'open');

  return (
    <>
      <PageHeader
        eyebrow={<><span>{formatDate(event.startDate)}{event.endDate !== event.startDate && ` – ${formatDate(event.endDate)}`}</span>{event.venue && <span> · {event.venue}</span>}</>}
        title={<span className="flex items-center gap-3">{event.name} <StatusPill status={event.status} /></span>}
        actions={<Button href="/events/">All events</Button>}
      >
        {openBatch ? <>Batch {openBatch.number} is open{openBatch.closesAt && `, closes ${formatDate(openBatch.closesAt)}`}.</> : eventBatches.length === 0 ? 'No batches yet.' : 'No batch is open.'}
      </PageHeader>
      <Tabs tabs={TABS} current={tab} hrefFor={(t) => `/events/view/?id=${id}&tab=${t}`} />
      {!loaded ? <Loading label="Loading orders…" /> : (
        <>
          {tab === 'overview' && <OverviewTab event={event} batches={eventBatches} orders={orders} />}
          {tab === 'batches' && <BatchesTab event={event} batches={eventBatches} orders={orders} />}
          {tab === 'orders' && <OrdersTab event={event} batches={eventBatches} orders={orders} />}
          {tab === 'planning' && <PlanningTab event={event} batches={eventBatches} orders={orders} />}
          {tab === 'wrapup' && <WrapupTab event={event} batches={eventBatches} orders={orders} />}
          {tab === 'report' && <ReportTab event={event} batches={eventBatches} orders={orders} />}
        </>
      )}
    </>
  );
}

export default function Page() {
  return <QueryPage><EventView /></QueryPage>;
}
