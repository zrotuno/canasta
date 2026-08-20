// Card model and deck construction for Spite and Malice.
//
// Ranks are numeric so build-pile math is plain arithmetic:
//   1 = Ace ... 12 = Queen, 13 = King, 0 = Joker.
// Kings and Jokers are wild in this variant, so build piles top out at Queen.

export const JOKER = 0;
export const ACE = 1;
export const TWO = 2;
export const QUEEN = 12;
export const KING = 13;


export const SUITS = ['S', 'H', 'D', 'C'];

const RANK_LABELS = {
  0: 'JKR', 1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6',
  7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K',
};

export function isWild(card) {
  return card.rank === KING || card.rank === JOKER;
}

export function label(card) {
  if (card.rank === JOKER) return 'JKR';
  return RANK_LABELS[card.rank] + card.suit;
}

// Builds `deckCount` standard decks plus `jokersPerDeck` jokers each.
// One deck + 2 jokers = 54 cards; two decks + 2 jokers each = 108.
export function buildDeck({ deckCount = 2, jokersPerDeck = 2 } = {}) {
  const cards = [];
  for (let d = 0; d < deckCount; d++) {
    for (const suit of SUITS) {
      for (let rank = ACE; rank <= KING; rank++) {
        cards.push({ id: `d${d}-${suit}${rank}`, rank, suit });
      }
    }
    for (let j = 0; j < jokersPerDeck; j++) {
      cards.push({ id: `d${d}-JKR${j}`, rank: JOKER, suit: 'X' });
    }
  }
  return cards;
}

// Deterministic PRNG. A seed means a shuffle can be reproduced exactly, which
// matters for reproducible tests and for keeping two networked clients in sync.
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

// Fisher-Yates, in place, using the supplied rng.
export function shuffle(cards, rng) {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
