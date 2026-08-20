# Rotuno Spite and Malice

Spite and Malice with the Rotuno house rules. A web app: one link that plays in
any browser and installs to the home screen on iPhone and Android.

## Rules

Two 54-card decks (52 + 2 jokers each), 108 cards in total.

| | |
|---|---|
| Payoff pile | Deck one, split evenly — 27 cards each at two players |
| Opening hand | 5 cards, dealt from deck two |
| Draw pile | What remains of deck two — 44 cards |
| Build piles | 4 in the centre, built Ace up to Queen |
| Discard piles | 4 per player |

- **Kings and Jokers are wild**, standing in for a 3 up to a Queen.
- **Wilds cannot be an ace or a two** — those must be the real card.
- **Aces and twos in hand are compulsory.** You may not end your turn while one
  of them still has a pile to go on.
- **Only a discard ends your turn.** Empty your hand by playing and you draw a
  fresh five and carry on.
- A build pile completed at Queen is cleared and recycled into the draw stock.
- First player to empty their payoff pile wins.

### House rule options

Set in `DEFAULT_CONFIG` in [src/engine/game.js](src/engine/game.js).

| Option | Default | Effect |
|---|---|---|
| `wildsAsLowRanks` | `false` | Turn on to let wilds cover aces and twos, for a faster game |
| `forceLowCards` | `true` | Turn off to allow sitting on a playable ace or two |
| `payoffSize` | `null` | An even split of the payoff deck; set a number for shorter games |

## Running it

This machine has no Node and no Python, so the project has no build step and
ships a static server of its own.

```
powershell -ExecutionPolicy Bypass -File tools\serve.ps1
```

Then open <http://localhost:8080/>. The engine test suite lives at
<http://localhost:8080/tests/> and runs in the browser.

To regenerate the app icons after a design change:

```
powershell -ExecutionPolicy Bypass -File tools\make-icons.ps1
```

## Layout

```
src/engine/   rules engine - pure state machine, no UI or network
tests/        browser-run test suite
tools/        static server and icon generator
assets/icons/ generated app icons
```
