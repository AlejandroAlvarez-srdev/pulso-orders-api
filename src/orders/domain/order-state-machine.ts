import { InvalidTransitionError } from '../../common/domain-errors';
import { OrderStatus } from './order';

const S = OrderStatus;

/**
 * Single source of truth for the order lifecycle.
 *
 *   CREATED -> PAYMENT_PENDING -> PAID -> ASSIGNED -> IN_PROGRESS -> DELIVERED
 *
 * Cancellation is allowed until a pulser starts the task; once IN_PROGRESS the
 * order can only finish as DELIVERED or FAILED. Terminal statuses have no exits.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = Object.freeze({
  [S.CREATED]: [S.PAYMENT_PENDING, S.CANCELLED],
  [S.PAYMENT_PENDING]: [S.PAID, S.FAILED, S.CANCELLED],
  [S.PAID]: [S.ASSIGNED, S.CANCELLED],
  // A failed assignment hands the order back to the matching pool.
  [S.ASSIGNED]: [S.IN_PROGRESS, S.PAID, S.CANCELLED],
  [S.IN_PROGRESS]: [S.DELIVERED, S.FAILED],
  [S.DELIVERED]: [],
  [S.CANCELLED]: [],
  [S.FAILED]: [],
});

export function allowedTransitions(from: OrderStatus): readonly OrderStatus[] {
  return ORDER_TRANSITIONS[from];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: OrderStatus): boolean {
  return ORDER_TRANSITIONS[status].length === 0;
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to, ORDER_TRANSITIONS[from]);
  }
}
