import { Logger } from '@nestjs/common';
import { PeriodicTask } from './periodic-task';

describe('PeriodicTask', () => {
  beforeAll(() => Logger.overrideLogger(false));
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('runs on every interval until stopped', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    const task = new PeriodicTask('test', 100, fn);

    task.start();
    await jest.advanceTimersByTimeAsync(350);
    await task.stop();
    await jest.advanceTimersByTimeAsync(500);

    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('never overlaps runs and keeps going after a failure', async () => {
    let active = 0;
    let maxActive = 0;
    const fn = jest.fn(async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 250));
      active--;
      if (fn.mock.calls.length === 1) throw new Error('first run fails');
    });
    const task = new PeriodicTask('test', 10, fn);

    task.start();
    await jest.advanceTimersByTimeAsync(1000);
    const stopping = task.stop();
    await jest.advanceTimersByTimeAsync(250);
    await stopping;

    expect(maxActive).toBe(1);
    expect(fn.mock.calls.length).toBeGreaterThan(1);
  });

  it('waits for an in-flight run on stop', async () => {
    let finished = false;
    const task = new PeriodicTask('test', 10, async () => {
      await new Promise((r) => setTimeout(r, 100));
      finished = true;
    });

    task.start();
    await jest.advanceTimersByTimeAsync(20);
    const stopping = task.stop();
    await jest.advanceTimersByTimeAsync(100);
    await stopping;

    expect(finished).toBe(true);
  });
});
