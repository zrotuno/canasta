// Canasta rules engine: four players, two partnerships, classic rules.
//
// Pure state machine. Every move goes through applyMove, which validates first
// and returns a NEW state, so the same code can drive a local board, a bot, or
// a server refereeing remote players.
//
// A turn is two phases. In 'draw' you must either take one card from the stock
// or take the whole discard pile. In 'play' you may lay melds down and must
// finish by discarding, unless you go out.

import {
  buildDeck, makeRng, shuffle, cardValue, isWild, isRedThree, isBlackThree, isNatural, label,
} from './cards.js';
import {
  meldError, addToMeldError, meldPoints, meldRank, canastaBonus, isCanasta,
  isBlackThreeMeld, canAddToMeld, MAX_WILDS,
} from './melds.js';

export const DEFAULT_CONFIG = {
  handSize: 11,
  // Decks in the pack, two jokers apiece. Two decks is the classic 108 cards.
  deckCount: 2,
  // Canastas a partnership needs before it may go out.
  canastasToGoOut: 2,
  // Cards taken from the stock on a turn. Two, against the one of the classic
  // game: the hand grows by a card a turn and the stock empties twice as fast,
  // which makes for shorter hands and much fuller ones.
  drawCount: 2,
  targetScore: 5000,
  goOutBonus: 100,
  concealedBonus: 200,
  redThreeValue: 100,
  allRedThreesValue: 800,
};

// A partnership's opening meld has to clear a bar that rises with its score.
export function initialMeldMinimum(score) {
  if (score < 0) return 15;
  if (score < 1500) return 50;
  if (score < 3000) return 90;
  return 120;
}

export const teamIndexOf = (playerIndex) => playerIndex % 2;
export const currentPlayer = (s) => s.players[s.turn];
export const currentTeam = (s) => s.teams[teamIndexOf(s.turn)];
export const topDiscard = (s) => (s.discard.length ? s.discard[s.discard.length - 1] : null);

const byId = (cards, id) => cards.find((c) => c.id === id);

// ---------------------------------------------------------------- setup

export function createGame({
  config = {}, seed = Date.now(),
  players = ['North', 'East', 'South', 'West'],
  scores = [0, 0],
  firstPlayer = 0,          // rotates each hand so the lead moves round the table
} = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  if (players.length !== 4) throw new Error('Canasta seats exactly four players.');

  const rng = makeRng(seed);
  const stock = shuffle(buildDeck({ deckCount: cfg.deckCount }), rng);

  const teams = [0, 1].map((id) => ({
    id,
    melds: {},          // rank -> cards; black threes live under key 'B3'
    redThrees: [],
    score: scores[id],
    minimum: initialMeldMinimum(scores[id]),
    hasMelded: false,
  }));

  const seats = players.map((name, i) => ({
    id: i, name, team: teamIndexOf(i), hand: [],
  }));

  const state = {
    config: cfg, seed, players: seats, teams,
    stock, discard: [], frozen: false,
    turn: firstPlayer % 4, phase: 'draw',
    tookPileThisTurn: false,
    meldedThisTurn: false,
    // True when the partnership put its very first meld down this turn, which
    // is what makes going out in the same turn a concealed hand.
    openedThisTurn: false,
    // Set while a player has asked their partner for leave to go out.
    permission: null,
    // Who threw the card now on top, so the board can name them when the pile
    // is carried off. Null while the turned-up card is still on top.
    lastDiscarder: null,
    handOver: false, outPlayer: null, gameOver: false,
    lastHandScores: null, log: [],
  };

  // Deal, replacing any red three dealt into a hand as it appears.
  for (let n = 0; n < cfg.handSize; n++) {
    for (const seat of seats) drawInto(state, seat);
  }

  // Turn the first card. Wilds and red threes freeze the pile and another
  // card is turned on top of them.
  while (state.stock.length) {
    const card = state.stock.pop();
    state.discard.push(card);
    if (isWild(card) || isRedThree(card)) state.frozen = true;
    else break;
  }

  state.log.push({
    turn: null,
    move: {
      type: 'deal',
      top: label(state.discard[state.discard.length - 1]),
      frozen: state.frozen,
    },
  });

  return state;
}

