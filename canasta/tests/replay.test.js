// The property the whole networked game rests on: a seed plus a list of moves
// rebuilds one and only one game, the same on every device.

import { test, eq, ok, section } from './harness.js';
import { applyMove } from '../src/engine/game.js';
import { cardValue } from '../src/engine/cards.js';
import { rebuild, seatNames, NEW_HAND } from '../src/net/replay.js';

section('Replay');

const room = (moves = [], seats = []) => ({ seed: 4242, seats, moves });

// Plays a few honest turns, collecting the log as it goes.
function playSome(turns = 8) {
  let { state } = rebuild(room());
  const moves = [];
  for (let i = 0; i < turns; i++) {
    const drawn = applyMove(state, { type: 'draw' });
    const card = drawn.players[drawn.turn].hand[0].id;
    moves.push({ type: 'draw' }, { type: 'discard', card });
    state = applyMove(drawn, { type: 'discard', card });
  }
  return { state, moves };
}

test('a log replays to exactly the state it was built from', () => {
  const { state, moves } = playSome();
  const { state: replayed, error } = rebuild(room(moves));
  eq(error, null, 'nothing should have gone wrong');
  eq(JSON.stringify(replayed), JSON.stringify(state), 'the rebuilt game matches');
});

test('two devices replaying the same log agree down to the last card', () => {
  const { moves } = playSome(12);
  const a = rebuild(room(moves)).state;
  const b = rebuild(room(moves)).state;
  eq(JSON.stringify(a), JSON.stringify(b));
});

test('the same seed always deals the same hands', () => {
  const one = rebuild(room()).state;
  const two = rebuild(room()).state;
  eq(one.players.map((p) => p.hand.map((c) => c.id)),
     two.players.map((p) => p.hand.map((c) => c.id)));
});

test('meld groups survive the trip through Firestore', () => {
  // Firestore cannot nest an array inside an array, so groups travel as
  // objects. Replay has to take them in that form.
  // Hunts for a deal whose leader can actually open, since a trio of low
  // cards will not clear the fifty-point minimum.
  let found = null;
  for (let seed = 1; seed < 200 && !found; seed++) {
    const start = rebuild({ seed, seats: [], moves: [] }).state;
    const drawn = applyMove(start, { type: 'draw' });
    const byRank = {};
    for (const card of drawn.players[0].hand) {
      if (card.rank > 3) (byRank[card.rank] ??= []).push(card);
    }
    const groups = [];
    let worth = 0;
    for (const cards of Object.values(byRank)) {
      if (cards.length < 3) continue;
      groups.push({ to: null, ids: cards.map((c) => c.id) });
      worth += cards.reduce((n, c) => n + cardValue(c), 0);
    }
    if (worth >= 50) found = { seed, groups, rank: Number(Object.keys(byRank).find((r) => byRank[r].length >= 3)) };
  }
  ok(found, 'some deal in the first two hundred lets the leader open');

  const moves = [{ type: 'draw' }, { type: 'meld', groups: found.groups }];
  const { state: after, error } = rebuild({ seed: found.seed, seats: [], moves });
  eq(error, null, error || '');
  ok(after.teams[0].hasMelded, 'the partnership is open');
  eq(after.teams[0].melds[found.rank].length >= 3, true, 'the meld went down');
});

test('a move that cannot be applied stops the replay instead of exploding', () => {
  const moves = [{ type: 'draw' }, { type: 'discard', card: 'no-such-card' }];
  const { state, applied, error } = rebuild(room(moves));
  ok(error, 'an error was reported');
  ok(error.includes('discard'), `the error names the move: ${error}`);
  eq(applied, 1, 'the good move stuck and the bad one did not');
  eq(state.phase, 'play', 'the state is the one from just before');
});

test('a new hand cannot be dealt over a hand still in progress', () => {
  const { error } = rebuild(room([{ type: NEW_HAND }]));
  ok(error && error.includes('still being played'), `got: ${error}`);
});

test('seat names fall back to compass points until people sit down', () => {
  eq(seatNames([{ id: 'x', name: 'Tim' }, null, { id: 'y', name: 'Jonelle' }, null]),
     ['Tim', 'East', 'Jonelle', 'West']);
});
