// A crude auto-player, for testing only.
//
// Plays the seat this browser is sitting in: draw, lay down anything legal,
// discard the last card in hand. It knows no strategy whatsoever — the point
// is to drive whole hands through the networked board without four people
// tapping, so that scoring, hand ends and the next deal all get exercised.
//
// Load it from the console on a table you have joined:
//   await import('/canasta/tools/bot.js')

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const value = (c) => (c.rank === 0 ? 50 : (c.rank === 1 || c.rank === 2) ? 20
  : c.rank === 3 ? 5 : c.rank >= 8 ? 10 : 5);

const bot = { turns: 0, stop: false, errors: [] };
window.__bot = bot;

async function playTurn() {
  const seat = window.__canasta.seat();
  if (seat === null) return;
  let g = window.__canasta.state();
  if (!g || g.handOver || g.turn !== seat) return;

  if (g.phase === 'draw') {
    // With the stock gone the only moves left are the pile or ending the hand.
    if (g.stock.length === 0) {
      await window.__canasta.send({ type: 'pass' });
      return;
    }
    await window.__canasta.send({ type: 'draw' });
    await wait(400);
  }

  g = window.__canasta.state();
  if (g.turn !== seat || g.phase !== 'play' || g.handOver) return;

  const team = g.teams[seat % 2];
  const byRank = {};
  for (const c of g.players[seat].hand) if (c.rank > 3) (byRank[c.rank] ??= []).push(c);

  const groups = [];
  let worth = 0;
  for (const [rank, cards] of Object.entries(byRank)) {
    const existing = team.melds[rank];
    if (!existing && cards.length < 3) continue;
    groups.push({ to: existing ? Number(rank) : null, ids: cards.map((c) => c.id) });
    worth += cards.reduce((n, c) => n + value(c), 0);
  }

  // Never meld the whole hand: going out is left to the humans.
  const spare = g.players[seat].hand.length - groups.reduce((n, x) => n + x.ids.length, 0);
  if (groups.length && spare >= 1 && (team.hasMelded || worth >= team.minimum)) {
    try {
      await window.__canasta.send({ type: 'meld', groups });
      await wait(400);
    } catch (e) { bot.errors.push(e.message); }
  }

  g = window.__canasta.state();
  if (g.turn !== seat || g.phase !== 'play' || g.handOver) return;
  const hand = g.players[seat].hand;
  if (hand.length < 2) return;
  await window.__canasta.send({ type: 'discard', card: hand[hand.length - 1].id });
  bot.turns += 1;
}

bot.timer = setInterval(() => {
  if (bot.stop || bot.turns > 80) return clearInterval(bot.timer);
  playTurn().catch((e) => bot.errors.push(String(e.message || e)));
}, 700);

export default bot;