// Draws one card, banking red threes and drawing again in their place.
// Returns false only when the stock has run dry.
function drawInto(state, seat) {
  for (;;) {
    if (state.stock.length === 0) return false;
    const card = state.stock.pop();
    if (isRedThree(card)) {
      state.teams[seat.team].redThrees.push(card);
      continue;
    }
    seat.hand.push(card);
    return true;
  }
}

// ---------------------------------------------------------------- queries

export const teamMelds = (team) => Object.values(team.melds);
export const teamCanastas = (team) => teamMelds(team).filter(isCanasta);
export const hasCanasta = (team) => teamCanastas(team).length > 0;

// Going out takes more than one canasta in this house: the number lives in the
// config so the classic single-canasta game is still a setting away.
export const canGoOut = (state, team) =>
  teamCanastas(team).length >= state.config.canastasToGoOut;

const goingOutNeeds = (state) =>
  `Your side needs ${state.config.canastasToGoOut} canastas before going out.`;

// Card values on the table, before any bonus.
export const meldedValue = (team) => teamMelds(team).reduce((n, m) => n + meldPoints(m), 0);

// Which ranks are canastas right now, and which have just become one. The
// board wants to know the moment a canasta is completed, and by whom.
const canastaRanks = (team) => new Set(
  Object.entries(team.melds).filter(([, m]) => isCanasta(m)).map(([rank]) => rank));

const canastasSince = (team, before) => Object.entries(team.melds)
  .filter(([rank, m]) => isCanasta(m) && !before.has(rank))
  .map(([rank, m]) => ({ rank, natural: !m.some(isWild) }));

// The pile is untouchable while a black three or a wild sits on top of it.
export function pileBlockedReason(state) {
  const top = topDiscard(state);
  if (!top) return 'The discard pile is empty.';
  if (isBlackThree(top)) return 'A black three blocks the pile.';
  if (isWild(top)) return 'A wild card blocks the pile.';
  return null;
}

// What the player must hold to take the pile, given the top card.
// Frozen: two natural cards of that rank, always.
// Unfrozen: two cards of that rank (a wild may be one of them), or an
// existing team meld of that rank to add it to.
export function canTakePile(state, playerIndex = state.turn) {
  const blocked = pileBlockedReason(state);
  if (blocked) return { ok: false, reason: blocked };

  const top = topDiscard(state);
  const hand = state.players[playerIndex].hand;
  const team = state.teams[teamIndexOf(playerIndex)];

  const naturals = hand.filter((c) => c.rank === top.rank && isNatural(c));
  const wilds = hand.filter(isWild);

  if (state.frozen) {
    return naturals.length >= 2
      ? { ok: true, mode: 'frozen-pair' }
      : { ok: false, reason: 'The pile is frozen: you need two natural cards matching the top card.' };
  }
  // A meld of that rank takes the pile for you. A closed canasta of that rank
  // does the opposite: melds are one to a rank, so with the canasta shut there
  // is nowhere for the card to go and the pile is not yours by any route.
  const ours = team.melds[top.rank];
  if (ours && isCanasta(ours)) {
    return { ok: false, reason: 'Your canasta of that rank is closed, so the top card has nowhere to go.' };
  }
  if (ours) return { ok: true, mode: 'add-to-meld' };
  if (naturals.length >= 2) return { ok: true, mode: 'pair' };
  if (naturals.length >= 1 && wilds.length >= 1) return { ok: true, mode: 'natural-plus-wild' };

  return { ok: false, reason: 'You cannot use the top card, so the pile is not yours to take.' };
}

// With the stock gone, a player whose side can simply lay the top card on a
// meld it already has is obliged to take the pile rather than end the hand.
//
// The obligation only bites where taking is actually possible. A frozen pile
// wants two natural cards from hand, and a player who has not got them cannot
// be compelled to do the impossible -- which, before this was checked, left
// them with no legal move at all and the hand stuck fast.
export function mustTakePile(state, playerIndex = state.turn) {
  if (state.stock.length > 0) return false;
  if (!canTakePile(state, playerIndex).ok) return false;
  const team = state.teams[teamIndexOf(playerIndex)];
  const top = topDiscard(state);
  return Boolean(team.melds[top.rank]) && canAddToMeld(team.melds[top.rank], [top]);
}

