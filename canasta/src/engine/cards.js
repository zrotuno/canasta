// Card model for Canasta.
//
// Ranks are numeric: 0 = Joker, 1 = Ace, 2 = Deuce, 3..10, 11 = Jack,
// 12 = Queen, 13 = King. Aces are high in Canasta but never form runs, so the
// number only ever matters for grouping and scoring.

export const JOKER = 0;
export const ACE = 1;
export const DEUCE = 2;
export const THREE = 3;

export const SUITS = ['S', 'H', 'D', 'C'];
const RED_SUITS = new Set(['H', 'D']);

const RANK_LABELS = {
  0: 'JKR', 1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K',
};

export const isRed = (card) => RED_SUITS.has(card.suit);

// Jokers and deuces stand in for any natural rank.
export const isWild = (card) => card.rank === JOKER || card.rank === DEUCE;

// The two kinds of three behave nothing alike: red threes are pure bonus and
// never played, black threes are a defensive discard.
export const isRedThree = (card) => card.rank === THREE && isRed(card);
export const isBlackThree = (card) => card.rank === THREE && !isRed(card);

// A card that can anchor a meld: anything that is neither wild nor a three.
export const isNatural = (card) => !isWild(card) && card.rank !== THREE;

export function cardValue(card) {
  if (card.rank === JOKER) return 50;
  if (card.rank === DEUCE) return 20;
  if (card.rank === ACE) return 20;
  if (card.rank === THREE) return isRed(card) ? 100 : 5;
  if (card.rank >= 8) return 10;    // 8, 9, 10, J, Q, K
  return 5;                          // 4, 5, 6, 7
}

export function label(card) {
  if (card.rank === JOKER) return 'JKR';
  return RANK_LABELS[card.rank] + card.suit;
}

// Two full decks plus four jokers: 108 cards, the standard Canasta pack.
export function buildDeck({ deckCount = 2, jokersPerDeck = 2 } = {}) {
  const cards = [];
  for (let d = 0; d < deckCount; d++) {
    for (const suit of SUITS) {
      for (let rank = ACE; rank <= 13; rank++) {
        cards.push({ id: `d${d}-${suit}${rank}`, rank, suit });
      }
    }
    for (let j = 0; j < jokersPerDeck; j++) {
      cards.push({ id: `d${d}-JKR${j}`, rank: JOKER, suit: 'X' });
    }
  }
  return cards;
}

// Deterministic PRNG so a deal can be replayed exactly in a test.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(cards, rng) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
