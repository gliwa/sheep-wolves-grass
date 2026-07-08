import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_CONFIG } from '@swg/shared';

import { ConfigStore } from './config-store';

describe('ConfigStore.resolveStartupConfig', () => {
  it('overlays cfg* env vars on the default file and ignores other vars', () => {
    const config = ConfigStore.resolveStartupConfig({
      cfgGrassGrowRate: '5.5',
      cfgAllowClientOverrides: 'true',
      PATH: '/ignored',
    });
    expect(config.cfgGrassGrowRate).toBe(5.5);
    expect(config.cfgAllowClientOverrides).toBe(true);
    expect(config.cfgFieldSizeX).toBe(DEFAULT_CONFIG.cfgFieldSizeX);
  });

  it('fails fast on unparsable or out-of-bounds env values', () => {
    expect(() => ConfigStore.resolveStartupConfig({ cfgTickMs: 'fast' })).toThrow(/not a number/);
    expect(() => ConfigStore.resolveStartupConfig({ cfgFieldSizeX: '5000' })).toThrow(/maximum/);
  });

  it('fails fast on a cross-param violation', () => {
    // default cfgMaxNofGrass is 40 → an initial 50 can never fit under the cap
    expect(() => ConfigStore.resolveStartupConfig({ cfgInitialNofGrass: '50' })).toThrow(
      /cfgMaxNofGrass/,
    );
  });
});

describe('ConfigStore.patch', () => {
  it('applies live keys immediately and notifies', () => {
    const onChange = vi.fn();
    const store = new ConfigStore(DEFAULT_CONFIG, onChange);
    const result = store.patch({ cfgGrassGrowRate: 33 });
    expect(result).toEqual({ applied: ['cfgGrassGrowRate'], pending: [], rejected: [] });
    expect(store.getConfig().cfgGrassGrowRate).toBe(33);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cfgGrassGrowRate: 33 }));
  });

  it('buffers next-round keys until applyPending', () => {
    const onChange = vi.fn();
    const store = new ConfigStore(DEFAULT_CONFIG, onChange);
    expect(store.patch({ cfgSheepKillBonus: 25 }).pending).toEqual(['cfgSheepKillBonus']);
    expect(store.getConfig().cfgSheepKillBonus).toBe(DEFAULT_CONFIG.cfgSheepKillBonus);
    expect(onChange).not.toHaveBeenCalled();

    expect(store.applyPending()).toEqual(['cfgSheepKillBonus']);
    expect(store.getConfig().cfgSheepKillBonus).toBe(25);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(store.applyPending()).toEqual([]); // buffer is one-shot
  });

  it('rejects startup-only, unknown and invalid keys but applies valid siblings', () => {
    const store = new ConfigStore(DEFAULT_CONFIG);
    const result = store.patch({
      cfgAllowClientOverrides: true, // startup-only
      cfgNope: 1, // unknown
      cfgTickMs: -5, // below minimum
      cfgStartTimeout: 30, // fine
    });
    expect(result.applied).toEqual(['cfgStartTimeout']);
    expect(result.rejected.map((r) => r.key).sort()).toEqual([
      'cfgAllowClientOverrides',
      'cfgNope',
      'cfgTickMs',
    ]);
    expect(store.getConfig().cfgStartTimeout).toBe(30);
    expect(store.getConfig().cfgAllowClientOverrides).toBe(false);
  });

  it('rejects the whole accepted set on a future cross-param violation', () => {
    const store = new ConfigStore(DEFAULT_CONFIG);
    // Individually valid, jointly not: 100 initial grass over a cap of 50.
    const result = store.patch({ cfgInitialNofGrass: 100, cfgMaxNofGrass: 50 });
    expect(result.applied).toEqual([]);
    expect(result.pending).toEqual([]);
    expect(result.rejected).toHaveLength(2);
    expect(store.getConfig().cfgMaxNofGrass).toBe(DEFAULT_CONFIG.cfgMaxNofGrass);
  });

  it('rejects a live change that violates a constraint right now', () => {
    const store = new ConfigStore(DEFAULT_CONFIG);
    // cfgMaxNofGrass is live; dropping it under the current initial 20 must fail.
    const result = store.patch({ cfgMaxNofGrass: 10 });
    expect(result.applied).toEqual([]);
    expect(result.rejected[0]!.error).toMatch(/cfgInitialNofGrass/);
    expect(store.getConfig().cfgMaxNofGrass).toBe(DEFAULT_CONFIG.cfgMaxNofGrass);
  });
});

describe('ConfigStore.patchFromStrings', () => {
  it('parses query-param strings and rejects garbage per key', () => {
    const store = new ConfigStore(DEFAULT_CONFIG);
    const result = store.patchFromStrings(
      Object.entries({ cfgGrassGrowRate: '12', cfgTickMs: 'soon', other: '1' }),
    );
    expect(result.applied).toEqual(['cfgGrassGrowRate']);
    expect(result.rejected.map((r) => r.key).sort()).toEqual(['cfgTickMs', 'other']);
    expect(store.getConfig().cfgGrassGrowRate).toBe(12);
  });
});
