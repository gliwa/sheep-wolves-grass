// Runtime configuration store (WBS 5): holds the effective config plus the
// buffered next-round overrides. Startup resolution is file → env vars
// (resolveStartupConfig); runtime changes arrive via the REST config API or
// dev-only query params (patch/patchFromStrings) and apply per mutability
// class (SPEC.md → Configuration): live keys immediately, next-round keys at
// the next round boundary (applyPending), startup-only keys never.

import type { ConfigKey, GameConfig } from '@swg/shared';
import {
  CONFIG_KEYS,
  CONFIG_SPECS,
  DEFAULT_CONFIG,
  isConfigKey,
  parseConfigString,
  validateConfig,
  validateCrossParams,
  validateValue,
} from '@swg/shared';

export interface PatchResult {
  /** Live keys, in effect immediately. */
  applied: ConfigKey[];
  /** Next-round keys, buffered until the next round boundary. */
  pending: ConfigKey[];
  rejected: { key: string; error: string }[];
}

export class ConfigStore {
  private current: GameConfig;
  private pendingNextRound: Partial<GameConfig> = {};
  private readonly onChange: ((config: GameConfig) => void) | undefined;

  constructor(config: GameConfig, onChange?: (config: GameConfig) => void) {
    this.current = { ...config, cfgColors: [...config.cfgColors] };
    this.onChange = onChange;
  }

  /**
   * Startup resolution: config.default.json overlaid with cfg* env vars
   * (identical key names on every surface). Unlike runtime changes, an
   * invalid env value or cross-param violation is fatal — fail at boot,
   * where the operator sees it, not silently at runtime.
   */
  static resolveStartupConfig(env: Record<string, string | undefined> = process.env): GameConfig {
    const candidate: Record<string, unknown> = { ...DEFAULT_CONFIG };
    const errors: string[] = [];
    for (const key of CONFIG_KEYS) {
      const raw = env[key];
      if (raw === undefined) continue;
      const parsed = parseConfigString(key, raw);
      if (!parsed.ok) {
        errors.push(parsed.error);
        continue;
      }
      candidate[key] = parsed.value;
    }
    if (errors.length === 0) {
      const result = validateConfig(candidate);
      if (result.ok) return result.config;
      errors.push(...result.errors);
    }
    throw new Error(`invalid startup configuration:\n${errors.join('\n')}`);
  }

  /** Bound so it can be handed to the lobby/engine as their live view. */
  getConfig = (): GameConfig => this.current;

  /**
   * Apply a set of already-typed values (REST PATCH body). Per-key failures
   * — unknown, startup-only, out of bounds — reject only that key; a
   * cross-param violation rejects the whole accepted set and keeps the last
   * valid config (DECISIONS.md #27). Constraints must hold both immediately
   * (live keys land on the current config) and at the round boundary (all
   * keys land on current + already-pending).
   */
  patch(values: Record<string, unknown>): PatchResult {
    const rejected: PatchResult['rejected'] = [];
    const acceptedLive: Partial<GameConfig> = {};
    const acceptedNextRound: Partial<GameConfig> = {};
    for (const [key, value] of Object.entries(values)) {
      if (!isConfigKey(key)) {
        rejected.push({ key, error: `${key}: unknown parameter` });
        continue;
      }
      if (CONFIG_SPECS[key].mutability === 'startup-only') {
        rejected.push({ key, error: `${key}: startup-only — set via file or env var` });
        continue;
      }
      const error = validateValue(key, value);
      if (error !== null) {
        rejected.push({ key, error });
        continue;
      }
      const target = CONFIG_SPECS[key].mutability === 'live' ? acceptedLive : acceptedNextRound;
      (target as Record<string, unknown>)[key] = value;
    }
    const liveKeys = Object.keys(acceptedLive) as ConfigKey[];
    const nextRoundKeys = Object.keys(acceptedNextRound) as ConfigKey[];
    if (liveKeys.length + nextRoundKeys.length === 0) {
      return { applied: [], pending: [], rejected };
    }
    const immediate: GameConfig = { ...this.current, ...acceptedLive };
    const future: GameConfig = {
      ...this.current,
      ...this.pendingNextRound,
      ...acceptedLive,
      ...acceptedNextRound,
    };
    const crossErrors = [
      ...new Set([...validateCrossParams(immediate), ...validateCrossParams(future)]),
    ];
    if (crossErrors.length > 0) {
      const error = crossErrors.join('; ');
      for (const key of [...liveKeys, ...nextRoundKeys]) rejected.push({ key, error });
      return { applied: [], pending: [], rejected };
    }
    Object.assign(this.pendingNextRound, acceptedNextRound);
    if (liveKeys.length > 0) {
      this.current = immediate;
      this.onChange?.(this.current);
    }
    return { applied: liveKeys, pending: nextRoundKeys, rejected };
  }

  /** Dev-only query-param overrides: parse the raw strings, then patch. */
  patchFromStrings(entries: Iterable<[string, string]>): PatchResult {
    const values: Record<string, unknown> = {};
    const rejected: PatchResult['rejected'] = [];
    for (const [key, raw] of entries) {
      if (!isConfigKey(key)) {
        rejected.push({ key, error: `${key}: unknown parameter` });
        continue;
      }
      const parsed = parseConfigString(key, raw);
      if (!parsed.ok) {
        rejected.push({ key, error: parsed.error });
        continue;
      }
      values[key] = parsed.value;
    }
    const result = this.patch(values);
    return { ...result, rejected: [...rejected, ...result.rejected] };
  }

  /**
   * Merge the buffered next-round keys into the effective config; the lobby
   * calls this at each round boundary, before the engine snapshots its keys.
   * Returns the keys that changed.
   */
  applyPending(): ConfigKey[] {
    const keys = Object.keys(this.pendingNextRound) as ConfigKey[];
    if (keys.length === 0) return [];
    const merged: GameConfig = { ...this.current, ...this.pendingNextRound };
    this.pendingNextRound = {};
    const errors = validateCrossParams(merged);
    if (errors.length > 0) {
      // Unreachable — every patch validated the future view — but never let a
      // bad config through; drop the buffer instead.
      console.warn(`dropping pending config changes: ${errors.join('; ')}`);
      return [];
    }
    this.current = merged;
    this.onChange?.(this.current);
    return keys;
  }
}
