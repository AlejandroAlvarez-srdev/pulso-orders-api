export enum OrderStatus {
  CREATED = 'CREATED',
  PAYMENT_PENDING = 'PAYMENT_PENDING',
  PAID = 'PAID',
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

export interface Location {
  lat: number;
  lng: number;
  address: string;
}

export interface OrderItem {
  sku: string;
  name: string;
  qty: number;
}

export type Currency = 'MXN';

export interface Order {
  id: string;
  merchantId: string;
  status: OrderStatus;
  pickup: Location;
  dropoff: Location;
  items: OrderItem[];
  amountCents: number;
  currency: Currency;
  createdAt: Date;
  updatedAt: Date;
  /** Optimistic-concurrency token, incremented on every status change. */
  version: number;
}

export interface NewOrderInput {
  pickup: Location;
  dropoff: Location;
  items: OrderItem[];
  amountCents: number;
  currency: Currency;
}
