# Canasta — Fifty Years

Four-player partnership Canasta, themed for a golden wedding anniversary. A web
app: one link that plays in any browser and installs to the home screen on
iPhone and Android.

Four players, four phones. One person starts a table and reads out its
four-letter code; everyone else types it in and takes a seat. Partners sit
opposite each other, and each phone shows only its own hand.

## How four phones stay in step

The document in Firestore holds two things: a seed, and the list of moves made
so far. Nothing else. Every phone runs the same engine over the same seed and
the same moves, so every phone arrives at the same game — the deal included,
since the shuffle is seeded rather than random.

That means there is no server to write, no second copy of the rules to keep
honest, and no Cloud Functions bill. A move is checked against the engine on
the phone that made it, then appended to the log inside a transaction that
refuses it if anybody else got there first. Moves carry the seat that made
them, so a phone cannot play somebody else's turn.

It also means a player who closes the tab, locks the phone or walks out of
range loses nothing at all: the seat is held by an id in local storage, and
reopening the link replays the whole game from the log and puts them back where
they were.

The one thing this design does not do is hide anything from a determined
player: every phone can replay the log, so the cards are all there in memory.
For a family game that is the right trade.

## Computer players

Any empty chair can be filled by a computer, and a player who has to step away
can hand their seat over and take it back later. Computers are named rather
than numbered, so the table reads like people.

No phone hosts them. Every phone works out what a computer seat should do and
races to write the move; the append transaction means one write lands and the
rest fall away. The computers therefore keep playing even when whoever added
them walks out of the room.

The player itself is one pure function of the game state, which is what lets
the test suite play whole hands with it. Over two hundred hands of self-play it
makes about eleven hundred canastas and takes seventeen hundred discard piles.
Roughly a third of those hands end with somebody going out and the rest on a
dead deck, which is the house rules rather than the player: drawing two from
two decks, and two canastas needed before anyone may go out. Whatever it picks is tried
against the engine before it is sent: a move the engine would refuse does not
lose a trick, it stops the game on every device at once.

## Rules as implemented

Two decks plus four jokers, 108 cards. Thirteen cards each.

| | |
|---|---|
| Wild cards | Jokers (50) and deuces (20) |
| Melds | Three or more of a rank, at least two natural, at most three wilds |
| Canasta | Seven cards — 500 natural, 300 with a wild in it |
| Red threes | 100 each, 800 for all four; banked and replaced the moment they are drawn |
| Black threes | Meldable only as you go out, and never with a wild |
| Drawing | Two cards from the stock each turn, one discarded: a hand grows by a card a turn |
| Going out | Needs two canastas, not one |
| Game to | 5000 points |

**Opening meld.** A partnership's first meld must reach a minimum that climbs
with its score: 15 below zero, 50 up to 1495, 90 up to 2995, 120 thereafter.
Several melds laid down together count toward it, which is why the board stages
them before committing.

**Taking the discard pile.** The top card must be melded immediately.

- *Unfrozen* — take it by adding the top card to a meld your side already has,
  or by matching it with two cards from your hand, one of which may be a wild.
- *Frozen* — you need two natural cards matching the top card, always.
- A black three or a wild on top blocks the pile entirely.

A pile freezes when a wild card is discarded onto it, or when a wild or red
three is buried in it at the start of the hand. Taking the pile clears the
freeze.

**A finished canasta does not hand you the pile.** Cards still go onto it and
still score: what a side with its sevens already made cannot do is keep
collecting every seven that is thrown. To take that pile they need the cards in
hand like anybody else — two natural sevens, or a seven and a wild while the
pile is unfrozen — and the top card can then join the canasta for its points.

The board marks this from the other side. A card in your hand whose rank the
opposition has down, and has not yet made into a canasta, wears a **&lowast;**
while the pile is unfrozen: throw it and the pile is theirs for nothing.

**Drawing two.** A turn takes two cards from the stock rather than the classic
one, and still ends in a single discard, so hands swell as the deal goes on and
the stock empties twice as fast. Over a hundred and fifty self-played hands
that leaves only about a third of them ending with somebody going out, against
seven in eight when drawing one; three decks rather than two would put it back
to roughly three quarters. Both numbers live in `DEFAULT_CONFIG`, as
`drawCount` and `deckCount`.

**Running out of stock.** When the stock is gone the hand carries on across
the discard pile alone. The player to move must take it, and the hand ends the
moment somebody cannot, or declines. A top card that fits a meld your side
already has makes the pile compulsory: you may not decline it.

**Asking to go out.** You may ask your partner once per turn, after drawing.
The answer binds you.

**Going out.** Your partnership needs two canastas. Going out pays 100,
or 200 if you laid your whole hand down in a single turn having melded nothing
before. What everybody else's leftover cards cost them is its own section,
below: they come off the table rather than off the foot of the column.

## Running it

No build step and no toolchain. Serve the repository and open the folder:

```
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

- Game: <http://localhost:8080/canasta/>  (the service worker is switched off
  on localhost, so an edit is always the file you just saved)
- Engine tests: <http://localhost:8080/canasta/tests/>

To regenerate the app icons:

```
powershell -ExecutionPolicy Bypass -File canasta\tools\make-icons.ps1
```

## Layout

```
src/engine/cards.js   card model, values, wild and three classification
src/engine/melds.js   meld validity and canasta scoring
src/engine/game.js    deal, turns, the discard pile, going out, scoring
src/ai/player.js      the computer player: one pure function, no state at all
firestore.rules       what the database will and will not allow
src/net/room.js       the Firestore document: seats, the move log, the lobby
src/net/replay.js     rebuilding a game from a seed and a list of moves
src/ui/board.js       the board, the lobby, the action log, everything you tap
src/ui/taunts.js      the heckler: what the board says when the pile moves
tools/bot.js          a crude auto-player, for driving whole hands in testing
tests/                browser-run suites
```

## Deliberately not enforced

If your partner says yes, the rules say you must go out. The engine records
the yes and the board says so plainly, but it will not refuse your discard:
a player who asks, is told yes, and then finds they cannot actually go out
would otherwise be stuck with no legal move at all. A refusal, which is the
half that comes up in real play, is enforced strictly.

## Being caught with cards

The side that gets caught when somebody goes out does not simply have its
leftovers deducted at the foot of the column. It pays for them out of what is
on the table, in this order:

1. the card points of its melds
2. whole canasta bonuses, one at a time, until the debt is covered
3. red threes

A canasta broken to cover ninety points forfeits all five hundred of itself:
that is what breaking one means. Nothing is ever forgiven. A side that cannot
pay for its hand out of everything it owns eats the difference and goes
negative, which drops its opening minimum to fifteen for the next hand.

The side that went out is spared it: their partner's leftovers are deducted the
ordinary way, and no canasta of theirs is ever broken. Everybody else pays, and
when the stock dies with nobody out that means both sides, since neither of
them got their cards down in time.

Worth seeing plainly, because it is the whole of the rule: since the debt is
always paid in full, paying out of the table and then going under is *exactly*
ordinary subtraction, save for one thing. A canasta broken to cover five points
loses the other four hundred and ninety-five as well. That overshoot is the
entire difference between this and a normal Canasta score sheet, and it is
worth avoiding at some cost.

Across two hundred self-played hands the computers broke five canastas and
wasted 1080 points doing it, and never once went negative -- they always have
too much on the table. Human players, who hoard, will see both.