// ---------------------------------------------------------------- melding

// A group is either a bare list of card ids, whose target meld is read off the
// natural cards in it, or { to, cards } naming the meld explicitly. The
// explicit form is what lets a lone wild card join a meld already down.
export function normalizeGroups(groups = []) {
  return groups.map((g) => (Array.isArray(g)
    ? { to: null, ids: g }
    : { to: g.to ?? null, ids: g.cards ?? g.ids ?? [] }));
}

// Applies entries to a team's melds. Returns the points laid down, or throws
// with the reason it is illegal.
function layGroups(team, entries, { goingOut }) {
  let laid = 0;

  for (const { to, cards } of entries) {
    if (cards.length === 0) throw new Error('An empty meld cannot be laid down.');

    if (to === 'B3' || (to === null && isBlackThreeMeld(cards))) {
      if (!goingOut) throw new Error('Black threes may only be melded as you go out.');
      const error = meldError(cards);
      if (error) throw new Error(error);
      team.melds.B3 = [...(team.melds.B3 ?? []), ...cards];
      laid += meldPoints(cards);
      continue;
    }

    let rank = to;
    if (rank === null) {
      rank = meldRank(cards);
      if (rank === null) {
        throw new Error(cards.every(isWild)
          ? 'Say which meld the wild card is joining.'
          : 'Every natural card in a meld must be the same rank.');
      }
    }

    const existing = team.melds[rank];
    if (to !== null && !existing) throw new Error(`Your side has no meld of that rank to add to.`);

    // A finished canasta is closed and takes nothing more, so adding to a meld
    // is a different question from laying a fresh one.
    const error = existing ? addToMeldError(existing, cards) : meldError(cards);
    if (error) throw new Error(error);

    const combined = [...(existing ?? []), ...cards];

    team.melds[rank] = combined;
    laid += meldPoints(cards);
  }

  return laid;
}

// Pulls the named cards out of a hand, failing loudly rather than silently
// melding a card the player does not hold.
function takeFromHand(hand, ids) {
  const taken = [];
  for (const id of ids) {
    const index = hand.findIndex((c) => c.id === id);
    if (index === -1) throw new Error('You do not hold one of those cards.');
    taken.push(hand.splice(index, 1)[0]);
  }
  return taken;
}

// ---------------------------------------------------------------- moves

export function applyMove(state, move) {
  if (state.handOver) throw new Error('The hand is over.');
  const next = structuredClone(state);
  const player = currentPlayer(next);
  const team = currentTeam(next);

  // A move made over the network says which seat made it. Every move but the
  // answer to a question belongs to the player whose turn it is, and that is
  // checked here rather than in the board, so a stale phone or a second tap
  // cannot play somebody else's turn for them.
  if (move.by !== undefined && move.type !== 'answerPartner' && move.by !== next.turn) {
    throw new Error(`It is ${player.name}'s turn, not yours.`);
  }

  switch (move.type) {
    case 'draw': return doDraw(next, player);
    case 'pass': return doPass(next);
    case 'takePile': return doTakePile(next, player, team, move);
    case 'meld': return doMeld(next, player, team, move);
    case 'discard': return doDiscard(next, player, team, move);
    case 'askPartner': return doAskPartner(next, player);
    case 'answerPartner': return doAnswerPartner(next, move);
    default: throw new Error(`Unknown move type: ${move.type}`);
  }
}

function doDraw(next, player) {
  if (next.phase !== 'draw') throw new Error('You have already drawn this turn.');

  // Once the stock is gone the hand lives on the discard pile alone: the only
  // way to keep playing is to take it, and the hand ends the moment somebody
  // cannot or will not.
  if (next.stock.length === 0) {
    if (canTakePile(next).ok) {
      throw new Error('The stock is gone. Take the discard pile, or pass to end the hand.');
    }
    return endHand(next, null);
  }

  // A turn draws `drawCount` cards, red threes banked and replaced as they
  // come. Running dry partway is not the end of anything: the player keeps
  // what they got and plays on, and the hand ends on the next turn that
  // cannot draw at all.
  const redsBefore = next.teams[player.team].redThrees.length;
  let drawn = 0;
  while (drawn < next.config.drawCount && drawInto(next, player)) drawn += 1;
  if (drawn === 0) return endHand(next, null);

  next.phase = 'play';
  // The log is read by every player, so it says how many cards were drawn and
  // never which. Red threes are the exception: they go face up on the table as
  // they are drawn, so naming them gives nothing away.
  next.log.push({
    turn: next.turn,
    move: {
      type: 'draw',
      cards: drawn,
      reds: next.teams[player.team].redThrees.length - redsBefore,
    },
  });
  return next;
}

