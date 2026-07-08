// Renderer (WBS 6): pure AppState → HTML string for the single <pre>. ASCII
// with per-cell <span> colors (SPEC.md → Stack decision); the border box and
// scoreboard are drawn outside the playable interior (DECISIONS.md #19).

import type { LobbyPlayer } from '@swg/shared';
import { GAME_NAME, GRASS_CHAR, MAX_NAME_LENGTH } from '@swg/shared';

import type { AppState } from './state';
import { countdownSecondsLeft, isOnPlayScreen } from './state';

const GRASS_COLOR = '#4caf50';
const DIM_COLOR = '#777777';
const FALLBACK_COLOR = '#dddddd';

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function span(text: string, color: string): string {
  return `<span style="color:${color}">${text}</span>`;
}

function dim(text: string): string {
  return span(escapeHtml(text), DIM_COLOR);
}

export function renderApp(state: AppState, now: number): string {
  switch (state.phase) {
    case 'connecting':
      return 'connecting…';
    case 'rejected':
      return 'The lobby is full — reload the page to retry.';
    case 'left':
      return 'You left the game — reload the page to join again.';
    case 'disconnected':
      return 'Connection lost — reload the page.';
    case 'active':
      return isOnPlayScreen(state) ? renderPlayScreen(state) : renderStartScreen(state, now);
  }
}

// ---------------------------------------------------------------------------
// Start screen

function colorOf(state: AppState, player: LobbyPlayer): string {
  return state.config?.cfgColors[player.colorIndex] ?? FALLBACK_COLOR;
}

function renderStartScreen(state: AppState, now: number): string {
  const title = escapeHtml(GAME_NAME);
  const lines: string[] = [title, '='.repeat(GAME_NAME.length), ''];

  if (state.nameDraft !== null) {
    lines.push(`New name: ${escapeHtml(state.nameDraft)}_`, '');
  }

  const header = `   #  L  ${'Name'.padEnd(MAX_NAME_LENGTH)}  Rounds  Score  ${'Status'.padEnd(12)}  Chess`;
  lines.push(header, dim('-'.repeat(header.length)));
  const players = state.lobby?.players ?? [];
  players.forEach((player, index) => {
    const marker = player.id === state.playerId ? '>' : ' ';
    const letter = span(player.letter, colorOf(state, player));
    const name = escapeHtml(player.name.padEnd(MAX_NAME_LENGTH));
    const row =
      `${marker}${String(index + 1).padStart(3)}  ${letter}  ${name}  ` +
      `${String(player.roundsPlayed).padStart(6)}  ${String(player.totalScore).padStart(5)}  ` +
      `${player.status.padEnd(12)}  ${player.chessVote ? 'yes' : '-'}`;
    lines.push(player.status === 'left' ? dim(player.name) : row);
  });
  if (players.length === 0) lines.push(dim('  (nobody here yet)'));
  lines.push('');

  if (state.round !== null) {
    lines.push('A round is in progress — you are in the next one.');
  }
  if (state.lobby?.chessMode === true) {
    lines.push('Next round: CHESS mode (vote passed).');
  }
  const seconds = countdownSecondsLeft(state, now);
  if (seconds !== null && state.round === null) {
    lines.push(`Round starts in ${seconds}s.`);
  }
  if (state.lastRoundEnd !== null) {
    const { scores, winnerIds } = state.lastRoundEnd;
    const winners = scores.filter((s) => winnerIds.includes(s.playerId));
    if (winners.length > 0) {
      const names = winners.map((w) => escapeHtml(w.name)).join(', ');
      lines.push(`Last round won by ${names} with ${winners[0]!.score} points.`);
    }
  }
  lines.push('');
  lines.push(
    state.nameDraft !== null
      ? dim('[Enter] confirm   [Esc] restore')
      : dim('[P] ready   [Enter] edit name   [B] add bot   [C] vote chess   [E] quit'),
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Play screen

function renderPlayScreen(state: AppState): string {
  const round = state.round!;
  const lobbyPlayers = new Map((state.lobby?.players ?? []).map((p) => [p.id, p]));
  const colorById = (id: string): string => {
    const player = lobbyPlayers.get(id);
    return player === undefined ? FALLBACK_COLOR : colorOf(state, player);
  };

  // Interior grid: one HTML cell per field cell (occupancy invariant #16 —
  // at most one thing per cell, so no priority rules are needed).
  const grid: string[][] = Array.from({ length: round.fieldSizeY }, () =>
    Array.from({ length: round.fieldSizeX }, () => ' '),
  );
  for (const grass of round.grass) {
    grid[grass.y]![grass.x] = span(GRASS_CHAR, GRASS_COLOR);
  }
  for (const player of round.players) {
    const color = colorById(player.id);
    if (player.sheep !== null) grid[player.sheep.y]![player.sheep.x] = span(player.letter, color);
    grid[player.wolf.y]![player.wolf.x] = span(player.letter.toUpperCase(), color);
  }

  const border = `+${'-'.repeat(round.fieldSizeX)}+`;
  const lines: string[] = [];
  if (round.chessMode) lines.push('[CHESS MODE]', '');
  lines.push(border);
  for (const row of grid) lines.push(`|${row.join('')}|`);
  lines.push(border, '');

  // Scoreboard outside the field (#19).
  for (const player of round.players) {
    const name = lobbyPlayers.get(player.id)?.name ?? player.letter;
    const marker = player.exited ? ' (left)' : player.sheep === null ? ' (eaten)' : '';
    const you = player.id === state.playerId ? '  ← you' : '';
    lines.push(
      `${span(player.letter, colorById(player.id))} ${escapeHtml(name.padEnd(MAX_NAME_LENGTH))} ` +
        `${String(player.score).padStart(5)}${dim(marker)}${you}`,
    );
  }
  lines.push('', dim('arrows: sheep   shift+arrows: wolf   [E] leave the round'));
  return lines.join('\n');
}
