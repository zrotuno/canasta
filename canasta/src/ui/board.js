// Canasta board: four players, four phones, one table.
//
// Cards are tapped to select. Selected cards are grouped into melds in a
// staging tray before being laid down together, because an opening meld often
// has to reach its minimum across two or three melds at once — the engine
// takes them as a single move, so the UI builds that move up visibly.
//
// Nothing here owns the game. The game is a seed and a list of moves in
// Firestore; this rebuilds it on every change and sends moves back. A move is
// checked against the engine locally first, so an illegal one is refused
// instantly rather than after a round trip.

import { applyMove, canTakePile, pileBlockedReason, topDiscard,
         teamIndexOf, teamCanastas, meldedValue, mustTakePile } from '../engine/game.js';
import { label, isWild, isRed, cardValue, JOKER } from '../engine/cards.js';
import { isCanasta } from '../engine/melds.js';
import { rebuild, NEW_HAND } from '../net/replay.js';
import { chooseSafeMove } from '../ai/player.js';
import { tauntForMove, tauntForHandEnd } from './taunts.js';
import * as net from '../net/room.js';

const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣', X: '★' };
const RANK_NAME = { 1: 'Aces', 11: 'Jacks', 12: 'Queens', 13: 'Kings', B3: 'Black threes' };

let game = null;
let selected = new Set();
let staged = [];            // { to, ids }
let message = '';
let isError = false;

let code = null;            // the table this browser is at
let doc = null;             // the raw Firestore document, as last seen
let mySeat = null;          // 0..3, or null while still standing up
let sending = false;        // one move in flight at a time
let shownHand = -1;         // which hand's scores the handover screen is for

const $ = (id) => document.getElementById(id);
const stagedIds = () => new Set(staged.flatMap((g) => g.ids));

// "Me" is the seat this phone is sitting in, not whoever is to play. That one
// change is most of what separates this from a pass-the-phone game.
const seatOf = () => (mySeat === null ? game.turn : mySeat);
const me = () => game.players[seatOf()];
const myTeam = () => game.teams[teamIndexOf(seatOf())];
const cardById = (id) => me().hand.find((c) => c.id === id);

// A seat handed to the computer is still yours -- you keep watching your own
// cards, and you can take it back -- but it is not yours to play.
const iAmComputer = () => Boolean(doc && mySeat !== null && net.isComputer(doc.seats[mySeat]));
const myTurn = () => mySeat !== null && !iAmComputer()
  && game.turn === mySeat && !game.handOver;

const rankName = (rank) => RANK_NAME[rank] ?? `${rank}s`;

// ---------------------------------------------------------------- rendering

