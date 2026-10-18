import { logger } from "../logger.ts";

type Job = { key: string; run: () => Promise<void> };

export class Scheduler {
  private readonly queue: Job[] = [];
  private running = 0;
  private paused = false;
  private readonly idleWaiters: Array<() => void> = [];

  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  enqueue(key: string, run: () => Promise<void>): void {
    this.queue.push({ key, run });
    logger.debug({ key, queued: this.queue.length, running: this.running }, "任务入队");
    this.pump();
  }

  remove(key: string): boolean {
    const i = this.queue.findIndex((j) => j.key === key);
    if (i < 0) return false;
    this.queue.splice(i, 1);
    return true;
  }

  pause(): void { this.paused = true; }

  whenIdle(): Promise<void> {
    if (this.running === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private pump(): void {
    while (!this.paused && this.running < this.limit && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.running++;
      job
        .run()
        .catch((err: unknown) => logger.error({ key: job.key, err: err instanceof Error ? err.stack : String(err) }, "任务执行未捕获的错误"))
        .finally(() => {
          this.running--;
          this.pump();
          if (this.running === 0) this.idleWaiters.splice(0).forEach((resolve) => resolve());
        });
    }
  }
}
