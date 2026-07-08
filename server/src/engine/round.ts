// Round engine (WBS 3): owns one round's authoritative state, buffers move
// commands (phase a — ≤1 per player per tick, newest wins, #34) and advances the
// simulation by composing the pure shared rules with grass-growth
// scheduling. No timers in here: the real-time TickLoop (loop.ts) drives
// advanceTick with wall-clock elapsed time, a chess-mode turn (WBS 7) calls
// it directly.

import type { GameConfig, MoveCommand, PlayerId, Rng, RoundState, TickResult } from '@swg/shared';
import { applyPlayerExit, growGrass, isRoundOver, resolveTick } from '@swg/shared';

import type { RoundSeat } from './placement';
import { placeRound } from './placement';

export interface RoundEngineOptions {
  /**
   * Read on every tick for 'live' keys (cfgGrassGrowRate, cfgMaxNofGrass);
   * 'next-round' keys are snapshotted once at construction — a round
   * boundary (SPEC.md → Mutability classes).
   */
  getConfig: () => GameConfig;
  players: RoundSeat[];
  chessMode: boolean;
  rng?: Rng;
}

export class RoundEngine {
  private readonly getConfig: () => GameConfig;
  private readonly rng: Rng;
  private readonly sheepKillBonus: number;
  private readonly chessTicksPerGrassGrow: number;
  /** Buffered phase-(a) input, keyed per player (#34) so the newest command wins. */
  private readonly commands = new Map<PlayerId, MoveCommand>();
  /** Real-time growth credit in grass units (cfgGrassGrowRate is per minute). */
  private grassCredit = 0;
  private ticksSinceGrassGrow = 0;
  private current: RoundState;

  constructor(options: RoundEngineOptions) {
    this.getConfig = options.getConfig;
    this.rng = options.rng ?? Math.random;
    const config = options.getConfig();
    this.sheepKillBonus = config.cfgSheepKillBonus;
    this.chessTicksPerGrassGrow = config.cfgChessTicksPerGrassGrow;
    this.current = placeRound({
      fieldSizeX: config.cfgFieldSizeX,
      fieldSizeY: config.cfgFieldSizeY,
      initialNofGrass: config.cfgInitialNofGrass,
      chessMode: options.chessMode,
      players: options.players,
      rng: this.rng,
    });
  }

  get state(): RoundState {
    return this.current;
  }

  get roundOver(): boolean {
    return isRoundOver(this.current);
  }

  /**
   * Buffer a move for the next tick; a newer command from the same player
   * replaces the older one — one move per player per tick, sheep or wolf
   * (#34). Commands from unknown, exited or knocked-out players may be
   * buffered but are dropped by validation (phase b).
   */
  submitMove(command: MoveCommand): void {
    this.commands.set(command.playerId, command);
  }

  /** Exit (E) or disconnect mid-round (DECISIONS.md #11). Check roundOver after. */
  exit(playerId: PlayerId): void {
    this.current = applyPlayerExit(this.current, playerId);
    this.commands.delete(playerId);
  }

  /**
   * Run one tick (one turn in chess mode) over the buffered commands, then
   * grow grass — per wall-clock elapsedMs in real-time mode, per tick count
   * in chess mode. Growth is skipped once the round has ended.
   */
  advanceTick(elapsedMs = 0): TickResult {
    const commands = [...this.commands.values()];
    this.commands.clear();
    const result = resolveTick(this.current, commands, this.sheepKillBonus, this.rng);
    this.current = result.state;
    if (!result.roundEnded) this.applyGrassGrowth(elapsedMs);
    return { state: this.current, events: result.events, roundEnded: result.roundEnded };
  }

  private applyGrassGrowth(elapsedMs: number): void {
    const config = this.getConfig();
    let spawns = 0;
    if (this.current.chessMode) {
      this.ticksSinceGrassGrow += 1;
      if (this.ticksSinceGrassGrow >= this.chessTicksPerGrassGrow) {
        this.ticksSinceGrassGrow = 0;
        spawns = 1;
      }
    } else {
      this.grassCredit += (config.cfgGrassGrowRate / 60_000) * elapsedMs;
      spawns = Math.floor(this.grassCredit);
      // A spawn at the cap is skipped, not deferred (SPEC.md → Grass growth),
      // so the credit is consumed either way.
      this.grassCredit -= spawns;
    }
    for (let i = 0; i < spawns; i++) {
      this.current = growGrass(this.current, config.cfgMaxNofGrass, this.rng);
    }
  }
}

export interface RoundScore {
  playerId: PlayerId;
  score: number;
}

export interface RoundResult {
  scores: RoundScore[];
  winnerIds: PlayerId[];
}

/**
 * Final standings once the round has ended: highest score wins, ties share
 * the win. Players who exited forfeit — they are gone from the lobby and out
 * of the standings (DECISIONS.md #11/#12). Names are attached by the lobby
 * layer, which owns them.
 */
export function computeRoundResult(state: RoundState): RoundResult {
  const scores = state.players
    .filter((player) => !player.exited)
    .map((player) => ({ playerId: player.id, score: player.score }))
    .sort((a, b) => b.score - a.score);
  const top = scores[0]?.score;
  const winnerIds =
    top === undefined ? [] : scores.filter((s) => s.score === top).map((s) => s.playerId);
  return { scores, winnerIds };
}
