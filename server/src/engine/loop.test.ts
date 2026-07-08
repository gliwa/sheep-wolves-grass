import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TickLoop } from './loop';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TickLoop', () => {
  it('fires every cfgTickMs and reports wall-clock elapsed time', () => {
    const elapsed: number[] = [];
    const loop = new TickLoop({
      getTickMs: () => 100,
      tick: (ms) => {
        elapsed.push(ms);
        return true;
      },
    });
    loop.start();
    vi.advanceTimersByTime(350);
    loop.stop();
    expect(elapsed).toEqual([100, 100, 100]);
  });

  it('re-reads cfgTickMs before each wait, so a live change applies from the next tick', () => {
    let tickMs = 100;
    let ticks = 0;
    const loop = new TickLoop({
      getTickMs: () => tickMs,
      tick: () => {
        ticks += 1;
        return true;
      },
    });
    loop.start();
    vi.advanceTimersByTime(200);
    expect(ticks).toBe(2);
    tickMs = 25;
    // The already-scheduled wait still runs at 100ms (t=300), then 25ms:
    // t=325, 350, 375, 400 — five more ticks in the next 200ms.
    vi.advanceTimersByTime(200);
    expect(ticks).toBe(7);
    loop.stop();
  });

  it('free-runs via setImmediate when cfgTickMs is 0', () => {
    let ticks = 0;
    const loop = new TickLoop({ getTickMs: () => 0, tick: () => ++ticks < 50 });
    loop.start();
    vi.runAllTimers();
    expect(ticks).toBe(50);
    expect(loop.isRunning).toBe(false);
  });

  it('compensates tick processing time so the cadence does not drift', () => {
    const start = Date.now();
    const firedAt: number[] = [];
    const loop = new TickLoop({
      getTickMs: () => 100,
      tick: () => {
        firedAt.push(Date.now() - start);
        vi.setSystemTime(Date.now() + 30); // simulate a tick that takes 30ms
        return true;
      },
    });
    loop.start();
    vi.advanceTimersByTime(300);
    loop.stop();
    expect(firedAt).toEqual([100, 200, 300]);
  });

  it('stop() cancels the pending tick', () => {
    let ticks = 0;
    const loop = new TickLoop({
      getTickMs: () => 100,
      tick: () => {
        ticks += 1;
        return true;
      },
    });
    loop.start();
    vi.advanceTimersByTime(100);
    loop.stop();
    expect(loop.isRunning).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(ticks).toBe(1);
  });

  it('stops when the tick callback returns false (round ended)', () => {
    let ticks = 0;
    const loop = new TickLoop({
      getTickMs: () => 100,
      tick: () => {
        ticks += 1;
        return ticks < 3;
      },
    });
    loop.start();
    vi.advanceTimersByTime(10_000);
    expect(ticks).toBe(3);
    expect(loop.isRunning).toBe(false);
  });
});
