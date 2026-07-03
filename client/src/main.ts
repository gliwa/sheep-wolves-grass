import { GAME_NAME } from '@swg/shared';

// Placeholder until WBS item 6 delivers the screen framework and renderer.
const screen = document.getElementById('screen');
if (!screen) throw new Error('missing #screen element');

screen.textContent = [GAME_NAME, '', 'client scaffold OK — the build pipeline works.'].join('\n');
