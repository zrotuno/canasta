// Board UI for Rotuno Spite and Malice.
//
// Tap to select a card, tap again to place it. Taps beat drag-and-drop on a
// phone and cost nothing on a desktop, and the engine is the only authority on
// what is legal -- this file never decides a rule for itself.

import {
  createGame, applyMove, getLegalMoves, forcedPlayIndices, currentPlayer,
} from '../engine/game.js';
import { label, isWild } from '../engine/cards.js';

const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣', X: '★' };
const RED = new Set(['H', 'D']);

let state = null;
let selected = null;    // { zone, index } of the card being moved
let message = '';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- rendering

function cardEl(card, { faceDown = false, forced = false, selectable = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card';
  if (faceDown) {
    el.classList.add('back');
    return el;
  }
  if (RED.has(card.suit)) el.classList.add('red');
  if (isWild(card)) el.classList.add('wild');
  if (forced) el.classList.add('forced');
  if (selectable) el.classList.add('selectable');

  const text = label(card);
  el.innerHTML =
    `<span class="rank">${card.rank === 0 ? 'JKR' : text.replace(/[SHDCX]$/, '')}</span>` +
    `<span class="suit">${SUIT[card.suit] ?? ''}</span>`;
  el.title = text;
  return el;
}

function emptySlot(hint = '') {
  const el = document.createElement('div');
  el.className = 'card slot';
  el.innerHTML = `<span class="slot-hint">${hint}</span>`;
  return el;
}

function topOf(pile) {
  return pile.length ? pile[pile.length - 1] : null;
}

// Which destinations the currently selected card may legally reach.
function targetsForSelection() {
  if (!selected) return { builds: new Set(), discards: new Set() };
  const legal = getLegalMoves(state)
    .filter((m) => (m.type === 'play'
      ? m.from === selected.zone && m.index === selected.index
      : selected.zone === 'hand' && m.index === selected.index));

  return {
    builds: new Set(legal.filter((m) => m.type === 'play').map((m) => m.to)),
    discards: new Set(legal.filter((m) => m.type === 'discard').map((m) => m.to)),
  };
}

function render() {
  const me = currentPlayer(state);
  const them = state.players[(state.turn + 1) % state.players.length];
  const forced = new Set(forcedPlayIndices(state, me));
  const targets = targetsForSelection();

  // --- opponent -----------------------------------------------------------
  $('opp-name').textContent = them.name;
  $('opp-counts').textContent = `${them.payoff.length} in payoff · ${them.hand.length} in hand`;

  const oppPayoff = $('opp-payoff');
  oppPayoff.replaceChildren(
    topOf(them.payoff) ? cardEl(topOf(them.payoff)) : emptySlot('empty')
  );

  const oppDiscards = $('opp-discards');
  oppDiscards.replaceChildren(...them.discards.map((pile) => {
    const top = topOf(pile);
    return top ? cardEl(top) : emptySlot();
  }));

  // --- build piles --------------------------------------------------------
  const builds = $('builds');
  builds.replaceChildren(...state.build.map((pile, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'pile';
    if (targets.builds.has(i)) wrap.classList.add('target');
    wrap.dataset.build = String(i);

    const top = topOf(pile);
    wrap.append(top ? cardEl(top) : emptySlot('A'));

    const caption = document.createElement('span');
    caption.className = 'caption';
    caption.textContent = pile.length ? `${pile.length}/12` : 'needs ace';
    wrap.append(caption);
    return wrap;
  }));

  // --- your side ----------------------------------------------------------
  $('you-name').textContent = `${me.name} — your turn`;
  $('payoff-count').textContent = `${me.payoff.length} left`;

  const payoff = $('payoff');
  payoff.replaceChildren();
  const payoffTop = topOf(me.payoff);
  if (payoffTop) {
    const el = cardEl(payoffTop, { selectable: true });
    if (selected?.zone === 'payoff') el.classList.add('selected');
    el.dataset.source = 'payoff';
    el.dataset.index = '0';
    payoff.append(el);
  } else {
    payoff.append(emptySlot('done'));
  }

  const hand = $('hand');
  hand.replaceChildren(...me.hand.map((card, i) => {
    const el = cardEl(card, { forced: forced.has(i), selectable: true });
    if (selected?.zone === 'hand' && selected.index === i) el.classList.add('selected');
    el.dataset.source = 'hand';
    el.dataset.index = String(i);
    return el;
  }));

  const discards = $('discards');
  discards.replaceChildren(...me.discards.map((pile, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'pile';
    if (targets.discards.has(i)) wrap.classList.add('target');
    wrap.dataset.discard = String(i);

    const top = topOf(pile);
    const el = top ? cardEl(top, { selectable: true }) : emptySlot();
    if (top) {
      el.dataset.source = 'discard';
      el.dataset.index = String(i);
      if (selected?.zone === 'discard' && selected.index === i) el.classList.add('selected');
    }
    wrap.append(el);

    const caption = document.createElement('span');
    caption.className = 'caption';
    caption.textContent = pile.length ? `${pile.length}` : 'discard';
    wrap.append(caption);
    return wrap;
  }));

  $('draw-count').textContent = `${state.draw.length} in draw`;

  // --- prompt -------------------------------------------------------------
  let hint = message;
  if (!hint) {
    if (forced.size) {
      hint = `You are holding ${forced.size > 1 ? 'cards' : 'a card'} that must be played — `
           + 'no discarding until it is down.';
    } else if (selected) {
      const count = targets.builds.size + targets.discards.size;
      hint = count ? 'Tap a highlighted pile to place it.' : 'That card has nowhere to go. Pick another.';
    } else {
      hint = 'Tap a card to pick it up. Discarding ends your turn.';
    }
  }
  $('hint').textContent = hint;
  message = '';
}

// ---------------------------------------------------------------- actions

function show(screen) {
  for (const id of ['title', 'board', 'pass', 'win']) $(id).hidden = (id !== screen);
}

function attempt(move) {
  try {
    state = applyMove(state, move);
    selected = null;
    return true;
  } catch (err) {
    message = err.message;
    selected = null;
    return false;
  }
}

function onSelect(event) {
  const cardNode = event.target.closest('[data-source]');
  const buildNode = event.target.closest('[data-build]');
  const discardNode = event.target.closest('[data-discard]');

  // Placing a selected card takes priority over picking a new one up.
  if (selected && buildNode) {
    attempt({ type: 'play', from: selected.zone, index: selected.index, to: Number(buildNode.dataset.build) });
    return finishTurnOrRender();
  }
  if (selected && discardNode && selected.zone === 'hand') {
    const ended = attempt({ type: 'discard', index: selected.index, to: Number(discardNode.dataset.discard) });
    return finishTurnOrRender(ended);
  }

  if (cardNode) {
    const zone = cardNode.dataset.source;
    const index = Number(cardNode.dataset.index);
    selected = (selected && selected.zone === zone && selected.index === index)
      ? null                      // tapping the selected card puts it back down
      : { zone, index };
  }
  render();
}

function finishTurnOrRender(turnEnded = false) {
  if (state.winner !== null) {
    $('win-text').textContent = `${state.players[state.winner].name} emptied the payoff pile.`;
    show('win');
    return;
  }
  if (turnEnded) {
    // Hot-seat: hide the board until the next player has the device.
    $('pass-text').textContent = `Hand over to ${currentPlayer(state).name}`;
    show('pass');
    return;
  }
  render();
}

function newGame() {
  const fast = $('fast-wilds').checked;
  const names = [$('p1').value.trim() || 'Player 1', $('p2').value.trim() || 'Player 2'];
  state = createGame({ players: names, config: { wildsAsLowRanks: fast } });
  selected = null;
  message = '';
  show('board');
  render();
}

export function boot() {
  $('start').addEventListener('click', newGame);
  $('again').addEventListener('click', () => show('title'));
  $('continue').addEventListener('click', () => { show('board'); render(); });
  $('board').addEventListener('click', onSelect);
  show('title');
}