function cardEl(card, { selectable = false, isSelected = false, risky = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card';
  if (isRed(card)) el.classList.add('red');
  if (isWild(card)) el.classList.add('wild');
  if (selectable) el.classList.add('selectable');
  if (isSelected) el.classList.add('selected');
  if (risky) el.classList.add('risky');

  const text = label(card);
  el.innerHTML =
    `<span class="rank">${card.rank === JOKER ? 'JKR' : text.replace(/[SHDCX]$/, '')}</span>` +
    `<span class="suit">${SUIT[card.suit] ?? ''}</span>` +
    (risky ? '<span class="warn">&lowast;</span>' : '');
  el.title = text;
  // Only cards you could actually play carry the tap handle. The top of the
  // discard pile is drawn with this same function, and while it was tagged you
  // could select it without any sign that you had -- and then taking the pile
  // sent that card twice and failed on the second look-up.
  if (selectable) el.dataset.card = card.id;
  return el;
}

function slot(text) {
  const el = document.createElement('div');
  el.className = 'card slot';
  el.textContent = text;
  return el;
}

function meldChip(rank, cards, { droppable }) {
  const el = document.createElement('div');
  el.className = 'meld';
  if (cards.length >= 7) el.classList.add('canasta');
  if (droppable) el.classList.add('droppable');
  el.dataset.meld = rank;
  const wilds = cards.filter(isWild).length;
  el.innerHTML = `<span>${rankName(rank)}</span>` +
    `<span class="count">${cards.length}${wilds ? ` · ${wilds}w` : ''}` +
    `${cards.length >= 7 ? ' · canasta' : ''}</span>`;
  return el;
}

function renderScoreboard() {
  const board = $('scoreboard');
  board.replaceChildren(...game.teams.map((team) => {
    const names = game.players.filter((p) => p.team === team.id).map((p) => p.name).join(' & ');
    const el = document.createElement('div');
    el.className = 'score' + (team.id === teamIndexOf(game.turn) ? ' active' : '');
    el.innerHTML = `<b>${team.score}</b><span>${names}</span>` +
      `<span>${team.hasMelded ? `${meldedValue(team)} down` : `needs ${team.minimum} to open`}` +
      ` · ${teamCanastas(team).length} canasta${teamCanastas(team).length === 1 ? '' : 's'}</span>`;
    return el;
  }));
}

function renderMelds() {
  const mine = teamIndexOf(seatOf());
  const canDrop = selected.size > 0;

  for (const [containerId, teamId] of [['melds-us', mine], ['melds-them', 1 - mine]]) {
    const team = game.teams[teamId];
    const container = $(containerId);
    const entries = Object.entries(team.melds);
    const heading = document.createElement('span');
    heading.style.cssText = 'font-size:11px;color:var(--muted);align-self:center;margin-right:4px';
    heading.textContent = teamId === mine ? 'Yours:' : 'Theirs:';

    const chips = entries.map(([rank, cards]) =>
      meldChip(rank, cards, { droppable: teamId === mine && canDrop }));
    container.replaceChildren(heading, ...(chips.length ? chips : [emptyNote()]));
  }
}

function emptyNote() {
  const el = document.createElement('span');
  el.style.cssText = 'font-size:13px;color:var(--muted)';
  el.textContent = 'nothing down yet';
  return el;
}

function renderCentre() {
  $('stock-count').textContent = `${game.stock.length} in stock`;

  const top = topDiscard(game);
  $('discard-top').replaceChildren(top ? cardEl(top) : slot('—'));
  $('discard-count').textContent = `${game.discard.length} in pile`;

  const state = $('pile-state');
  const blocked = pileBlockedReason(game);
  const bits = [];
  if (game.frozen) bits.push('<span class="badge">frozen</span>');
  if (blocked) bits.push(`<div style="font-size:13px;color:var(--muted);margin-top:6px">${blocked}</div>`);
  else if (myTurn()) {
    const check = canTakePile(game);
    bits.push(`<div style="font-size:13px;color:${check.ok ? 'var(--gold)' : 'var(--muted)'};margin-top:6px">`
      + `${check.ok ? 'You can take this pile.' : check.reason}</div>`);
  }
  state.innerHTML = bits.join('');
}

// Ranks the opposition could take the pile with, holding nothing at all: they
// have that rank down and it is not yet a canasta, and the pile is not frozen.
// Throw one of these and the pile is theirs for free, which is worth seeing
// before you throw it rather than afterwards.
function ranksTheyCanUse() {
  if (game.frozen) return new Set();
  const them = game.teams[1 - teamIndexOf(seatOf())];
  return new Set(Object.entries(them.melds)
    .filter(([rank, meld]) => rank !== 'B3' && !isCanasta(meld))
    .map(([rank]) => Number(rank)));
}

function renderHand() {
  const hidden = stagedIds();
  const risky = ranksTheyCanUse();
  const cards = [...me().hand]
    .filter((c) => !hidden.has(c.id))
    .sort((a, b) => a.rank - b.rank || a.suit.localeCompare(b.suit));

  $('hand-title').textContent = `${me().name} — ${me().hand.length} cards`;
  $('hand').replaceChildren(...cards.map((c) =>
    cardEl(c, {
      selectable: true,
      isSelected: selected.has(c.id),
      risky: risky.has(c.rank),
    })));

  $('legend').hidden = !cards.some((c) => risky.has(c.rank));
}

// ------------------------------------------------------- what happened

// '7H' as the engine writes it, '7♥' as a person reads it.
function prettyCard(text) {
  if (!text) return '';
  if (text === 'JKR') return 'Joker';
  const suit = SUIT[text.slice(-1)];
  return suit ? text.slice(0, -1) + suit : text;
}

const listRanks = (ranks) => ranks.map(rankName).join(' and ');

// How the pile was won, in the words a player would use. This is the line the
// action box exists for: a frozen pile going to somebody is exactly the thing
// that starts an argument across the table.
function pileStory(move) {
  const card = prettyCard(move.top);
  switch (move.mode) {
    case 'frozen-pair': return `took the frozen pile (${move.count}) with two natural ${card}s`;
    case 'pair': return `took the pile (${move.count}) with a pair of ${card}s`;
    case 'natural-plus-wild': return `took the pile (${move.count}) with a ${card} and a wild`;
    case 'add-to-meld': return `took the pile (${move.count}) onto their ${card}s`;
    default: return `took the pile (${move.count})`;
  }
}

// Returns the actor, the sentence, and whether it deserves the eye.
function describe(entry) {
  const who = entry.turn === null || !game.players[entry.turn] ? '' : game.players[entry.turn].name;
  const m = entry.move;

  switch (m.type) {
    case 'deal':
      return { who: '', what: `Dealt — ${prettyCard(m.top)} turned up`
        + (m.frozen ? ', and the pile starts frozen' : ''), notable: m.frozen, quiet: !m.frozen };

    case 'draw': {
      const reds = m.reds
        ? `, turning ${m.reds === 1 ? 'a red three' : `${m.reds} red threes`}`
        : '';
      return { who, what: `drew ${m.cards}${reds}`, notable: Boolean(m.reds), quiet: !m.reds };
    }

    case 'takePile': {
      const reds = m.reds ? `, and ${m.reds === 1 ? 'a red three' : `${m.reds} red threes`} with it` : '';
      return { who, what: pileStory(m) + reds, notable: true };
    }

    case 'meld':
      return {
        who,
        what: m.opened
          ? `opened with ${listRanks(m.ranks)} — ${m.laid}`
          : `melded ${listRanks(m.ranks)} — ${m.laid}`,
        notable: m.opened,
      };

    case 'discard':
      return {
        who,
        what: `discarded ${prettyCard(m.card)}${m.froze ? ' — the pile is frozen' : ''}`,
        notable: m.froze,
      };

    case 'pass':
      return { who, what: 'let the pile go, and the hand with it', notable: true };

    case 'askPartner':
      return { who, what: 'asked their partner to go out', notable: true };

    case 'answerPartner':
      return { who: '', what: m.yes ? 'Partner said yes' : 'Partner said no', notable: true };

    case 'handOver':
      return m.out === null
        ? { who: '', what: 'The stock ran out. Nobody went out.', notable: true }
        : { who, what: 'went out', notable: true };

    default:
      return { who, what: m.type, quiet: true };
  }
}

// The heckler speaks about the last notable thing that happened. Its index in
// the log picks the line, so every phone at the table sees the same joke.
//
// It holds for a few seconds rather than strictly until the next action: a
// computer plays its whole turn in under a second, which left a good line on
// screen for about a quarter of one. A newer remark always displaces an older.
const TAUNT_LINGER = 6500;
let taunt = { index: -1, text: '', at: 0 };
let tauntTimer = null;

function renderTaunt() {
  const box = $('taunt');
  const entries = game.log ?? [];
  clearTimeout(tauntTimer);

  // The most recent thing worth a word, searching back over the last turn or
  // two rather than only the very last move.
  for (let i = entries.length - 1; i >= 0 && i > entries.length - 8; i--) {
    if (i <= taunt.index) break;
    const said = tauntForMove(entries[i], game, i);
    if (said) { taunt = { index: i, text: said, at: Date.now() }; break; }
  }

  const fresh = taunt.index >= 0 && Date.now() - taunt.at < TAUNT_LINGER;
  const showing = fresh && !game.handOver;

  box.hidden = !showing;
  if (showing) {
    box.textContent = taunt.text;
    tauntTimer = setTimeout(() => { if (game) renderTaunt(); }, TAUNT_LINGER - (Date.now() - taunt.at) + 50);
  }
}

// Folded or not, remembered between sessions: somebody who does not want the
// log should not have to close it every hand.
let logOpen = localStorage.getItem('canasta.log') !== 'folded';

function toggleLog() {
  logOpen = !logOpen;
  localStorage.setItem('canasta.log', logOpen ? 'open' : 'folded');
  render();
}

function renderLog() {
  const list = $('log');
  const count = $('log-count');
  const entries = game.log ?? [];

  $('log-panel').classList.toggle('folded', !logOpen);
  const toggle = $('log-toggle');
  toggle.textContent = logOpen ? 'Hide' : 'Show';
  toggle.setAttribute('aria-expanded', String(logOpen));

  count.textContent = entries.length ? `${entries.length} this hand` : '';
  // Nothing to build while it is folded away.
  if (!logOpen) return;

  if (entries.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'quiet';
    empty.textContent = 'Nothing yet.';
    list.replaceChildren(empty);
    return;
  }

  // Newest first, so what you just missed is at the top and needs no scrolling.
  list.replaceChildren(...[...entries].reverse().map((entry) => {
    const { who, what, notable, quiet } = describe(entry);
    const li = document.createElement('li');
    if (notable) li.classList.add('notable');
    if (quiet) li.classList.add('quiet');

    if (who) {
      const name = document.createElement('span');
      name.className = 'who';
      // textContent, not innerHTML: these names were typed by players.
      name.textContent = who;
      li.append(name);
    }
    const said = document.createElement('span');
    said.className = 'what';
    said.textContent = what;
    li.append(said);
    return li;
  }));
}

function renderTray() {
  const tray = $('tray');
  if (staged.length === 0) {
    tray.innerHTML = '<span style="font-size:13px;color:var(--muted)">'
      + 'Select cards, then group them.</span>';
    $('staging-title').textContent = 'Ready to lay down';
    return;
  }

  const points = staged.reduce((n, g) =>
    n + g.ids.reduce((s, id) => s + cardValue(cardById(id)), 0), 0);
  const team = myTeam();
  $('staging-title').textContent = team.hasMelded
    ? `Ready to lay down — ${points} points`
    : `Ready to lay down — ${points} of the ${team.minimum} you need to open`;

  tray.replaceChildren(...staged.map((group, i) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    const names = group.ids.map((id) => label(cardById(id))).join(' ');
    chip.innerHTML = `<span>${group.to !== null ? `→ ${rankName(group.to)}: ` : ''}${names}</span>`;
    const x = document.createElement('button');
    x.textContent = '×';
    x.dataset.unstage = String(i);
    x.title = 'Take this group back';
    chip.append(x);
    return chip;
  }));
}