// Declining the pile once the stock is gone, which ends the hand with nobody
// out. Refused while the top card fits a meld already on your side's table --
// that pile is compulsory.
function doPass(next) {
  if (next.phase !== 'draw') throw new Error('You can only pass instead of drawing.');
  if (next.stock.length > 0) throw new Error('The stock still has cards, so you must draw or take the pile.');
  if (mustTakePile(next)) {
    throw new Error('The top card goes onto a meld of yours, so the pile is compulsory.');
  }
  next.log.push({ turn: next.turn, move: { type: 'pass' } });
  return endHand(next, null);
}

// ------------------------------------------------- asking to go out

export const partnerOf = (playerIndex) => (playerIndex + 2) % 4;

// Asking is optional, but the answer binds you, so it may only be asked once
// and only during your own play phase.
function doAskPartner(next, player) {
  if (next.phase !== 'play') throw new Error('Ask your partner during your turn, after you have drawn.');
  if (next.permission) throw new Error('You have already asked this turn.');
  next.permission = { asker: player.id, partner: partnerOf(player.id), answer: null };
  next.log.push({ turn: next.turn, move: { type: 'askPartner' } });
  return next;
}

function doAnswerPartner(next, move) {
  if (!next.permission) throw new Error('Nobody has asked to go out.');
  if (move.by !== undefined && move.by !== next.permission.partner) {
    throw new Error('Only the partner who was asked can answer.');
  }
  if (next.permission.answer !== null) throw new Error('That question has already been answered.');
  if (typeof move.yes !== 'boolean') throw new Error('Answer yes or no.');
  next.permission.answer = move.yes ? 'yes' : 'no';
  next.log.push({ turn: next.turn, move: { type: 'answerPartner', yes: move.yes } });
  return next;
}

// A refusal binds: having asked and been told no, you may not go out this turn.
function refuseIfDenied(next, player) {
  const p = next.permission;
  if (p && p.asker === player.id && p.answer === 'no') {
    throw new Error('Your partner said no, so you cannot go out this turn.');
  }
}

function doTakePile(next, player, team, move) {
  if (next.phase !== 'draw') throw new Error('The pile can only be taken instead of drawing.');

  const check = canTakePile(next);
  if (!check.ok) throw new Error(check.reason);

  const top = topDiscard(next);
  const entries = normalizeGroups(move.groups);
  if (!entries.some((g) => g.ids.includes(top.id))) {
    throw new Error('The top card of the pile must be melded straight away.');
  }

  // The player takes the whole pile, but only the top card and cards from
  // hand may count toward an opening meld.
  const pile = next.discard.splice(0, next.discard.length);
  const rest = pile.filter((c) => c.id !== top.id);
  // A red three buried in the pile is a bonus like any other: it is banked on
  // the spot, and unlike one drawn from the stock it is not replaced.
  const buriedReds = rest.filter(isRedThree);
  const fromPile = rest.filter((c) => !isRedThree(c));
  player.hand.push(top);

  const wasFirstMeld = !team.hasMelded;
  const canastasBefore = canastaRanks(team);
  const built = entries.map((g) => ({ to: g.to, cards: takeFromHand(player.hand, g.ids) }));

  // A frozen pile demands two natural cards from hand alongside the top card.
  if (next.frozen) {
    const group = built.find((g) => g.cards.some((c) => c.id === top.id));
    const naturals = group.cards.filter((c) => c.id !== top.id && c.rank === top.rank && isNatural(c));
    if (naturals.length < 2) {
      throw new Error('The pile is frozen: you need two natural cards matching the top card.');
    }
  }

  const laid = layGroups(team, built, { goingOut: false });
  if (wasFirstMeld && laid < team.minimum) {
    throw new Error(`Your first meld must be worth ${team.minimum}; that is only ${laid}.`);
  }

  team.hasMelded = true;
  if (wasFirstMeld) next.openedThisTurn = true;
  team.redThrees.push(...buriedReds);
  player.hand.push(...fromPile);
  next.frozen = false;
  next.phase = 'play';
  next.tookPileThisTurn = true;
  next.meldedThisTurn = true;
  // How the pile was won matters to everyone watching, and settles the
  // argument about whether a frozen pile should have gone at all. `from` is
  // the player who threw the card that was carried off with it, who will want
  // to be named.
  next.log.push({
    turn: next.turn,
    move: {
      type: 'takePile', count: pile.length, mode: check.mode,
      top: label(top), reds: buriedReds.length,
      from: next.lastDiscarder,
      made: canastasSince(team, canastasBefore),
    },
  });
  return next;
}

