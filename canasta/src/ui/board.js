// Canasta board: four players sharing one phone.
//
// Cards are tapped to select. Selected cards are grouped into melds in a
// staging tray before being laid down together, because an opening meld often
// has to reach its minimum across two or three melds at once — the engine
// takes them as a single move, so the UI builds that move up visibly.

import { createGame, applyMove, canTakePile, pileBlockedReason, topDiscard,
         teamIndexOf, teamCanastas, meldedValue } from '../engine/game.js';
import { label, isWild, isRed, cardValue, JOKER } from '../engine/cards.js';

const SUIT = { S: '♠', H: '♥', D: '♦', C: '♣', X: '★' };
const RANK_NAME = { 1: 'Aces', 11: 'Jacks', 12: 'Queens', 13: 'Kings', B3: 'Black threes' };

let game = null;
let selected = new Set();
let staged = [];            // { to, ids }
let message = '';
let isError = false;
let handNumber = 0;

const $ = (id) => document.getElementById(id);
const stagedIds = () => new Set(staged.flatMap((g) => g.ids));
const me = () => game.players[game.turn];
const myTeam = () => game.teams[teamIndexOf(game.turn)];
const cardById = (id) => me().hand.find((c) => c.id === id);

const rankName = (rank) => RANK_NAME[rank] ?? `${rank}s`;

// ---------------------------------------------------------------- rendering

function cardEl(card, { selectable = false, isSelected = false } = {}) {
  const el = document.createElement('div');
  el.className = 'card';
  if (isRed(card)) el.classList.add('red');
  if (isWild(card)) el.classList.add('wild');
  if (selectable) el.classList.add('selectable');
  if (isSelected) el.classList.add('selected');

  const text = label(card);
  el.innerHTML =
    `<span class="rank">${card.rank === JOKER ? 'JKR' : text.replace(/[SHDCX]$/, '')}</span>` +
    `<span class="suit">${SUIT[card.suit] ?? ''}</span>`;
  el.title = text;
  el.dataset.card = card.id;
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
  const mine = teamIndexOf(game.turn);
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
  else {
    const check = canTakePile(game);
    bits.push(`<div style="font-size:13px;color:${check.ok ? 'var(--gold)' : 'var(--muted)'};margin-top:6px">`
      + `${check.ok ? 'You can take this pile.' : check.reason}</div>`);
  }
  state.innerHTML = bits.join('');
}

function renderHand() {
  const hidden = stagedIds();
  const cards = [...me().hand]
    .filter((c) => !hidden.has(c.id))
    .sort((a, b) => a.rank - b.rank || a.suit.localeCompare(b.suit));

  $('hand-title').textContent = `${me().name} — ${me().hand.length} cards`;
  $('hand').replaceChildren(...cards.map((c) =>
    cardEl(c, { selectable: true, isSelected: selected.has(c.id) })));
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

  if (game.phase === 'draw') {
    const check = canTakePile(game);
    bar.replaceChildren(
      button('Draw a card', { id: 'act-draw', className: 'primary' }),
      button(selected.size ? 'Take the pile' : 'Take the pile (select cards first)',
        { id: 'act-take', className: 'gold', disabled: !check.ok || selected.size === 0 }),
    );
    return;
  }

  const openingShort = !team.hasMelded && staged.length > 0
    && staged.reduce((n, g) => n + g.ids.reduce((s, id) => s + cardValue(cardById(id)), 0), 0) < team.minimum;

  bar.replaceChildren(
    button('Group selected', { id: 'act-group', disabled: selected.size === 0 }),
    button('Lay down', { id: 'act-lay', className: 'gold', disabled: staged.length === 0 || openingShort }),
    button('Take back', { id: 'act-clear', disabled: staged.length === 0 }),
    button('Discard', { id: 'act-discard', className: 'primary', disabled: selected.size !== 1 || staged.length > 0 }),
  );
}

function renderHint() {
  const hint = $('hint');
  hint.classList.toggle('error', isError);

  if (message) { hint.textContent = message; message = ''; isError = false; return; }

  if (game.phase === 'draw') {
    hint.textContent = 'Draw from the stock, or take the whole discard pile if you can '
      + 'use the top card straight away.';
  } else if (staged.length) {
    hint.textContent = 'Tap one of your melds to add the selected cards to it, or lay down what you have.';
  } else {
    hint.textContent = 'Meld what you can, then discard one card to end your turn.';
  }
}