function button(text, { id, className = '', disabled = false }) {
  const el = document.createElement('button');
  el.textContent = text;
  el.id = id;
  el.className = className;
  el.disabled = disabled;
  return el;
}

function renderActions() {
  const bar = $('actions');
  const team = myTeam();

  // Your partner has asked to go out and it is your call to make.
  const asked = game.permission;
  if (asked && asked.answer === null && asked.partner === mySeat && !iAmComputer()) {
    bar.replaceChildren(
      button(`${game.players[asked.asker].name} asks to go out`, { id: 'act-none', disabled: true }),
      button('Yes, go out', { id: 'act-yes', className: 'gold' }),
      button('No, wait', { id: 'act-no', className: 'primary' }),
    );
    return;
  }

  if (!myTurn()) {
    bar.replaceChildren(button(`${game.players[game.turn].name} is playing`,
      { id: 'act-none', disabled: true }));
    return;
  }

  if (game.phase === 'draw') {
    // With the stock gone the pile is the only way to keep the hand alive.
    if (game.stock.length === 0) {
      const check = canTakePile(game);
      const needsSelection = check.mode !== 'add-to-meld';
      const short = needsSelection && selected.size === 0;
      bar.replaceChildren(
        button(short ? 'Take the pile (select cards first)' : 'Take the pile',
          { id: 'act-take', className: 'gold', disabled: !check.ok || short }),
        button('Group selected', { id: 'act-group', disabled: selected.size === 0 }),
        button('End the hand', { id: 'act-pass', className: 'primary', disabled: mustTakePile(game) }),
      );
      return;
    }
    const check = canTakePile(game);
    // Adding the top card to a meld your side already has needs nothing from
    // hand, so only the other routes require a selection.
    const needsSelection = check.mode !== 'add-to-meld';
    const short = needsSelection && selected.size === 0;
    bar.replaceChildren(
      button(game.config.drawCount === 1 ? 'Draw a card' : `Draw ${game.config.drawCount} cards`,
        { id: 'act-draw', className: 'primary', disabled: staged.length > 0 }),
      // Opening on the pile often needs a second meld alongside it to reach
      // the minimum, so groups can be stacked up before taking.
      button('Group selected', { id: 'act-group', disabled: selected.size === 0 }),
      button('Take back', { id: 'act-clear', disabled: staged.length === 0 }),
      button(short ? 'Take the pile (select cards first)' : 'Take the pile',
        { id: 'act-take', className: 'gold', disabled: !check.ok || short }),
    );
    return;
  }

  const openingShort = !team.hasMelded && staged.length > 0
    && staged.reduce((n, g) => n + g.ids.reduce((s, id) => s + cardValue(cardById(id)), 0), 0) < team.minimum;

  const actions = [
    button('Group selected', { id: 'act-group', disabled: selected.size === 0 }),
    button('Lay down', { id: 'act-lay', className: 'gold', disabled: staged.length === 0 || openingShort }),
    button('Take back', { id: 'act-clear', disabled: staged.length === 0 }),
    button('Discard', { id: 'act-discard', className: 'primary', disabled: selected.size !== 1 || staged.length > 0 }),
  ];

  // Asking is optional and the answer binds you, so it is only offered while
  // there is still an answer to get.
  if (!game.permission) {
    actions.push(button('May I go out?', { id: 'act-ask' }));
  } else if (game.permission.answer) {
    const yes = game.permission.answer === 'yes';
    actions.push(button(yes ? 'Partner said yes' : 'Partner said no',
      { id: 'act-none', disabled: true }));
  }

  bar.replaceChildren(...actions);
}

