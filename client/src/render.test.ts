import { describe, expect, it } from 'vitest';

import { DEFAULT_CONFIG } from '@swg/shared';

import { renderApp } from './render';
import { activeState, lobbyPlayer, roundState } from './state.test';

const NOW = 1_000_000;

describe('renderApp — terminal phases', () => {
  it('renders a message per phase', () => {
    expect(renderApp(activeState({ phase: 'connecting' }), NOW)).toContain('connecting');
    expect(renderApp(activeState({ phase: 'rejected' }), NOW)).toContain('full');
    expect(renderApp(activeState({ phase: 'left' }), NOW)).toContain('left the game');
    expect(renderApp(activeState({ phase: 'disconnected' }), NOW)).toContain('Connection lost');
  });
});

describe('renderApp — start screen', () => {
  it('lists players with letter color, stats, own-row marker and key hints', () => {
    const state = activeState({
      lobby: {
        players: [
          lobbyPlayer('me', { name: 'Alice', roundsPlayed: 2, totalScore: 34, status: 'ready' }),
          lobbyPlayer('other', { letter: 'b', colorIndex: 1, chessVote: true }),
        ],
        countdownSeconds: null,
        chessMode: false,
      },
    });
    const html = renderApp(state, NOW);
    expect(html).toContain('Sheep, Wolves &amp; Grass');
    expect(html).toContain(`<span style="color:${DEFAULT_CONFIG.cfgColors[0]}">a</span>`);
    expect(html).toContain('Alice');
    expect(html).toContain('ready');
    expect(html).toMatch(/> {2}1 {2}/); // own row marked
    expect(html).toContain('yes'); // chess vote column
    expect(html).toContain('[P] ready');
  });

  it('shows countdown, chess result, round-in-progress and last-round banners', () => {
    const state = activeState({
      countdownEndsAt: NOW + 42_000,
      lobby: { players: [lobbyPlayer('me')], countdownSeconds: 42, chessMode: true },
      lastRoundEnd: {
        scores: [
          { playerId: 'w', name: 'Winner', score: 12 },
          { playerId: 'l', name: 'Loser', score: 3 },
        ],
        winnerIds: ['w'],
      },
    });
    const html = renderApp(state, NOW);
    expect(html).toContain('Round starts in 42s.');
    expect(html).toContain('CHESS mode');
    expect(html).toContain('Last round won by Winner with 12 points.');

    const spectating = activeState({ round: roundState(['other']) });
    expect(renderApp(spectating, NOW)).toContain('A round is in progress');
  });

  it('shows the name editor line and escapes player input', () => {
    const state = activeState({
      nameDraft: '<b>x',
      lobby: {
        players: [lobbyPlayer('me', { name: '<script>' })],
        countdownSeconds: null,
        chessMode: false,
      },
    });
    const html = renderApp(state, NOW);
    expect(html).toContain('New name: &lt;b&gt;x_');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('[Enter] confirm');
  });
});

describe('renderApp — play screen', () => {
  it('draws the bordered field with colored grass and creatures plus scoreboard', () => {
    const round = {
      ...roundState(['me', 'other']),
      grass: [{ x: 5, y: 5 }],
    };
    round.players[0]!.score = 7;
    round.players[1]!.sheep = null; // knocked out — lonely wolf remains
    const state = activeState({ round });
    const html = renderApp(state, NOW);
    const lines = html.split('\n');

    const border = `+${'-'.repeat(10)}+`;
    expect(lines[0]).toBe(border);
    expect(lines[11]).toBe(border);
    // interior rows are |…| with exactly fieldSizeX cells (spans aside)
    expect(lines[1]!.startsWith('|')).toBe(true);
    expect(lines[1]!.endsWith('|')).toBe(true);

    expect(html).toContain(`<span style="color:#4caf50">,</span>`); // grass
    expect(html).toContain(`<span style="color:${DEFAULT_CONFIG.cfgColors[0]}">a</span>`); // my sheep
    expect(html).toContain(`<span style="color:${DEFAULT_CONFIG.cfgColors[0]}">A</span>`); // my wolf
    expect(html).toContain(`<span style="color:${DEFAULT_CONFIG.cfgColors[1]}">B</span>`); // lonely wolf
    // its sheep is gone from the field: 'b' appears once (scoreboard), not twice
    expect(html.match(/>b</g)).toHaveLength(1);

    expect(html).toContain('    7'); // my round score
    expect(html).toContain('(eaten)');
    expect(html).toContain('← you');
    expect(html).toContain('shift+arrows: wolf');
  });

  it('marks chess mode and left players', () => {
    const round = { ...roundState(['me', 'other']), chessMode: true };
    round.players[1]!.sheep = null;
    round.players[1]!.exited = true;
    const html = renderApp(activeState({ round }), NOW);
    expect(html).toContain('[CHESS MODE]');
    expect(html).toContain('(left)');
  });
});
