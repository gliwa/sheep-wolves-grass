// Configuration schema — the single validator reused by every config surface
// (default file, env vars, REST config API, dev-only query params). See
// SPEC.md → Configuration and DECISIONS.md #22, #26, #27.

import defaultConfigJson from '../config.default.json';

/** When a parameter change takes effect (SPEC.md → Mutability classes). */
export type Mutability = 'live' | 'next-round' | 'startup-only';

export interface GameConfig {
  cfgFieldSizeX: number;
  cfgFieldSizeY: number;
  cfgColors: string[];
  cfgSheepKillBonus: number;
  cfgInitialNofGrass: number;
  cfgGrassGrowRate: number;
  cfgMaxNofGrass: number;
  cfgStartTimeout: number;
  cfgChessVoteThreshold: number;
  cfgMaxNofPlayers: number;
  cfgTickMs: number;
  cfgChessTicksPerGrassGrow: number;
  cfgChessTurnTimeout: number;
  cfgAllowClientOverrides: boolean;
}

export type ConfigKey = keyof GameConfig;

interface NumericSpec {
  kind: 'int' | 'number';
  min: number;
  max?: number;
}

interface BooleanSpec {
  kind: 'boolean';
}

/** Array of CSS hex colors (#RRGGBB). */
interface ColorArraySpec {
  kind: 'color-array';
}

export type ValueSpec = NumericSpec | BooleanSpec | ColorArraySpec;

export interface ParamSpec {
  value: ValueSpec;
  mutability: Mutability;
}

// Static per-key bounds. Bounds that depend on other keys (interior cell
// count, cfgMaxNofPlayers) live in validateCrossParams below.
export const CONFIG_SPECS: Record<ConfigKey, ParamSpec> = {
  cfgFieldSizeX: { value: { kind: 'int', min: 10, max: 200 }, mutability: 'next-round' },
  cfgFieldSizeY: { value: { kind: 'int', min: 10, max: 200 }, mutability: 'next-round' },
  cfgColors: { value: { kind: 'color-array' }, mutability: 'next-round' },
  cfgSheepKillBonus: { value: { kind: 'int', min: 0 }, mutability: 'next-round' },
  cfgInitialNofGrass: { value: { kind: 'int', min: 0 }, mutability: 'next-round' },
  cfgGrassGrowRate: { value: { kind: 'number', min: 0 }, mutability: 'live' },
  cfgMaxNofGrass: { value: { kind: 'int', min: 0 }, mutability: 'live' },
  cfgStartTimeout: { value: { kind: 'int', min: 0 }, mutability: 'live' },
  cfgChessVoteThreshold: { value: { kind: 'int', min: 0, max: 100 }, mutability: 'next-round' },
  cfgMaxNofPlayers: { value: { kind: 'int', min: 2, max: 26 }, mutability: 'live' },
  cfgTickMs: { value: { kind: 'int', min: 0 }, mutability: 'live' },
  cfgChessTicksPerGrassGrow: { value: { kind: 'int', min: 1 }, mutability: 'next-round' },
  cfgChessTurnTimeout: { value: { kind: 'int', min: 0 }, mutability: 'live' },
  cfgAllowClientOverrides: { value: { kind: 'boolean' }, mutability: 'startup-only' },
};

export const CONFIG_KEYS = Object.keys(CONFIG_SPECS) as ConfigKey[];

export function isConfigKey(key: string): key is ConfigKey {
  return key in CONFIG_SPECS;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** Validate a single value against its static per-key spec. Returns an error message or null. */
export function validateValue(key: ConfigKey, value: unknown): string | null {
  const spec = CONFIG_SPECS[key].value;
  switch (spec.kind) {
    case 'int':
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return `${key}: expected a finite number`;
      }
      if (spec.kind === 'int' && !Number.isInteger(value)) {
        return `${key}: expected an integer`;
      }
      if (value < spec.min) return `${key}: ${value} is below the minimum ${spec.min}`;
      if (spec.max !== undefined && value > spec.max) {
        return `${key}: ${value} is above the maximum ${spec.max}`;
      }
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : `${key}: expected a boolean`;
    case 'color-array': {
      if (!Array.isArray(value)) return `${key}: expected an array of hex colors`;
      for (const entry of value) {
        if (typeof entry !== 'string' || !HEX_COLOR_RE.test(entry)) {
          return `${key}: "${String(entry)}" is not a #RRGGBB hex color`;
        }
      }
      return null;
    }
  }
}