function renderHint() {
  const hint = $('hint');
  hint.classList.toggle('error', isError);

  if (message) { hint.textContent = message; message = ''; isError = false; return; }

  const waiting = game.permission && game.permission.answer === null;
  if (waiting && game.permission.partner === mySeat) {
    hint.textContent = `${game.players[game.permission.asker].name} wants to go out. `
      + 'Say no if you are holding cards that would count against you.';
    return;
  }
  if (!myTurn()) {
    hint.textContent = waiting
      ? `${game.players[game.permission.asker].name} is waiting on an answer from their partner.`
      : `Waiting for ${game.players[game.turn].name} to play.`;
    return;
  }

  if (game.phase === 'draw' && game.stock.length === 0) {
    hint.textContent = 'The stock is gone. Take the pile if you can use the top card, '
      + 'otherwise the hand ends here.';
  } else if (game.phase === 'draw') {
    hint.textContent = `Take ${game.config.drawCount} from the stock, or take the whole `
      + 'discard pile if you can use the top card straight away.';
  } else if (staged.length) {
    hint.textContent = 'Tap one of your melds to add the selected cards to it, or lay down what you have.';
  } else {
    hint.textContent = 'Meld what you can, then discard one card to end your turn.';
  }
}

function renderSeatSwap() {
  const btn = $('seat-swap');
  if (mySeat === null || !doc) { btn.hidden = true; return; }
  btn.hidden = false;
  btn.textContent = iAmComputer() ? 'Take my hand back' : 'Let the computer play';
}

