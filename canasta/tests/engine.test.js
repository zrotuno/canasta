// Browser-run test suite for the Canasta engine. No Node required.

import {
  buildDeck, cardValue, isWild, isNatural, isRedThree, isBlackThree, label,
  JOKER, DEUCE, ACE, THREE,
} from '../src/engine/cards.js';
import {
  meldError, isValidMeld, canAddToMeld, meldPoints, meldRank,
  isCanasta, isNaturalCanasta, canastaBonus, isBlackThreeMeld,
} from '../src/engine/melds.js';

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
const no = (cond, what) => { if (cond) throw new Error(what || 'expected falsy'); };

let seq = 0;
const c = (rank, suit = 'S') => ({ id: `t${seq++}`, rank, suit });
const joker = () => c(JOKER, 'X');

// ------------------------------------------------------------ deck

test('the pack is 108 cards', () => {
  eq(buildDeck().length, 108, 'two decks plus four jokers');
});

test('every card id is unique', () => {
  const deck = buildDeck();
  eq(new Set(deck.map((x) => x.id)).size, deck.length);
});

test('the pack holds exactly four jokers and four red threes', () => {
  const deck = buildDeck();
  eq(deck.filter((x) => x.rank === JOKER).length, 4, 'jokers');
  eq(deck.filter(isRedThree).length, 4, 'red threes');
  eq(deck.filter(isBlackThree).length, 4, 'black threes');
});

// ------------------------------------------------------------ classification

test('jokers and deuces are wild, nothing else is', () => {
  ok(isWild(joker()), 'joker');
  ok(isWild(c(DEUCE)), 'deuce');
  no(isWild(c(ACE)), 'ace is not wild');
  no(isWild(c(THREE, 'H')), 'red three is not wild');
});

test('red and black threes are told apart', () => {
  ok(isRedThree(c(THREE, 'H')), 'heart three is red');
  ok(isRedThree(c(THREE, 'D')), 'diamond three is red');
  ok(isBlackThree(c(THREE, 'S')), 'spade three is black');
  no(isRedThree(c(THREE, 'C')), 'club three is not red');
});

test('naturals exclude wilds and every three', () => {
  ok(isNatural(c(ACE)), 'ace');
  ok(isNatural(c(8, 'H')), 'eight');
  no(isNatural(joker()), 'joker');
  no(isNatural(c(DEUCE)), 'deuce');
  no(isNatural(c(THREE, 'S')), 'black three');
});

test('card values follow the standard table', () => {
  eq(cardValue(joker()), 50, 'joker');
  eq(cardValue(c(DEUCE)), 20, 'deuce');
  eq(cardValue(c(ACE)), 20, 'ace');
  eq(cardValue(c(13)), 10, 'king');
  eq(cardValue(c(8)), 10, 'eight');
  eq(cardValue(c(7)), 5, 'seven');
  eq(cardValue(c(4)), 5, 'four');
  eq(cardValue(c(THREE, 'S')), 5, 'black three');
  eq(cardValue(c(THREE, 'H')), 100, 'red three');
});

test('labels read the way a player would say them', () => {
  eq(label(c(ACE, 'H')), 'AH');
  eq(label(c(10, 'D')), '10D');
  eq(label(joker()), 'JKR');
});

// ------------------------------------------------------------ melds

test('three of a rank is a meld', () => {
  ok(isValidMeld([c(8, 'S'), c(8, 'H'), c(8, 'D')]));
  eq(meldRank([c(8, 'S'), c(8, 'H'), c(8, 'D')]), 8);
});

test('two cards are not enough', () => {
  ok(meldError([c(8, 'S'), c(8, 'H')]).includes('at least 3'));
});

test('a meld needs two natural cards', () => {
  const meld = [c(8, 'S'), joker(), c(DEUCE, 'H')];
  ok(meldError(meld).includes('natural'), 'one natural is not enough');
});

test('a meld carries at most three wilds', () => {
  const legal = [c(8, 'S'), c(8, 'H'), joker(), joker(), c(DEUCE, 'S')];
  ok(isValidMeld(legal), 'three wilds is fine');
  const tooMany = [...legal, c(DEUCE, 'H')];
  ok(meldError(tooMany).includes('at most 3'), 'four wilds is not');
});

test('naturals in a meld must share a rank', () => {
  ok(meldError([c(8, 'S'), c(9, 'H'), joker()]).includes('same rank'));
});

test('red threes are never melded', () => {
  ok(meldError([c(THREE, 'H'), c(THREE, 'D'), c(8, 'S')]).includes('Red threes'));
});

test('black threes meld only among themselves and without wilds', () => {
  const three = [c(THREE, 'S'), c(THREE, 'C'), c(THREE, 'S')];
  eq(meldError(three), null, 'a clean black three meld is legal');
  ok(isBlackThreeMeld(three), 'recognised as a black three meld');
  ok(meldError([...three.slice(0, 2), joker()]).includes('wild'), 'no wilds allowed');
  ok(meldError([c(THREE, 'S'), c(THREE, 'C'), c(8, 'H')]).includes('mixed'), 'no other ranks');
});

test('adding to a meld has to leave it legal', () => {
  const meld = [c(8, 'S'), c(8, 'H'), joker(), joker(), c(DEUCE, 'S')];
  ok(canAddToMeld(meld, [c(8, 'D')]), 'another natural is welcome');
  no(canAddToMeld(meld, [joker()]), 'a fourth wild is not');
});

test('meld points add up the cards', () => {
  eq(meldPoints([c(8, 'S'), c(8, 'H'), joker()]), 10 + 10 + 50);
  eq(meldPoints([c(THREE, 'S'), c(THREE, 'C'), c(THREE, 'S')]), 15, 'black threes');
});

// ------------------------------------------------------------ canastas

test('seven cards make a canasta', () => {
  const six = Array.from({ length: 6 }, () => c(8, 'S'));
  no(isCanasta(six), 'six is not yet');
  ok(isCanasta([...six, c(8, 'H')]), 'seven is');
});

test('a natural canasta scores 500 and a mixed one 300', () => {
  const natural = Array.from({ length: 7 }, () => c(8, 'S'));
  ok(isNaturalCanasta(natural), 'no wilds');
  eq(canastaBonus(natural), 500);

  const mixed = [...natural.slice(0, 6), joker()];
  no(isNaturalCanasta(mixed), 'a wild makes it mixed');
  eq(canastaBonus(mixed), 300);

  eq(canastaBonus(natural.slice(0, 6)), 0, 'no bonus below seven');
});

// ------------------------------------------------------------ report

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;

document.getElementById('out').innerHTML = results.map((r) =>
  `<div class="${r.ok ? 'pass' : 'fail'}">${r.ok ? 'PASS' : 'FAIL'} — ${r.name}` +
  `${r.ok ? '' : `<div class="err">${r.error}</div>`}</div>`).join('');

const summary = `${passed} passed, ${failed} failed, ${results.length} total`;
document.getElementById('summary').textContent = summary;
document.title = failed ? `FAIL (${failed})` : `PASS (${passed})`;
console.log(`TEST_SUMMARY ${summary}`);
results.filter((r) => !r.ok).forEach((r) => console.error(`FAILED: ${r.name} :: ${r.error}`));
