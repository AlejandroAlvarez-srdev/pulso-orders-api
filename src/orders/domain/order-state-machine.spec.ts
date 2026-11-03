import { InvalidTransitionError } from '../../common/domain-errors';
import { OrderStatus } from './order';
import {
  ORDER_TRANSITIONS,
  allowedTransitions,
  assertTransition,
  canTransition,
  isTerminal,
} from './order-state-machine';

const S = OrderStatus;
const ALL = Object.values(OrderStatus);

describe('order state machine', () => {
  it('defines transitions for every status', () => {
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...ALL].sort());
  });

  it('only references known statuses and never self-loops', () => {
    for (const from of ALL) {
      for (const to of ORDER_TRANSITIONS[from]) {
        expect(ALL).toContain(to);
        expect(to).not.toBe(from);
      }
    }
  });

  it('walks the happy path from CREATED to DELIVERED', () => {
    const path = [S.CREATED, S.PAYMENT_PENDING, S.PAID, S.ASSIGNED, S.IN_PROGRESS, S.DELIVERED];
    for (let i = 1; i < path.length; i++) {
      expect(canTransition(path[i - 1], path[i])).toBe(true);
    }
  });

  it.each([S.DELIVERED, S.CANCELLED, S.FAILED])('treats %s as terminal', (status) => {
    expect(isTerminal(status)).toBe(true);
    expect(allowedTransitions(status)).toHaveLength(0);
  });

  it.each([S.CREATED, S.PAYMENT_PENDING, S.PAID, S.ASSIGNED])('allows cancelling from %s', (status) => {
    expect(canTransition(status, S.CANCELLED)).toBe(true);
  });

  it('does not allow cancelling once the task is in progress', () => {
    expect(canTransition(S.IN_PROGRESS, S.CANCELLED)).toBe(false);
  });

  it('lets a failed assignment go back to PAID for re-matching', () => {
    expect(canTransition(S.ASSIGNED, S.PAID)).toBe(true);
  });

  it.each([
    [S.CREATED, S.PAID],
    [S.CREATED, S.DELIVERED],
    [S.PAID, S.PAYMENT_PENDING],
    [S.DELIVERED, S.CANCELLED],
    [S.CANCELLED, S.CREATED],
  ])('rejects %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(InvalidTransitionError);
  });

  it('reports allowed targets in the error', () => {
    expect(() => assertTransition(S.CREATED, S.DELIVERED)).toThrow(
      expect.objectContaining({ status: 409, allowed: [S.PAYMENT_PENDING, S.CANCELLED] }),
    );
  });

  it('is immutable at runtime', () => {
    expect(Object.isFrozen(ORDER_TRANSITIONS)).toBe(true);
  });
});
