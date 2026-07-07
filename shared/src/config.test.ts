import { describe, expect, it } from 'vitest';

import {
  CONFIG_KEYS,
  CONFIG_SPECS,
  DEFAULT_CONFIG,
  isConfigKey,
  parseConfigString,
  validateConfig,
  validateCrossParams,
  validateValue,
} from './config';

describe('default config', () => {
  it('is valid (a bad default file is a fatal startup error)', () => {
    // DEFAULT_CONFIG throws at import time if invalid; assert it round-trips.
    const result = validateConfig({ ...DEFAULT_CONFIG });
    expect(result.ok).toBe(true);
  });

  it('covers every key exactly once', () => {
    expect(Object.keys(DEFAULT_CONFIG).sort()).toEqual([...CONFIG_KEYS].sort());
  });
});

describe('validateValue — per-key bounds', () => {
  it('accepts values inside the bounds', () => {
    expect(validateValue('cfgFieldSizeX', 50)).toBeNull();
    expect(validateValue('cfgMaxNofPlayers', 2)).toBeNull();
    expect(validateValue('cfgGrassGrowRate', 0.5)).toBeNull();
    expect(validateValue('cfgAllowClientOverrides', true)).toBeNull();
  });

  it('rejects out-of-bounds and mistyped values', () => {
    expect(validateValue('cfgFieldSizeX', 9)).not.toBeNull(); // below min 10
    expect(validateValue('cfgFieldSizeX', 201)).not.toBeNull(); // above max 200
    expect(validateValue('cfgFieldSizeX', 50.5)).not.toBeNull(); // int required
    expect(validateValue('cfgMaxNofPlayers', 1)).not.toBeNull(); // min 2 (DECISIONS #26)
    expect(validateValue('cfgMaxNofPlayers', 27)).not.toBeNull(); // one letter each
    expect(validateValue('cfgTickMs', -1)).not.toBeNull();
    expect(validateValue('cfgAllowClientOverrides', 'yes')).not.toBeNull();
    expect(validateValue('cfgFieldSizeX', Number.NaN)).not.toBeNull();
  });

  it('validates colors as #RRGGBB hex strings', () => {
    expect(validateValue('cfgColors', ['#E69F00', '#56B4E9'])).toBeNull();
    expect(validateValue('cfgColors', ['red'])).not.toBeNull();
    expect(validateValue('cfgColors', ['#FFF'])).not.toBeNull();
    expect(validateValue('cfgColors', '#E69F00')).not.toBeNull(); // not an array
  });
});

describe('validateCrossParams (DECISIONS #27)', () => {
  it('accepts the defaults', () => {
    expect(validateCrossParams({ ...DEFAULT_CONFIG })).toEqual([]);
  });

  it('rejects fewer colors than max players', () => {
    const errors = validateCrossParams({ ...DEFAULT_CONFIG, cfgMaxNofPlayers: 11 });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/cfgColors/);
  });

  it('rejects initial grass above the grass cap', () => {
    const errors = validateCrossParams({ ...DEFAULT_CONFIG, cfgInitialNofGrass: 41 });
    expect(errors.some((e) => e.includes('cfgMaxNofGrass'))).toBe(true);
  });

  it('rejects grass + pairs that do not fit the interior', () => {
    const errors = validateCrossParams({
      ...DEFAULT_CONFIG,
      cfgFieldSizeX: 10,
      cfgFieldSizeY: 10,
      cfgInitialNofGrass: 81,
      cfgMaxNofGrass: 100,
    });
    expect(errors.some((e) => e.includes('interior'))).toBe(true);
  });
});

describe('validateConfig — whole object', () => {
  it('rejects unknown and missing keys', () => {
    const unknown = validateConfig({ ...DEFAULT_CONFIG, cfgMayNofPlayers: 5 });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.errors.some((e) => e.includes('unknown'))).toBe(true);

    const partial: Record<string, unknown> = { ...DEFAULT_CONFIG };
    delete partial.cfgTickMs;
    const missing = validateConfig(partial);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.errors.some((e) => e.includes('cfgTickMs'))).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(validateConfig(null).ok).toBe(false);
    expect(validateConfig([]).ok).toBe(false);
    expect(validateConfig('config').ok).toBe(false);
  });

  it('returns a defensive copy', () => {
    const result = validateConfig({ ...DEFAULT_CONFIG });
    expect(result.ok).toBe(true);
    if (result.ok) {
      result.config.cfgColors.push('#000000');
      expect(DEFAULT_CONFIG.cfgColors).toHaveLength(10);
    }
  });
});

describe('parseConfigString — env vars & query params', () => {
  it('parses numbers, booleans, and color lists', () => {
    expect(parseConfigString('cfgFieldSizeX', '42')).toEqual({ ok: true, value: 42 });
    expect(parseConfigString('cfgGrassGrowRate', '2.5')).toEqual({ ok: true, value: 2.5 });
    expect(parseConfigString('cfgAllowClientOverrides', 'true')).toEqual({
      ok: true,
      value: true,
    });
    expect(parseConfigString('cfgAllowClientOverrides', '0')).toEqual({ ok: true, value: false });
    expect(parseConfigString('cfgColors', '#111111, #222222')).toEqual({
      ok: true,
      value: ['#111111', '#222222'],
    });
  });

  it('rejects garbage', () => {
    expect(parseConfigString('cfgFieldSizeX', 'wide').ok).toBe(false);
    expect(parseConfigString('cfgFieldSizeX', '').ok).toBe(false);
    expect(parseConfigString('cfgAllowClientOverrides', 'maybe').ok).toBe(false);
  });
});

describe('schema metadata', () => {
  it('exposes a mutability class for every key', () => {
    for (const key of CONFIG_KEYS) {
      expect(['live', 'next-round', 'startup-only']).toContain(CONFIG_SPECS[key].mutability);
    }
  });

  it('isConfigKey guards key names', () => {
    expect(isConfigKey('cfgTickMs')).toBe(true);
    expect(isConfigKey('cfgMayNofPlayers')).toBe(false); // the original typo (DECISIONS #20)
  });
});
