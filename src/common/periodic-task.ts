import { Logger } from '@nestjs/common';

/**
 * Runs `fn` every `intervalMs`, never overlapping with itself. `stop()` waits
 * for an in-flight run so shutdown does not cut a batch in half.
 */
export class PeriodicTask {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopped = true;
  private readonly logger: Logger;

  constructor(
    private readonly name: string,
    private readonly intervalMs: number,
    private readonly fn: () => Promise<unknown>,
  ) {
    this.logger = new Logger(name);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running;
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick().finally(() => {
        this.running = undefined;
        this.schedule();
      });
    }, this.intervalMs);
    // Background work must never keep the process alive on its own.
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    try {
      await this.fn();
    } catch (error) {
      this.logger.error({ msg: `${this.name} run failed`, error: error instanceof Error ? error.message : String(error) });
    }
  }
}
