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

## Rules as implemented

Two decks plus four jokers, 108 cards. Eleven cards each.

| | |
|---|---|
| Wild cards | Jokers (50) and deuces (20) |
| Melds | Three or more of a rank, at least two natural, at most three wilds |
| Canasta | Seven cards — 500 natural, 300 with a wild in it |
| Red threes | 100 each, 800 for all four; banked and replaced the moment they are drawn |
| Black threes | Meldable only as you go out, and never with a wild |
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

**Running out of stock.** When the stock is gone the hand carries on across
the discard pile alone. The player to move must take it, and the hand ends the
moment somebody cannot, or declines. A top card that fits a meld your side
already has makes the pile compulsory: you may not decline it.

**Asking to go out.** You may ask your partner once per turn, after drawing.
The answer binds you.

**Going out.** Your partnership needs at least one canasta. Going out pays 100,
or 200 if you laid your whole hand down in a single turn having melded nothing
before. Cards left in hand are deducted.

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
firestore.rules       what the database will and will not allow
src/net/room.js       the Firestore document: seats, the move log, the lobby
src/net/replay.js     rebuilding a game from a seed and a list of moves
src/ui/board.js       the board, the lobby and everything you tap
tools/bot.js          a crude auto-player, for driving whole hands in testing
tests/                browser-run suites
```

## Deliberately not enforced

If your partner says yes, the rules say you must go out. The engine records
the yes and the board says so plainly, but it will not refuse your discard:
a player who asks, is told yes, and then finds they cannot actually go out
would otherwise be stuck with no legal move at all. A refusal, which is the
half that comes up in real play, is enforced strictly.
