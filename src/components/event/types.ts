import type { Batch, Event, Order } from '@/types';

export interface TabProps {
  event: Event;
  batches: Batch[];
  orders: Order[];
}
