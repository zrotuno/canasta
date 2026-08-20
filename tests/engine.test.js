// Browser-run test suite. No Node required: tests/index.html loads this as a
// module and prints results to the page and the console.

import { buildDeck, isWild, KING, JOKER, QUEEN, ACE, TWO } from '../src/engine/cards.js';
import {
  createGame, applyMove, getLegalMoves, canPlayOnBuild, nextRankFor, forcedPlayIndices,
} from '../src/engine/game.js';

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

// ------------------------------------------------------------ helpers

const game = ({ seed = 42, ...rest } = {}) => createGame({ seed, ...rest });
const rigged = (mutate, opts) => { const g = game(opts); mutate(g); return g; };
const card = (id, rank, suit = 'S') => ({ id, rank, suit });

// A pile of `n` cards, purely so nextRankFor lands where a test wants it.
const pileOf = (n) => Array.from({ length: n }, (_, i) => card(`p${i}`, i + 1));

// Swap every compulsory card out of both hands so discarding is legal.
const noForced = (s) => {
  s.players.forEach((p) => {
    p.hand = p.hand.map((c, i) =>
      (c.rank === ACE || c.rank === TWO ? card(`safe${p.id}-${i}`, 7) : c));
  });
  return s;
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
  ok(canPlayOnBuild(card('a', ACE), []), 'ace should play on empty');
  ok(!canPlayOnBuild(card('t', TWO), []), 'two should not play on empty');
});

test('wilds cover the three upward, never an ace or a two', () => {
  ok(!canPlayOnBuild(card('k', KING), pileOf(0)), 'king cannot be an ace');
  ok(!canPlayOnBuild(card('j', JOKER), pileOf(1)), 'joker cannot be a two');
  ok(canPlayOnBuild(card('k', KING), pileOf(2)), 'king can be a three');
  ok(canPlayOnBuild(card('j', JOKER), pileOf(7)), 'joker can be an eight');
});

test('the fast house rule lets wilds cover aces and twos', () => {
  const fast = { wildsAsLowRanks: true };
  ok(canPlayOnBuild(card('k', KING), pileOf(0), fast), 'king as an ace');
  ok(canPlayOnBuild(card('j', JOKER), pileOf(1), fast), 'joker as a two');
});

test('nothing plays onto a completed pile', () => {
  ok(!canPlayOnBuild(card('k', KING), pileOf(QUEEN)), 'not even a wild fits a full pile');
});

// ------------------------------------------------------------ game setup

test('deck one splits evenly into the payoff piles', () => {
  const g = game({ seed: 1 });
  eq(g.players.length, 2);
  for (const p of g.players) eq(p.payoff.length, 27, 'half of a 54-card deck');
});

test('deck two deals the opening hands and the rest is the draw pile', () => {
  const g = game({ seed: 1 });
  for (const p of g.players) eq(p.hand.length, 5);
  eq(g.draw.length, 54 - 2 * 5, 'draw pile is deck two minus the hands');
});

test('108 cards are in play and none are lost in the deal', () => {
  const g = game({ seed: 5 });
  const held = g.players.reduce((n, p) => n + p.payoff.length + p.hand.length, 0);
  eq(held + g.draw.length + g.completed.length, 108, 'every card accounted for');
});

test('four players still split the payoff deck evenly', () => {
  const g = game({ seed: 2, players: ['a', 'b', 'c', 'd'] });
  for (const p of g.players) eq(p.payoff.length, 13, '54 / 4, rounded down');
  eq(g.draw.length, 54 + 2 - 4 * 5, 'the 2 undealt payoff cards join the draw pile');
});

test('a payoff pile larger than the deck allows is rejected', () => {
  throws(() => game({ config: { payoffSize: 30 } }), 'two piles of 30 do not fit in 54 cards');
});

// ------------------------------------------------------------ compulsory low cards

test('an ace in hand blocks discarding', () => {
  const g = rigged(s => { noForced(s); s.players[0].hand[0] = card('ace', ACE); });
  eq(forcedPlayIndices(g), [0], 'the ace is flagged');
  throws(() => applyMove(g, { type: 'discard', index: 1, to: 0 }), 'discard refused');
});

test('a two in hand blocks discarding once a pile is waiting for one', () => {
  const g = rigged(s => {
    noForced(s);
    s.players[0].hand[0] = card('two', TWO);
    s.build[0] = pileOf(1);              // this pile now wants a two
  });
  eq(forcedPlayIndices(g), [0], 'the two is flagged');
  throws(() => applyMove(g, { type: 'discard', index: 1, to: 0 }), 'discard refused');
});

test('playing the forced card releases the turn', () => {
  const g = rigged(s => { noForced(s); s.players[0].hand[0] = card('ace', ACE); });
  const after = applyMove(g, { type: 'play', from: 'hand', index: 0, to: 0 });
  eq(forcedPlayIndices(after), [], 'obligation cleared');
  eq(applyMove(after, { type: 'discard', index: 0, to: 0 }).turn, 1, 'turn now passes');
});

test('no discards are offered while a card is forced', () => {
  const g = rigged(s => { noForced(s); s.players[0].hand[0] = card('ace', ACE); });
  const moves = getLegalMoves(g);
  ok(moves.length > 0, 'plays are still offered');
  ok(!moves.some(m => m.type === 'discard'), 'but no discards');
});

test('an ace is not forced when every build pile is occupied', () => {
  const g = rigged(s => {
    noForced(s);
    s.players[0].hand[0] = card('ace', ACE);
    s.build = s.build.map(() => pileOf(1));   // nothing is waiting for an ace
  });
  eq(forcedPlayIndices(g), [], 'no obligation with nowhere to play');
  eq(applyMove(g, { type: 'discard', index: 1, to: 0 }).turn, 1, 'discard allowed');
});

