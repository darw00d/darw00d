# Night Shift

A terminal roguelike. You are the lone IT tech on a 12-hour night shift. Each
floor of the office is a procedurally generated dungeon of open-plan desks,
humming server rooms and comms cupboards. Every floor you survive is another
hour on the clock. Make it to the 07:00 handover.

```
 NIGHT SHIFT  Floor 4/12                                            [ 22:19 ]
                     #.#                 #.....#        |Health    28/30
            #####+########               #..==.#        | [###############-]
            #.............#              ##+###         |Caffeine  62/100
            #.====.====..=#               #%#           | [##########------]
            #.............#             ###@###         |Sanity    64/100
            #.==..====..==#             #..U%.          | [##########------]
            #.............#             #.====..  #     |
            ######+########             #....>....#     |Weapon: bare hands
                                        #....P....#     |Tickets closed: 3
--------------------------------------------------------------------------------
The Rogue Printer spits out 400 pages of someone's holiday photos.
The Angry User CCs your manager on a verbal complaint. (-6 Sanity)
```

## Running it

Needs Python 3.9+. Run these from this `night_shift/` folder:

```bash
# Linux / macOS: nothing to install
python3 -m nightshift

# Windows: curses comes from the windows-curses package
pip install -r requirements.txt
python -m nightshift
```

Options:

```bash
python3 -m nightshift --seed 1234          # replayable run: same seed, same building
python3 -m nightshift --start-floor 12     # practice: jump straight to the boss (not scored)
```

### On a phone or tablet

`web/index.html` is a touch version of the same game. It runs the same
Python package in the browser through [Brython](https://brython.info), so
gameplay, seeds and saves match the terminal version. It has a D-pad you can
hold to keep walking, swipe/tap-to-move on the map, tap-to-use pockets,
autosave (iOS often reloads background tabs; you'll get a "Resume shift"
button), and high scores kept on the device.

To run it yourself, serve this folder and open `/web/`:

```bash
python3 -m http.server 8000      # then visit http://<your-computer>:8000/web/
```

Use a terminal of at least 80x24. The seed is shown in the sidebar and on the
death screen. Press **R** there to replay the same seed.

## Controls

| Key | Action |
| --- | --- |
| Arrows / WASD | Move. Bump into enemies to hit them, or into paper jams to clear them |
| Space / `.` / `z` | Wait a turn |
| `E` / `>` | Take the lift (stand on the green `>`) |
| `1`-`9` | Use an inventory item (aimed items ask for a direction) |
| `f` | Lash with the ethernet cable (hits 2 tiles away) |
| `x` | Drop an item |
| `?` | Help |
| `Q` | Abandon shift |

## Survival notes

- **Health**: if it hits 0 you're done. Regenerates slowly while you're caffeinated.
- **Caffeine**: drains as you work. Below 30 you're *sluggish* (enemies get more
  turns than you). At 0 you get withdrawal headaches that cost HP.
- **Sanity**: Angry Users and the boss drain it. Under 30 you start to
  hallucinate, and at 0 you resign on the spot. Closing a ticket (killing
  something) restores a little.
- **Ticket closures** (`$`) are currency. Spend them at the vending machine in
  the lift between floors.

### Enemies

| Glyph | Enemy | Behaviour |
| --- | --- | --- |
| `U` | Angry User | Chases you relentlessly and drains **Sanity**, not health |
| `P` | Rogue Printer | Stationary. Fires paper jams (`%`) that block the tiles around you. Hitting it may shock you back |
| `c` | Expired Cert | Weak, but once it spots you it keeps renewing itself. Kill it fast |
| `e` | Phishing Email | Disguised as loot (`$`, `!`, `?`) until you get close, then steals your ticket closures |
| `X` | Sentient Exchange Server | Final boss, three phases: mail storm (dodge the red `*` tiles, including your own), mailbox quota (archives your items onto the floor), and the "421 Service Unavailable" shield (wait for it to drop) |

### Items

| Glyph | Item | Effect |
| --- | --- | --- |
| `!` | Coffee | +35 Caffeine |
| `!` | Energy drink | +60 Caffeine and Wired (fast) for 20 turns, then a crash |
| `,` | Meal deal | +12 Health |
| `*` | Stress ball | +20 Sanity |
| `?` | Admin password | Sticky note. Bump a locked red `+` door to open the supply cupboard |
| `)` | Ethernet cable | Weapon (2-5). `f` to lash enemies 2 tiles away |
| `)` | Label maker | Ranged: damage + stun, 5 charges |
| `)` | Fire extinguisher | Hits everything within 2 tiles, stuns, clears paper jams. 3 charges |

Between floors there may be a random event (P1 incident, change freeze, a
"quick favour" from your manager...). Each one gives you a choice.

## High scores

Scores are saved to `~/.nightshift_scores.json`. Set `NIGHTSHIFT_SCORES` to
store them somewhere else.

## Code layout

| Module | Contents |
| --- | --- |
| `main.py` | Arguments, screen flow, input loop |
| `game.py` | Game state and turn scheduler (no curses, fully testable) |
| `mapgen.py` | Floor generation, field of view, pathfinding |
| `entities.py` | Player, enemies, boss |
| `combat.py` | Attacks, damage, death |
| `items.py` | Item definitions, effects, loot placement |
| `interlude.py` | Between-floor events and the vending machine |
| `ui.py` | All curses rendering |
| `report.py` / `scores.py` | Death ticket, high score file |
| `flavour.py` | The jokes |
| `web.py` | The browser version's screen flow (used by `web/index.html`) |
| `savegame.py` / `seeding.py` | JSON saves for the browser; seeds that match across Python runtimes |

The run seed drives everything. Each floor's layout, spawns and loot come from
their own RNG derived from the seed, so a seed always gives the same building.

## Tests

```bash
pip install pytest
python3 -m pytest
```

`tests/tui_harness.py` drives the real curses UI in a pseudo-terminal (Linux
and macOS only, needs `pip install pyte`) for manual smoke checks.