function render() {
  renderSeatSwap();
  renderScoreboard();
  renderMelds();
  renderCentre();
  renderTaunt();
  renderLog();
  renderHand();
  renderTray();
  renderActions();
  renderHint();
}

// ---------------------------------------------------------------- screens

function show(screen) {
  for (const id of ['title', 'lobby', 'board', 'handover', 'gameover']) $(id).hidden = (id !== screen);
}

// ---------------------------------------------------------------- lobby

const savedName = () => localStorage.getItem('canasta.name') ?? '';

function seatLabel(seat, mine) {
  if (!seat) return 'Empty · sit here';
  if (net.isComputer(seat)) return `${seat.name} · computer`;
  return seat.name + (mine ? ' — you' : '');
}

// An occupied seat is one button. An empty one is that button plus the offer
// of a computer, so filling the table never waits on a fourth person.
function seatCell(i) {
  const seat = doc.seats[i];
  const mine = net.isHuman(seat) && seat.id === net.myId();

  const cell = document.createElement('div');
  cell.className = 'seat-cell';

  const el = document.createElement('button');
  el.className = 'seat';
  if (seat) el.classList.add('taken');
  if (mine) el.classList.add('mine');
  if (net.isComputer(seat)) el.classList.add('robot');
  // A computer's chair is always free for a person to take.
  el.disabled = net.isHuman(seat) && !mine;
  el.dataset.seat = i;
  el.innerHTML = `<span class="where">${net.SEAT_NAMES[i]}</span>`
    + `<span class="who">${seatLabel(seat, mine)}</span>`;
  cell.append(el);

  if (!seat) {
    const add = document.createElement('button');
    add.className = 'add-npc';
    add.dataset.npc = i;
    add.textContent = '+ let a computer play here';
    cell.append(add);
  }
  return cell;
}

