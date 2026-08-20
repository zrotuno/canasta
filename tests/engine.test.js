// Browser-run test suite. No Node required: tests/index.html loads this as a
// module and prints results to the page and the console.

import { buildDeck, isWild, KING, JOKER, QUEEN } from '../src/engine/cards.js';
import { createGame, applyMove, getLegalMoves, canPlayOnBuild, nextRankFor } from '../src/engine/game.js';

const results = [];
const test = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); }
  catch (e) { results.push({ name, ok: false, error: e.message }); }
};
const eq = (actual, expected, what = '') => {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what} expected ${b}, got ${a}`);
};
const ok = (cond, what) => { if (!cond) throw new Error(what || 'expected truthy'); };
const throws = (fn, what) => {
  try { fn(); } catch { return; }
  throw new Error(what || 'expected a throw');
};

// ------------------------------------------------------------ deck

test('one deck + 2 jokers is 54 cards', () => {
  eq(buildDeck({ deckCount: 1, jokersPerDeck: 2 }).length, 54);
});

test('two decks + 2 jokers each is 108 cards', () => {
  eq(buildDeck({ deckCount: 2, jokersPerDeck: 2 }).length, 108);
});

test('kings and jokers are wild, queens are not', () => {
  ok(isWild({ rank: KING }), 'king should be wild');
  ok(isWild({ rank: JOKER }), 'joker should be wild');
  ok(!isWild({ rank: QUEEN }), 'queen should not be wild');
});

test('all card ids are unique', () => {
  const deck = buildDeck({ deckCount: 2, jokersPerDeck: 2 });
  eq(new Set(deck.map(c => c.id)).size, deck.length);
});

// ------------------------------------------------------------ build piles

test('empty build pile wants an ace', () => {
  eq(nextRankFor([]), 1);
  ok(canPlayOnBuild({ rank: 1 }, []), 'ace should play on empty');
  ok(!canPlayOnBuild({ rank: 2 }, []), 'two should not play on empty');
});

test('wilds play onto any unfinished pile', () => {
  ok(canPlayOnBuild({ rank: KING }, []), 'king onto empty');
  ok(canPlayOnBuild({ rank: JOKER }, [1, 2, 3]), 'joker onto a partial pile');
});

test('nothing plays onto a completed pile', () => {
  const full = Array(QUEEN).fill({ rank: 1 });
  ok(!canPlayOnBuild({ rank: KING }, full), 'not even a wild fits a full pile');
});

// ------------------------------------------------------------ game setup

test('deck one splits evenly into the payoff piles', () => {
  const g = createGame({ seed: 1 });
  eq(g.players.length, 2);
  for (const p of g.players) eq(p.payoff.length, 27, 'half of a 54-card deck');
});

test('deck two deals the opening hands and the rest is the draw pile', () => {
  const g = createGame({ seed: 1 });
  for (const p of g.players) eq(p.hand.length, 5);
  eq(g.draw.length, 54 - 2 * 5, 'draw pile is deck two minus the hands');
});

test('108 cards are in play and none are lost in the deal', () => {
  const g = createGame({ seed: 5 });
  const held = g.players.reduce((n, p) => n + p.payoff.length + p.hand.length, 0);
  eq(held + g.draw.length + g.completed.length, 108, 'every card accounted for');
});

test('four players still split the payoff deck evenly', () => {
  const g = createGame({ seed: 2, players: ['a', 'b', 'c', 'd'] });
  for (const p of g.players) eq(p.payoff.length, 13, '54 / 4, rounded down');
  eq(g.draw.length, 54 + 2 - 4 * 5, 'the 2 undealt payoff cards join the draw pile');
});

test('a payoff pile larger than the deck allows is rejected', () => {
  throws(
    () => createGame({ seed: 1, config: { payoffSize: 30 } }),
    'two piles of 30 do not fit in 54 cards'
  );
});

// ------------------------------------------------------------ moves

const rigged = (mutate) => {
  const g = createGame({ seed: 42 });
  mutate(g);
  return g;
};

test('playing a wild records the rank it stands in for', () => {
  const g = rigged(s => { s.players[0].hand[0] = { id: 'k', rank: KING, suit: 'S' }; });
  const after = applyMove(g, { type: 'play', from: 'hand', index: 0, to: 0 });
  eq(after.build[0][0].playedAs, 1, 'king filling the ace slot');
});

test('a pile completed at queen is cleared and recycled', () => {
  const g = rigged(s => {
    s.build[0] = Array.from({ length: QUEEN - 1 }, (_, i) => ({ id: `c${i}`, rank: i + 1, playedAs: i + 1 }));
    s.players[0].hand[0] = { id: 'q', rank: QUEEN, suit: 'H' };
  });
  const after = applyMove(g, { type: 'play', from: 'hand', index: 0, to: 0 });
  eq(after.build[0].length, 0, 'pile cleared');
  eq(after.completed.length, QUEEN, 'cards recycled');
});

test('emptying the payoff pile wins the game', () => {
  const g = rigged(s => {
    s.players[0].payoff = [{ id: 'last', rank: 1, suit: 'S' }];
  });
  const after = applyMove(g, { type: 'play', from: 'payoff', index: 0, to: 0 });
  eq(after.winner, 0);
});

test('discarding ends the turn and refills the next player', () => {
  const g = createGame({ seed: 7 });
  const after = applyMove(g, { type: 'discard', index: 0, to: 0 });
  eq(after.turn, 1, 'turn passed');
  eq(after.players[0].hand.length, 4, 'discarder is not refilled mid-turn');
  eq(after.players[1].hand.length, 5, 'next player drawn up');
  eq(after.players[0].discards[0].length, 1);
});

test('emptying your hand refills it and the turn continues', () => {
  const g = rigged(s => {
    s.players[0].hand = [{ id: 'a', rank: 1, suit: 'S' }];
  });
  const after = applyMove(g, { type: 'play', from: 'hand', index: 0, to: 0 });
  eq(after.turn, 0, 'still your turn');
  eq(after.players[0].hand.length, 5, 'fresh hand');
});

test('illegal plays are rejected', () => {
  const g = rigged(s => { s.players[0].hand[0] = { id: 'x', rank: 5, suit: 'S' }; });
  throws(() => applyMove(g, { type: 'play', from: 'hand', index: 0, to: 0 }), 'a five cannot open a pile');
});

test('legal moves always include discarding, and none once won', () => {
  const g = createGame({ seed: 3 });
  ok(getLegalMoves(g).some(m => m.type === 'discard'), 'discards offered');
  eq(getLegalMoves({ ...g, winner: 0 }).length, 0, 'no moves after a win');
});

test('applyMove does not mutate the state handed to it', () => {
  const g = createGame({ seed: 11 });
  const before = JSON.stringify(g);
  applyMove(g, { type: 'discard', index: 0, to: 0 });
  eq(JSON.stringify(g), before, 'original state untouched');
});

// ------------------------------------------------------------ report

const passed = results.filter(r => r.ok).length;
const failed = results.length - passed;

const out = document.getElementById('out');
out.innerHTML = results.map(r =>
  `<div class="${r.ok ? 'pass' : 'fail'}">${r.ok ? 'PASS' : 'FAIL'} — ${r.name}` +
  `${r.ok ? '' : `<div class="err">${r.error}</div>`}</div>`
).join('');

const summary = `${passed} passed, ${failed} failed, ${results.length} total`;
document.getElementById('summary').textContent = summary;
document.title = failed ? `FAIL (${failed})` : `PASS (${passed})`;
console.log(`TEST_SUMMARY ${summary}`);
results.filter(r => !r.ok).forEach(r => console.error(`FAILED: ${r.name} :: ${r.error}`));