function render() {
  renderScoreboard();
  renderMelds();
  renderCentre();
  renderHand();
  renderTray();
  renderActions();
  renderHint();
}

// ---------------------------------------------------------------- screens

function show(screen) {
  for (const id of ['title', 'pass', 'board', 'handover', 'gameover']) $(id).hidden = (id !== screen);
}

function toPass() {
  selected = new Set();
  staged = [];
  $('pass-text').textContent = `Pass the phone to ${me().name}`;
  show('pass');
}

function scoreRows(table, scores) {
  const rows = [
    ['Cards melded', 'melded'], ['Canasta bonuses', 'bonuses'],
    ['Red threes', 'redThrees'], ['Going out', 'goOut'], ['Left in hand', 'inHand'],
  ];
  const names = game.teams.map((t) =>
    game.players.filter((p) => p.team === t.id).map((p) => p.name).join(' & '));

  table.innerHTML =
    `<tr><th></th><th>${names[0]}</th><th>${names[1]}</th></tr>` +
    rows.map(([caption, key]) =>
      `<tr><td>${caption}</td><td>${scores[0][key]}</td><td>${scores[1][key]}</td></tr>`).join('') +
    `<tr class="total"><td>Hand total</td><td>${scores[0].total}</td><td>${scores[1].total}</td></tr>` +
    `<tr class="total"><td>Game score</td><td>${game.teams[0].score}</td><td>${game.teams[1].score}</td></tr>`;
}

function afterMove() {
  if (game.gameOver) {
    const winner = game.teams[0].score >= game.teams[1].score ? 0 : 1;
    const names = game.players.filter((p) => p.team === winner).map((p) => p.name).join(' & ');
    $('winner-text').textContent = `${names} win`;
    scoreRows($('final-scores'), game.lastHandScores);
    show('gameover');
    return;
  }
  if (game.handOver) {
    const out = game.outPlayer === null ? 'The stock ran out' : `${game.players[game.outPlayer].name} went out`;
    $('handover-title').textContent = out;
    scoreRows($('hand-scores'), game.lastHandScores);
    show('handover');
    return;
  }
  render();
}

// ---------------------------------------------------------------- actions

function attempt(move) {
  try {
    game = applyMove(game, move);
    selected = new Set();
    staged = [];
    return true;
  } catch (err) {
    message = err.message;
    isError = true;
    return false;
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
  if (!id?.startsWith('act-')) return;

  switch (id) {
    case 'act-draw':
      if (attempt({ type: 'draw' })) return afterMove();
      return render();

    case 'act-take':
      // The top card is melded with the selection as one group.
      if (attempt({ type: 'takePile', groups: [[...selected, topDiscard(game).id]] })) return afterMove();
      return render();

    case 'act-group':
      staged.push({ to: null, ids: [...selected] });
      selected = new Set();
      return render();

    case 'act-clear':
      staged = [];
      return render();

    case 'act-lay': {
      const groups = staged.map((g) => ({ to: g.to, cards: g.ids }));
      if (attempt({ type: 'meld', groups })) return afterMove();
      return render();
    }

    case 'act-discard': {
      const [card] = [...selected];
      const ended = attempt({ type: 'discard', card });
      if (!ended) return render();
      if (game.handOver || game.gameOver) return afterMove();
      return toPass();
    }
  }
}

function startGame(scores = [0, 0]) {
  const names = [0, 1, 2, 3].map((i) => $(`p${i}`).value.trim() || ['North', 'East', 'South', 'West'][i]);
  game = createGame({ players: names, scores, firstPlayer: handNumber % 4 });
  toPass();
}

export function boot() {
  $('start').addEventListener('click', () => { handNumber = 0; startGame(); });
  $('ready').addEventListener('click', () => { show('board'); render(); });
  $('next-hand').addEventListener('click', () => {
    handNumber += 1;
    startGame(game.teams.map((t) => t.score));
  });
  $('new-game').addEventListener('click', () => show('title'));
  $('board').addEventListener('click', onBoardClick);
  $('actions').addEventListener('click', onAction);
  show('title');

  // Local development aid: lets a test driver read the engine state the board
  // is showing. Never exposed off this machine.
  if (['localhost', '127.0.0.1'].includes(location.hostname)) {
    window.__canasta = { state: () => game, staged: () => staged };
  }
}