function doMeld(next, player, team, move) {
  if (next.phase !== 'play') throw new Error('Draw before you meld.');

  const entries = normalizeGroups(move.groups);
  if (entries.length === 0) throw new Error('Nothing was selected to meld.');

  const wasFirstMeld = !team.hasMelded;
  const canastasBefore = canastaRanks(team);
  const selected = entries.reduce((n, g) => n + g.ids.length, 0);
  // Going out is melding the whole hand, or melding all but the one card you
  // then discard. Both count as "as you go out" for black threes.
  const remaining = player.hand.length - selected;
  const goingOut = remaining === 0 || (remaining === 1 && canGoOut(next, team));

  const built = entries.map((g) => ({ to: g.to, cards: takeFromHand(player.hand, g.ids) }));
  const laid = layGroups(team, built, { goingOut });

  if (wasFirstMeld && laid < team.minimum) {
    throw new Error(`Your first meld must be worth ${team.minimum}; that is only ${laid}.`);
  }

  team.hasMelded = true;
  if (wasFirstMeld) next.openedThisTurn = true;
  next.meldedThisTurn = true;

  // A turn ends in a discard, and discarding your last card is going out. So
  // melding down to one card without a canasta would leave no legal move at
  // all. It is checked here, after the melds are down, because the meld being
  // laid may itself be what completes the canasta.
  if (player.hand.length === 1 && !canGoOut(next, team)) {
    throw new Error('That would leave you one card you could not legally discard: '
      + goingOutNeeds(next).toLowerCase());
  }

  next.log.push({
    turn: next.turn,
    move: {
      type: 'meld', laid, opened: wasFirstMeld,
      cards: built.reduce((n, g) => n + g.cards.length, 0),
      ranks: built.map((g) => g.to ?? meldRank(g.cards) ?? 'B3'),
      made: canastasSince(team, canastasBefore),
    },
  });

  // Melding your last card goes out, provided the partnership has its canastas.
  if (player.hand.length === 0) {
    refuseIfDenied(next, player);
    if (!canGoOut(next, team)) throw new Error(goingOutNeeds(next));
    return endHand(next, player.id);
  }
  return next;
}

function doDiscard(next, player, team, move) {
  if (next.phase !== 'play') throw new Error('Draw before you discard.');

  const card = byId(player.hand, move.card);
  if (!card) throw new Error('You do not hold that card.');

  // Going out on the discard needs the canastas, same as melding out.
  const goingOut = player.hand.length === 1;
  if (goingOut) {
    refuseIfDenied(next, player);
    if (!canGoOut(next, team)) throw new Error(goingOutNeeds(next));
  }

  takeFromHand(player.hand, [move.card]);
  next.discard.push(card);
  next.lastDiscarder = next.turn;
  if (isWild(card)) next.frozen = true;
  next.log.push({
    turn: next.turn,
    move: { type: 'discard', card: label(card), froze: isWild(card) },
  });

  if (goingOut) return endHand(next, player.id);

  next.turn = (next.turn + 1) % next.players.length;
  next.phase = 'draw';
  next.tookPileThisTurn = false;
  next.meldedThisTurn = false;
  next.openedThisTurn = false;
  next.permission = null;
  return next;
}

// ---------------------------------------------------------------- scoring

