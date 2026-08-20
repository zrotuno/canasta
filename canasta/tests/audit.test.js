// Rules audit against Classic Canasta, 20 Aug 2026.
//
// Each case here was written to fail first, against a rule the engine got
// wrong. They are kept as regression cover.

import { test, eq, ok, no, section } from './harness.js';
import { THREE } from '../src/engine/cards.js';
import { createGame, applyMove } from '../src/engine/game.js';

section('Rules audit');

let seq = 0;
const c = (rank, suit = 'S') => ({ id: `a${seq++}`, rank, suit });
const ids = (...cards) => cards.map((x) => x.id);

// A red three buried in the pile is still a bonus card. Taking the pile must
// bank it, not deal it into the taker's hand where it would score against them.
test('a red three buried in the discard pile is banked, not taken into hand', () => {
  const s = createGame({ seed: 1 });
  const redThree = c(THREE, 'H');
  const top = c(5, 'D');
  s.discard = [redThree, c(9, 'C'), top];
  s.frozen = false;
  s.teams[0].hasMelded = true;   // past the opening minimum; not what this case is about

  const mine = [c(5, 'S'), c(5, 'C')];
  s.players[0].hand = [...mine, c(8, 'H'), c(12, 'S')];
  s.turn = 0;
  s.phase = 'draw';

  const next = applyMove(s, { type: 'takePile', groups: [ids(...mine, top)] });

  const strays = next.players[0].hand.filter((x) => x.id === redThree.id);
  eq(strays.length, 0, 'the red three should not be sitting in the hand');
  eq(next.teams[0].redThrees.length, 1, 'the red three should be banked to the team');
});

// Going out with a final discard is still going out, so black threes may go
// down on that turn even though one card stays in hand for the discard.
test('black threes can be melded when going out with a final discard', () => {
  const s = createGame({ seed: 2 });
  const blacks = [c(THREE, 'S'), c(THREE, 'C'), c(THREE, 'S')];
  const last = c(9, 'H');

  s.teams[0].melds = { 5: [c(5, 'S'), c(5, 'H'), c(5, 'D'), c(5, 'C'), c(5, 'S'), c(5, 'H'), c(5, 'D')] };
  s.teams[0].hasMelded = true;
  s.players[0].hand = [...blacks, last];
  s.turn = 0;
  s.phase = 'play';

  const melded = applyMove(s, { type: 'meld', groups: [ids(...blacks)] });
  eq(melded.teams[0].melds.B3.length, 3, 'the black threes went down');

  const out = applyMove(melded, { type: 'discard', card: last.id });
  ok(out.handOver, 'discarding the last card goes out');
  eq(out.outPlayer, 0);
});
