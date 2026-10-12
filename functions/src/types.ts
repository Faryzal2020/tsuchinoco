// Mirror of the fields the functions touch. Keep in sync with src/types/index.ts.
export interface Variant { id: string; name: string; active: boolean }
export interface BundleComponent { itemId: string; variantId: string; qty: number; allocatedPrice?: number }
export interface Item {
  id: string; name: string; kind: 'product' | 'bundle'; type: string; price: number; active: boolean;
  variants: Variant[]; components: BundleComponent[];
}
export interface OfferingEntry { itemId: string; variantId?: string }
export interface BatchForm {
  provider: 'jotform'; formId: string; url: string;
  fieldMap: Record<string, string>;
  customerFields: { name: string; email: string; phone: string; fulfilment?: string; address: string };
  generatedAt: number;
}
export interface Batch {
  id: string; eventId: string; number: number; mode: 'preorder' | 'post'; status: string;
  offering: OfferingEntry[]; form?: BatchForm;
}
export interface Event { id: string; name: string }
export interface RawLine { itemId: string; variantId?: string; qty: number; unitPrice: number; lineTotal: number }
export interface OrderLine { itemId: string; variantId: string; qty: number; unitPrice: number; fromBundleItemId?: string }
export type Fulfilment = 'pickup' | 'mail';
export type OrderStatus = 'awaiting_pickup' | 'collected' | 'not_collected' | 'awaiting_shipment' | 'shipped' | 'cancelled';
export interface Order {
  eventId: string; batchId: string; source: 'jotform' | 'manual' | 'web'; externalId: string; submittedAt: number;
  customer: { name: string; email: string; phone: string; address?: string };
  fulfilment: Fulfilment; status: OrderStatus; rawLines: RawLine[]; lines: OrderLine[]; total: number; notes: string;
  createdAt: number; updatedAt: number; updatedBy: string;
}