test('a two is not forced when no pile is waiting for one', () => {
  const g = rigged(s => { noForced(s); s.players[0].hand[0] = card('two', TWO); });
  eq(forcedPlayIndices(g), [], 'every pile is empty, so it wants aces');
  eq(applyMove(g, { type: 'discard', index: 0, to: 0 }).turn, 1, 'discard allowed');
});

test('a wild is never forced, even when it may cover low ranks', () => {
  const g = rigged(
    s => { noForced(s); s.players[0].hand[0] = card('k', KING); },
    { config: { wildsAsLowRanks: true } }
  );
  eq(forcedPlayIndices(g), [], 'spending a wild stays a choice');
  eq(applyMove(g, { type: 'discard', index: 0, to: 0 }).turn, 1, 'discard allowed');
});

test('forceLowCards off lets you sit on an ace', () => {
  const g = rigged(
    s => { noForced(s); s.players[0].hand[0] = card('ace', ACE); },
    { config: { forceLowCards: false } }
  );
  eq(forcedPlayIndices(g), [], 'no obligation when the rule is off');
  eq(applyMove(g, { type: 'discard', index: 0, to: 0 }).turn, 1, 'discard allowed');
});

// ------------------------------------------------------------ moves

test('playing a wild records the rank it stands in for', () => {
  const g = rigged(s => {
    noForced(s);
    s.players[0].hand[0] = card('k', KING);
    s.build[0] = pileOf(2);             // pile wants a three
  });
  const after = applyMove(g, { type: 'play', from: 'hand', index: 0, to: 0 });
  eq(after.build[0][2].playedAs, 3, 'king filling the three slot');
});

test('a pile completed at queen is cleared and recycled', () => {
  const g = rigged(s => {
    noForced(s);
    s.build[0] = pileOf(QUEEN - 1);
    s.players[0].hand[0] = card('q', QUEEN, 'H');
  });
  const after = applyMove(g, { type: 'play', from: 'hand', index: 0, to: 0 });
  eq(after.build[0].length, 0, 'pile cleared');
  eq(after.completed.length, QUEEN, 'cards recycled');
});

test('emptying the payoff pile wins the game', () => {
  const g = rigged(s => { s.players[0].payoff = [card('last', ACE)]; });
  const after = applyMove(g, { type: 'play', from: 'payoff', index: 0, to: 0 });
  eq(after.winner, 0);
});

test('discarding ends the turn and refills the next player', () => {
  const g = noForced(game({ seed: 7 }));
  const after = applyMove(g, { type: 'discard', index: 0, to: 0 });
  eq(after.turn, 1, 'turn passed');
  eq(after.players[0].hand.length, 4, 'discarder is not refilled mid-turn');
  eq(after.players[1].hand.length, 5, 'next player drawn up');
  eq(after.players[0].discards[0].length, 1);
});

test('emptying your hand refills it and the turn continues', () => {
  const g = rigged(s => { s.players[0].hand = [card('a', ACE)]; });
  const after = applyMove(g, { type: 'play', from: 'hand', index: 0, to: 0 });
  eq(after.turn, 0, 'still your turn');
  eq(after.players[0].hand.length, 5, 'fresh hand');
});

test('illegal plays are rejected', () => {
  const g = rigged(s => { s.players[0].hand[0] = card('x', 5); });
  throws(() => applyMove(g, { type: 'play', from: 'hand', index: 0, to: 0 }), 'a five cannot open a pile');
});

test('legal moves include discarding, and none once won', () => {
  const g = noForced(game({ seed: 3 }));
  ok(getLegalMoves(g).some(m => m.type === 'discard'), 'discards offered');
  eq(getLegalMoves({ ...g, winner: 0 }).length, 0, 'no moves after a win');
});

test('applyMove does not mutate the state handed to it', () => {
  const g = noForced(game({ seed: 11 }));
  const before = JSON.stringify(g);
  applyMove(g, { type: 'discard', index: 0, to: 0 });
  eq(JSON.stringify(g), before, 'original state untouched');
});

// The rule stated plainly: run your hand to zero without discarding and you
// draw a fresh five and keep playing. Only a discard ends a turn.
test('playing all five cards draws five more and the turn continues', () => {
  const g = rigged(s => {
    s.players[0].hand = [
      card('a0', ACE, 'S'), card('a1', ACE, 'H'), card('a2', ACE, 'D'),
      card('a3', ACE, 'C'), card('t0', TWO, 'S'),
    ];
  });
  // Four aces open the four build piles; the two lands on the first of them.
  let s = g;
  for (let pile = 0; pile < 4; pile++) {
    s = applyMove(s, { type: 'play', from: 'hand', index: 0, to: pile });
    eq(s.turn, 0, 'still your turn mid-hand');
  }
  eq(s.players[0].hand.length, 1, 'one card left, no refill yet');

  s = applyMove(s, { type: 'play', from: 'hand', index: 0, to: 0 });
  eq(s.players[0].hand.length, 5, 'hand refilled on reaching zero');
  eq(s.turn, 0, 'turn did not pass');
  eq(s.players[0].discards.flat().length, 0, 'nothing was discarded');
});

test('a discard is the only thing that ends a turn', () => {
  const g = rigged(s => { noForced(s); s.players[0].hand[0] = card('ace', ACE); });
  eq(applyMove(g, { type: 'play', from: 'hand', index: 0, to: 0 }).turn, 0, 'play keeps the turn');
  const clear = noForced(game({ seed: 21 }));
  eq(applyMove(clear, { type: 'discard', index: 0, to: 0 }).turn, 1, 'discard passes it');
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