// Red threes are worth 100 apiece and 800 for the set -- but they count
// against a partnership that never got a meld down.
export function redThreeScore(state, team) {
  const n = team.redThrees.length;
  if (n === 0) return 0;
  const value = n === 4 ? state.config.allRedThreesValue : n * state.config.redThreeValue;
  return team.hasMelded ? value : -value;
}

// Which canasta to break to settle a debt. The one a player would reach for:
// the cheapest that covers what is owed, and failing that the dearest, since
// breaking a canasta forfeits its whole bonus however little of it was needed.
function canastaToBreak(bonuses, debt) {
  const covering = bonuses.filter((b) => b >= debt);
  return covering.length ? Math.min(...covering) : Math.max(...bonuses);
}

// What a side caught with cards in hand actually pays.
//
// The debt eats the cards on the table first, then whole canasta bonuses one
// at a time, then red threes, and whatever is still owed after all that comes
// off the score and takes it negative. Nothing is ever forgiven.
//
// Which means the whole cost is the cards in hand plus one thing: a canasta
// broken to cover five points forfeits all five hundred of itself, and the
// four hundred and ninety-five nobody needed is the overshoot. Paying out of
// the table and then going negative is otherwise just subtraction.
function settleDebt(team, owed, { melded }) {
  let debt = owed - Math.min(owed, Math.max(melded, 0));
  const purses = teamCanastas(team).map(canastaBonus);
  const broken = [];
  let overshoot = 0;

  while (debt > 0 && purses.length) {
    const bonus = canastaToBreak(purses, debt);
    purses.splice(purses.indexOf(bonus), 1);
    broken.push(bonus);
    overshoot += Math.max(0, bonus - debt);
    debt = Math.max(0, debt - bonus);
  }

  return { paid: owed + overshoot, broken: broken.length };
}

export function scoreTeam(state, team, { wentOut, concealed, caught = false }) {
  const melded = meldedValue(team);
  const bonuses = teamMelds(team).reduce((n, m) => n + canastaBonus(m), 0);
  const reds = redThreeScore(state, team);
  const inHand = state.players
    .filter((p) => p.team === team.id)
    .reduce((n, p) => n + p.hand.reduce((s, c) => s + cardValue(c), 0), 0);
  const out = wentOut ? (concealed ? state.config.concealedBonus : state.config.goOutBonus) : 0;

  // The side that got caught pays out of what is on the table. Everybody else
  // simply has their leftovers deducted.
  const { paid, broken } = caught
    ? settleDebt(team, inHand, { melded })
    : { paid: inHand, broken: 0 };

  return {
    melded, bonuses, redThrees: reds, goOut: out,
    inHand: -inHand,      // what they were holding
    cost: -paid,          // what holding it actually cost them
    broken, caught,
    total: melded + bonuses + reds + out - paid,
  };
}

function endHand(next, outPlayerId) {
  next.handOver = true;
  next.outPlayer = outPlayerId;

  const outTeam = outPlayerId === null ? null : teamIndexOf(outPlayerId);
  // Concealed: the partnership had nothing down before this turn and its whole
  // hand went out in it. Counting meld entries in the log would have counted
  // the opponents' melds too.
  const concealed = outPlayerId !== null && next.openedThisTurn;

  next.lastHandScores = next.teams.map((team) => scoreTeam(next, team, {
    wentOut: team.id === outTeam,
    concealed: concealed && team.id === outTeam,
    // Somebody going out catches the other side. The stock running dry catches
    // everybody, since nobody got their cards down in time.
    caught: outTeam === null || team.id !== outTeam,
  }));

  // Logged after the scoring, so the board can say who went out, who was
  // caught with what, and whose canasta had to be broken to pay for it.
  next.log.push({
    turn: outPlayerId,
    move: {
      type: 'handOver',
      out: outPlayerId,
      broken: next.lastHandScores.map((s) => s.broken),
      caught: next.lastHandScores.map((s) => -s.inHand),
    },
  });

  next.teams.forEach((team, i) => {
    team.score += next.lastHandScores[i].total;
    team.minimum = initialMeldMinimum(team.score);
  });

  next.gameOver = next.teams.some((t) => t.score >= next.config.targetScore);
  return next;
}