function renderLobby() {
  $('lobby-code').textContent = code;
  $('seats-0').replaceChildren(seatCell(0), seatCell(2));
  $('seats-1').replaceChildren(seatCell(1), seatCell(3));

  const filled = doc.seats.filter(Boolean).length;
  const deal = $('deal');
  deal.disabled = filled < 4;
  deal.textContent = filled < 4 ? `Four seats to fill — ${filled} taken` : 'Deal the first hand';
  show('lobby');
}

// ------------------------------------------------- the computer players
//
// Nobody hosts them. Every phone works out what a computer seat should do and
// races to write it, and the append transaction means exactly one of those
// writes lands while the others fall away. So the computers keep playing even
// if whoever added them puts their phone in a pocket and leaves the room.

const THINKING_MS = 900;
let thinking = null;

const seatIsComputer = (i) => Boolean(doc && net.isComputer(doc.seats[i]));

function computerToPlay() {
  if (!game || game.handOver || game.gameOver || !doc || !doc.started) return null;
  const asked = game.permission;
  if (asked && asked.answer === null && seatIsComputer(asked.partner)) return asked.partner;
  return seatIsComputer(game.turn) ? game.turn : null;
}

// A pause long enough to read as thought, plus a place in the queue so four
// phones do not all lunge at the same move.
//
// The pause belongs at the start of a turn, not before every move in it. A
// person thinks about what to draw, then melds and discards in one motion, and
// pausing three times over made the computers feel like they were buffering.
function politeDelay() {
  const humans = doc.seats.map((s, i) => (net.isHuman(s) ? i : -1)).filter((i) => i >= 0);
  const place = humans.indexOf(mySeat);
  const queue = (place < 0 ? humans.length : place) * 300;
  const startingTurn = game.phase === 'draw';
  return (startingTurn ? THINKING_MS : 250) + queue;
}

function driveComputers() {
  clearTimeout(thinking);
  const seat = computerToPlay();
  if (seat === null) return;
  thinking = setTimeout(() => playComputer(seat), politeDelay());
}

async function playComputer(seat) {
  if (sending || computerToPlay() !== seat) return;
  const move = chooseSafeMove(game, seat);
  if (!move) return;
  try {
    await net.sendMove(code, { ...move, by: seat }, doc.moves.length);
  } catch {
    // Another phone got there first. That is the design, not a failure.
  }
}

function scoreRows(table, scores) {
  // `cost` rather than `inHand`: a side caught by somebody going out pays for
  // its leftovers out of the table, and a canasta broken to cover ninety
  // points costs all five hundred of itself. What it cost is the honest
  // number, and the row says how much was in the hand that cost it.
  const held = scores.map((s) => -s.inHand);
  const rows = [
    ['Cards melded', 'melded'], ['Canasta bonuses', 'bonuses'],
    ['Red threes', 'redThrees'], ['Going out', 'goOut'],
    [`Left in hand (${held[0]} · ${held[1]})`, 'cost'],
  ];
  if (scores.some((s) => s.broken)) rows.push(['Canastas broken', 'broken']);
  const names = game.teams.map((t) =>
    game.players.filter((p) => p.team === t.id).map((p) => p.name).join(' & '));

  table.innerHTML =
    `<tr><th></th><th>${names[0]}</th><th>${names[1]}</th></tr>` +
    rows.map(([caption, key]) =>
      `<tr><td>${caption}</td><td>${scores[0][key]}</td><td>${scores[1][key]}</td></tr>`).join('') +
    `<tr class="total"><td>Hand total</td><td>${scores[0].total}</td><td>${scores[1].total}</td></tr>` +
    `<tr class="total"><td>Game score</td><td>${game.teams[0].score}</td><td>${game.teams[1].score}</td></tr>`;
}

// ---------------------------------------------------------------- syncing

