// Real-time tick driver (WBS 3): calls the tick callback every cfgTickMs,
// re-reading the interval before each wait so live config changes apply from
// the next tick. cfgTickMs = 0 free-runs on setImmediate — as fast as
// possible while still yielding to I/O — which is the "disable quantization"
// hook for the LLM-optimization phase (SPEC.md → Configuration). Chess mode
// does not use this loop; a turn advances the engine directly.

export interface TickLoopOptions {
  /** Current cfgTickMs ('live'): read before scheduling each tick. */
  getTickMs: () => number;
  /**
   * One simulation step; elapsedMs is the wall-clock time since the previous
   * step (since start() for the first). Return false to stop the loop.
   */
  tick: (elapsedMs: number) => boolean;
}

export class TickLoop {
  private cancelPending: (() => void) | null = null;
  private running = false;
  private lastTickAt = 0;

  constructor(private readonly options: TickLoopOptions) {}

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTickAt = Date.now();
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    this.cancelPending?.();
    this.cancelPending = null;
  }

  private scheduleNext(): void {
    const tickMs = this.options.getTickMs();
    if (tickMs <= 0) {
      const handle = setImmediate(() => this.runTick());
      this.cancelPending = () => clearImmediate(handle);
    } else {
      // Subtract the time the tick itself took so the cadence doesn't drift.
      const delay = Math.max(0, tickMs - (Date.now() - this.lastTickAt));
      const handle = setTimeout(() => this.runTick(), delay);
      this.cancelPending = () => clearTimeout(handle);
    }
  }

  private runTick(): void {
    this.cancelPending = null;
    const now = Date.now();
    const elapsedMs = now - this.lastTickAt;
    this.lastTickAt = now;
    if (this.options.tick(elapsedMs) && this.running) this.scheduleNext();
    else this.running = false;
  }
}