/**
 * Constraints spanning several parameters (DECISIONS.md #27). Checked against
 * a fully validated candidate config; a violation rejects the change.
 */
export function validateCrossParams(config: GameConfig): string[] {
  const errors: string[] = [];
  const interiorCells = config.cfgFieldSizeX * config.cfgFieldSizeY;
  if (config.cfgColors.length < config.cfgMaxNofPlayers) {
    errors.push(
      `cfgColors: ${config.cfgColors.length} colors but cfgMaxNofPlayers is ${config.cfgMaxNofPlayers}`,
    );
  }
  if (config.cfgInitialNofGrass > config.cfgMaxNofGrass) {
    errors.push(
      `cfgInitialNofGrass (${config.cfgInitialNofGrass}) exceeds cfgMaxNofGrass (${config.cfgMaxNofGrass})`,
    );
  }
  if (config.cfgMaxNofGrass > interiorCells) {
    errors.push(
      `cfgMaxNofGrass (${config.cfgMaxNofGrass}) exceeds interior cells (${interiorCells})`,
    );
  }
  if (config.cfgInitialNofGrass + 2 * config.cfgMaxNofPlayers > interiorCells) {
    errors.push(
      `cfgInitialNofGrass (${config.cfgInitialNofGrass}) plus ${config.cfgMaxNofPlayers} wolf+sheep pairs ` +
        `does not fit the ${interiorCells}-cell interior`,
    );
  }
  return errors;
}

export type ConfigValidationResult =
  { ok: true; config: GameConfig } | { ok: false; errors: string[] };

/** Validate a complete config object: presence, no unknown keys, per-key bounds, cross-param constraints. */
export function validateConfig(candidate: unknown): ConfigValidationResult {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return { ok: false, errors: ['config: expected a JSON object'] };
  }
  const errors: string[] = [];
  const record = candidate as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!isConfigKey(key)) errors.push(`${key}: unknown parameter`);
  }
  for (const key of CONFIG_KEYS) {
    if (!(key in record)) {
      errors.push(`${key}: missing`);
      continue;
    }
    const error = validateValue(key, record[key]);
    if (error !== null) errors.push(error);
  }
  if (errors.length > 0) return { ok: false, errors };
  const config = { ...record } as unknown as GameConfig;
  const crossErrors = validateCrossParams(config);
  if (crossErrors.length > 0) return { ok: false, errors: crossErrors };
  return { ok: true, config: { ...config, cfgColors: [...config.cfgColors] } };
}

export type ParseResult = { ok: true; value: GameConfig[ConfigKey] } | { ok: false; error: string };

/**
 * Parse a raw string (env var or query param — the key name is identical on
 * every surface) into a typed value. Colors are comma-separated hex values.
 * The result still has to pass validateValue/validateCrossParams.
 */
export function parseConfigString(key: ConfigKey, raw: string): ParseResult {
  const spec = CONFIG_SPECS[key].value;
  switch (spec.kind) {
    case 'int':
    case 'number': {
      const value = Number(raw.trim());
      if (raw.trim() === '' || !Number.isFinite(value)) {
        return { ok: false, error: `${key}: "${raw}" is not a number` };
      }
      return { ok: true, value };
    }
    case 'boolean': {
      const normalized = raw.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') return { ok: true, value: true };
      if (normalized === 'false' || normalized === '0') return { ok: true, value: false };
      return { ok: false, error: `${key}: "${raw}" is not a boolean (true/false/1/0)` };
    }
    case 'color-array':
      return { ok: true, value: raw.split(',').map((c) => c.trim()) };
  }
}

function loadDefaultConfig(): GameConfig {
  const result = validateConfig(defaultConfigJson);
  if (!result.ok) {
    // A bad default file is a fatal startup error (SPEC.md → Configuration).
    throw new Error(`config.default.json is invalid:\n${result.errors.join('\n')}`);
  }
  return result.config;
}

export const DEFAULT_CONFIG: Readonly<GameConfig> = loadDefaultConfig();