// Everything the table does arrives here: the document changed, so rebuild the
// game from it and put the right screen up. This is the only place `game` is
// ever assigned, which is what keeps four phones telling the same story.
function onRoom(latest) {
  clearTimeout(thinking);
  doc = latest;
  const seat = latest.seats.findIndex((s) => s && s.id === net.myId());
  mySeat = seat < 0 ? null : seat;

  const { state, hand, error } = rebuild(latest);
  game = state;
  if (error) { message = error; isError = true; }

  if (!latest.started) return renderLobby();

  // A fresh hand clears anything left staged from the last one.
  if (hand !== shownHand) {
    shownHand = hand;
    selected = new Set();
    staged = [];
    taunt = { index: -1, text: '', at: 0 };
  }

  if (game.gameOver) {
    const winner = game.teams[0].score >= game.teams[1].score ? 0 : 1;
    const names = game.players.filter((p) => p.team === winner).map((p) => p.name).join(' & ');
    $('winner-text').textContent = `${names} win`;
    scoreRows($('final-scores'), game.lastHandScores);
    return show('gameover');
  }
  if (game.handOver) {
    const out = game.outPlayer === null ? 'The stock ran out' : `${game.players[game.outPlayer].name} went out`;
    $('handover-title').textContent = out;
    const last = game.log[game.log.length - 1];
    $('verdict').textContent = (last && last.move.type === 'handOver')
      ? (tauntForHandEnd(last, game, game.log.length - 1) ?? '')
      : '';
    scoreRows($('hand-scores'), game.lastHandScores);
    return show('handover');
  }

  show('board');
  render();
  driveComputers();
}

// ---------------------------------------------------------------- actions

// Checks the move against the engine before it goes anywhere, so a mistake is
// refused in the engine's own words and without a round trip, then appends it
// to the log. The board does not change until the change comes back down.
async function send(raw) {
  if (sending) return;
  // Every move carries the seat that made it, so the engine can refuse one
  // that arrives out of turn.
  const move = mySeat === null ? raw : { ...raw, by: mySeat };
  try {
    // Dealing the next hand is a marker in the log, not something the engine
    // knows how to apply, so there is nothing to check it against.
    if (move.type !== NEW_HAND) applyMove(game, move);
  } catch (err) {
    message = err.message;
    isError = true;
    return render();
  }

  sending = true;
  try {
    await net.sendMove(code, move, doc.moves.length);
    selected = new Set();
    staged = [];
  } catch (err) {
    // Logged as well as shown: a write refused by the database says only
    // "missing or insufficient permissions", and the console is where that
    // can be told apart from an ordinary illegal move.
    console.error('move refused', move, err);
    message = err.message;
    isError = true;
    render();
  } finally {
    sending = false;
  }
}

function onBoardClick(event) {
  const cardNode = event.target.closest('[data-card]');
  const meldNode = event.target.closest('[data-meld]');
  const unstage = event.target.closest('[data-unstage]');

  if (unstage) {
    staged.splice(Number(unstage.dataset.unstage), 1);
    return render();
  }

  // Tapping one of your own melds sends the selection to it.
  if (meldNode && selected.size > 0) {
    const rank = meldNode.dataset.meld;
    const mine = myTeam().melds[rank];
    if (!mine) { message = 'That meld belongs to the other side.'; isError = true; return render(); }
    staged.push({ to: rank === 'B3' ? 'B3' : Number(rank), ids: [...selected] });
    selected = new Set();
    return render();
  }

  if (cardNode) {
    const id = cardNode.dataset.card;
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    return render();
  }
}

function onAction(event) {
  const id = event.target.id;
  if (!id?.startsWith('act-') || id === 'act-none') return;

  switch (id) {
    case 'act-draw': return send({ type: 'draw' });
    case 'act-pass': return send({ type: 'pass' });
    case 'act-ask': return send({ type: 'askPartner' });
    case 'act-yes': return send({ type: 'answerPartner', yes: true });
    case 'act-no': return send({ type: 'answerPartner', yes: false });

    case 'act-take': {
      // The top card is melded with the selection as one group. With nothing
      // selected it must be joining a meld already on the table, so name it.
      // Any groups already staged go down in the same move, which is what
      // lets an opening meld reach its minimum on the way in.
      const top = topDiscard(game);
      // Belt and braces after the above: whatever is selected, only cards
      // genuinely in hand go into the move, and the top card goes in once.
      const held = new Set(me().hand.map((c) => c.id));
      const fromHand = [...selected].filter((id) => held.has(id) && id !== top.id);
      const topGroup = fromHand.length === 0
        ? { to: top.rank, cards: [top.id] }
        : [...fromHand, top.id];
      const groups = [...staged.map((g) => ({ to: g.to, cards: g.ids })), topGroup];
      return send({ type: 'takePile', groups });
    }

    case 'act-group':
      staged.push({ to: null, ids: [...selected] });
      selected = new Set();
      return render();

    case 'act-clear':
      staged = [];
      return render();

    case 'act-lay':
      return send({ type: 'meld', groups: staged.map((g) => ({ to: g.to, cards: g.ids })) });

    case 'act-discard': {
      const [card] = [...selected];
      return send({ type: 'discard', card });
    }
  }
}

