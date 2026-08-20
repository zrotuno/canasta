# Canasta — Fifty Years

Four-player partnership Canasta, themed for a golden wedding anniversary. A web
app: one link that plays in any browser and installs to the home screen on
iPhone and Android.

Four players share one device. Partners sit opposite each other, and a
hand-over screen covers the table between turns so nobody sees another player's
cards.

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

- Game: <http://localhost:8080/canasta/>
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
src/ui/board.js       the four-player board
tests/                browser-run suites
```

## Deliberately not enforced

If your partner says yes, the rules say you must go out. The engine records
the yes and the board says so plainly, but it will not refuse your discard:
a player who asks, is told yes, and then finds they cannot actually go out
would otherwise be stuck with no legal move at all. A refusal, which is the
half that comes up in real play, is enforced strictly.
