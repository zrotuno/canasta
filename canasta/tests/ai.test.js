// The computer player.
//
// Mostly this suite makes computers play whole hands against each other. Every
// move goes through the real engine, so an illegal one throws and fails the
// case: a few hundred hands is a far better check on the rules than any
// assertion written by hand.

import { test, eq, ok, no, section } from './harness.js';
import { THREE, JOKER, DEUCE, isWild, cardValue } from '../src/engine/cards.js';
import { createGame, applyMove, teamIndexOf, hasCanasta } from '../src/engine/game.js';
import { chooseMove } from '../src/ai/player.js';

section('Computer player');

let seq = 0;
const c = (rank, suit = 'S') => ({ id: `i${seq++}`, rank, suit });

const census = (s) =>
  s.players.reduce((n, p) => n + p.hand.length, 0) +
  s.stock.length + s.discard.length +
  s.teams.reduce((n, t) => n + t.redThrees.length +
    Object.values(t.melds).reduce((m, meld) => m + meld.length, 0), 0);

// Four computers play a hand out. Returns the finished state, or throws with
// whatever the engine objected to.
function playHand(seed, budget = 3000) {
  let s = createGame({ seed });
  let moves = 0;

  while (!s.handOver && moves < budget) {
    const asked = s.permission;
    const seat = (asked && asked.answer === null) ? asked.partner : s.turn;
    const move = chooseMove(s, seat);
    if (!move) break;
    s = applyMove(s, { ...move, by: seat });
    moves += 1;
  }
  return { state: s, moves };
}

test('a computer only speaks when it is spoken to', () => {
  const s = createGame({ seed: 11 });          // North to play
  eq(chooseMove(s, 1), null, 'east has nothing to say');
  eq(chooseMove(s, 2), null);
  ok(chooseMove(s, 0), 'north has a move');
});

test('four computers play a hand to its end without an illegal move', () => {
  const { state, moves } = playHand(101);
  ok(state.handOver, `the hand finished (${moves} moves)`);
  ok(moves < 3000, 'and finished well inside the budget');
  eq(census(state), 108, 'every card is still accounted for');
});

test('twenty hands, twenty different deals, no illegal moves anywhere', () => {
  let finished = 0;
  let melded = 0;
  let canastas = 0;

  for (let seed = 1; seed <= 20; seed++) {
    const { state } = playHand(seed);
    if (state.handOver) finished += 1;
    eq(census(state), 108, `seed ${seed}: cards accounted for`);
    for (const team of state.teams) {
      if (team.hasMelded) melded += 1;
      if (hasCanasta(team)) canastas += 1;
    }
  }

  eq(finished, 20, 'every hand reached an end');
  ok(melded >= 20, `partnerships opened in most hands (${melded} of 40)`);
  ok(canastas >= 1, `and canastas do get made (${canastas})`);
});

test('a hand that ends is scored, and somebody is usually out', () => {
  const { state } = playHand(202);
  ok(state.lastHandScores, 'the hand was scored');
  eq(state.lastHandScores.length, 2);
  ok(typeof state.lastHandScores[0].total === 'number');
});

test('it does not throw a wild card away while anything else will do', () => {
  const s = createGame({ seed: 7 });
  s.turn = 0;
  s.phase = 'play';
  s.teams[0].melds = { 5: [c(5, 'S'), c(5, 'H'), c(5, 'D')] };
  s.teams[0].hasMelded = true;
  s.players[0].hand = [c(JOKER, 'X'), c(DEUCE, 'H'), c(9, 'C'), c(12, 'D'), c(7, 'S')];

  const move = chooseMove(s, 0);
  eq(move.type, 'discard');
  const thrown = s.players[0].hand.find((x) => x.id === move.card);
  no(isWild(thrown), `it threw ${thrown.rank}, not a wild`);
});

test('a black three is the discard it reaches for', () => {
  const s = createGame({ seed: 8 });
  s.turn = 0;
  s.phase = 'play';
  s.teams[0].melds = { 5: [c(5, 'S'), c(5, 'H'), c(5, 'D')] };
  s.teams[0].hasMelded = true;
  s.players[0].hand = [c(THREE, 'S'), c(9, 'C'), c(12, 'D'), c(7, 'H'), c(8, 'C')];

  const move = chooseMove(s, 0);
  eq(move.type, 'discard');
  const thrown = s.players[0].hand.find((x) => x.id === move.card);
  eq(thrown.rank, THREE, 'the black three went');
});

test('it will not feed the opposition the rank they are collecting', () => {
  const s = createGame({ seed: 9 });
  s.turn = 0;
  s.phase = 'play';
  s.frozen = false;
  s.teams[0].hasMelded = true;
  s.teams[0].melds = { 5: [c(5, 'S'), c(5, 'H'), c(5, 'D')] };
  s.teams[1].melds = { 9: [c(9, 'S'), c(9, 'H'), c(9, 'D')] };
  s.teams[1].hasMelded = true;
  // A lone nine, which the opposition would love, against a lone queen.
  s.players[0].hand = [c(9, 'C'), c(12, 'D'), c(6, 'H'), c(8, 'C')];

  const move = chooseMove(s, 0);
  const thrown = s.players[0].hand.find((x) => x.id === move.card);
  no(thrown.rank === 9, `it kept the nine and threw ${thrown.rank}`);
});

test('it takes a fat pile when the pile is takeable', () => {
  const s = createGame({ seed: 12 });
  s.turn = 0;
  s.phase = 'draw';
  s.frozen = false;
  s.teams[0].hasMelded = true;
  s.discard = [c(4, 'S'), c(6, 'H'), c(8, 'C'), c(10, 'D'), c(11, 'S'), c(9, 'D')];
  s.players[0].hand = [c(9, 'S'), c(9, 'H'), c(12, 'D'), c(6, 'C')];

  const move = chooseMove(s, 0);
  eq(move.type, 'takePile', 'it went for the pile');
  const laid = move.groups.flatMap((g) => g.cards);
  ok(laid.includes(s.discard[s.discard.length - 1].id), 'and melded the top card');
});

test('it answers its partner, and says yes on a cheap hand', () => {
  const s = createGame({ seed: 13 });
  s.turn = 0;
  s.phase = 'play';
  s.permission = { asker: 0, partner: 2, answer: null };
  s.players[2].hand = [c(4, 'S'), c(5, 'H')];

  const move = chooseMove(s, 2);
  eq(move.type, 'answerPartner');
  eq(move.yes, true, 'two low cards is no reason to object');
});

test('and says no while it is still holding a fortune', () => {
  const s = createGame({ seed: 14 });
  s.turn = 0;
  s.phase = 'play';
  s.permission = { asker: 0, partner: 2, answer: null };
  s.players[2].hand = [c(JOKER, 'X'), c(JOKER, 'X'), c(1, 'S'), c(1, 'H'), c(13, 'D'), c(12, 'C')];

  const move = chooseMove(s, 2);
  eq(move.type, 'answerPartner');
  eq(move.yes, false, 'it is not throwing that away');
});