// ---------------------------------------------------------------- joining

function fail(id, text) {
  const el = $(id);
  el.textContent = text;
  el.classList.add('bad');
}

// Starts listening to a table. Every later change to the board comes from
// onRoom, never from here.
function watch(joined) {
  code = joined;
  location.hash = joined;
  net.watchRoom(joined, onRoom, (err) => fail('title-error', err.message));
}

async function onCreate() {
  const name = $('my-name').value.trim();
  if (!name) return fail('title-error', 'Put your name in first.');
  localStorage.setItem('canasta.name', name);
  try {
    const made = await net.createRoom();
    await net.claimSeat(made, 0, name);
    watch(made);
  } catch (err) {
    fail('title-error', `Could not reach the table: ${err.message}`);
  }
}

async function onJoin() {
  const name = $('my-name').value.trim();
  const wanted = $('join-code').value.trim().toUpperCase();
  if (!name) return fail('title-error', 'Put your name in first.');
  if (wanted.length !== 4) return fail('title-error', 'A table code is four letters.');
  localStorage.setItem('canasta.name', name);

  try {
    if (!(await net.roomExists(wanted))) return fail('title-error', `There is no table called ${wanted}.`);
    watch(wanted);
  } catch (err) {
    fail('title-error', `Could not reach the table: ${err.message}`);
  }
}

async function onSeatClick(event) {
  const add = event.target.closest('[data-npc]');
  if (add) {
    try {
      await net.addComputer(code, Number(add.dataset.npc));
      $('lobby-error').textContent = '';
    } catch (err) {
      fail('lobby-error', err.message);
    }
    return;
  }

  const node = event.target.closest('[data-seat]');
  if (!node) return;
  const seat = Number(node.dataset.seat);
  try {
    await net.claimSeat(code, seat, savedName() || net.SEAT_NAMES[seat]);
    $('lobby-error').textContent = '';
  } catch (err) {
    fail('lobby-error', err.message);
  }
}

// Handing your hand to the computer, and taking it back again.
async function onSeatSwap() {
  if (mySeat === null) return;
  try {
    if (iAmComputer()) await net.claimSeat(code, mySeat, savedName() || net.SEAT_NAMES[mySeat]);
    else await net.handToComputer(code);
  } catch (err) {
    message = err.message;
    isError = true;
    render();
  }
}

export function boot() {
  $('my-name').value = savedName();
  $('create').addEventListener('click', onCreate);
  $('join').addEventListener('click', onJoin);
  $('seats-0').addEventListener('click', onSeatClick);
  $('seats-1').addEventListener('click', onSeatClick);
  $('deal').addEventListener('click', () =>
    net.startGame(code).catch((err) => fail('lobby-error', err.message)));
  $('next-hand').addEventListener('click', () => send({ type: NEW_HAND }));
  $('new-game').addEventListener('click', () =>
    net.restart(code).catch((err) => fail('lobby-error', err.message)));
  $('seat-swap').addEventListener('click', onSeatSwap);
  $('log-toggle').addEventListener('click', toggleLog);
  $('board').addEventListener('click', onBoardClick);
  $('actions').addEventListener('click', onAction);

  // Following a shared link fills the code in, so joining is name-then-tap.
  const fromLink = location.hash.replace('#', '').toUpperCase();
  if (/^[A-Z]{4}$/.test(fromLink)) $('join-code').value = fromLink;

  show('title');

  // A phone that locked, or a tab that reloaded itself, comes straight back to
  // the table it was already at. The seat is held by the stored player id, so
  // there is nothing to type and nothing to lose.
  if (/^[A-Z]{4}$/.test(fromLink) && savedName()) onJoin();

  // Tapping a shared link while the game is already open changes the address
  // without reloading anything, so the table has to be picked up by hand.
  // Ignored when the change is this page announcing the table it just joined.
  addEventListener('hashchange', () => {
    const wanted = location.hash.replace('#', '').toUpperCase();
    if (!/^[A-Z]{4}$/.test(wanted) || wanted === code) return;
    location.reload();
  });

  // Local development aid: lets a test driver read the game the board is
  // showing, and drive a seat without tapping. Never exposed off this machine.
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    window.__canasta = {
      state: () => game,
      staged: () => staged,
      seat: () => mySeat,
      code: () => code,
      send,
      sit: (i, name) => net.claimSeat(code, i, name),
      watch,
    };
  }
}
