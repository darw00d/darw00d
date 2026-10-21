"""Browser front end support: the main.py screen flow as a state machine.

The page (web/index.html) runs this under Brython. It sends actions as dicts
and draws whatever view() returns. Nothing here touches the browser, so it is
tested with plain pytest like the rest of the game.
"""

import json

from . import config, interlude, report, savegame, scores
from .game import Game

# One character per colour so a map row's colours fit in a string.
COLORS = ["normal", "dim", "memory", "player", "angry", "cert", "printer", "phish", "boss",
          "spam", "item", "coffee", "money", "good", "bad", "info", "warn", "wall", "floor",
          "desk", "rack", "door", "locked", "lift", "jam", "telegraph", "title"]
CODE = {name: chr(ord("a") + i) for i, name in enumerate(COLORS)}

TILE_STYLE = {
    "#": ("#", "wall"), ".": (".", "floor"), "+": ("+", "door"), "L": ("+", "locked"),
    ">": (">", "lift"), "=": ("=", "desk"), "|": ("|", "rack"),
}

TILE_CODES = {t: (glyph, CODE[color]) for t, (glyph, color) in TILE_STYLE.items()}

SAVE_EVERY = 5   # turns between autosaves (the page also saves when hidden)

HELP = [
    ("How to play", "title"),
    ("Tap the pad, swipe on the map, or tap next to yourself to move.", "normal"),
    ("Walk into enemies to hit them. Walk into paper jams (%) to clear them.", "normal"),
    ("Tap an item in your pockets to use it. Aimed items ask for a direction.", "normal"),
    ("LIFT takes the lift when you're standing on the green >.", "normal"),
    ("LASH cracks the ethernet cable at something 2 tiles away.", "normal"),
    ("", "normal"),
    ("Caffeine drains as you work. Under 30 you're slower than everyone else.", "dim"),
    ("Sanity at 0 means you resign. Closing tickets (kills) restores a little.", "dim"),
    ("A red @ means you're standing on a tile that's about to be hit.", "dim"),
    ("Spend ticket closures ($) at the vending machine between floors.", "dim"),
    ("Keyboard works too: arrows/WASD, space, E, F, X, 1-9.", "dim"),
]


def _lines(text, color="normal"):
    return [[text, color]]


class WebApp:
    def __init__(self, scores_json="", save_json=""):
        self.entries = self._parse_scores(scores_json)
        self.saved = None
        if save_json:
            try:
                self.saved = savegame.loads(save_json)
                if self.saved.state not in ("playing", "floor_done"):
                    self.saved = None
            except Exception:       # stale or corrupt save: start fresh
                self.saved = None
        self.game = None
        self.mode = "title"
        self.panel = None
        self.prompt = None
        self.aiming = None          # inventory slot or "lash"
        self.steps = []             # pending between-floor screens
        self.shop = None
        self.event = None
        self.last_rank = None
        self.persist = {}           # localStorage writes for the page to make
        self.turns_since_save = 0
        self.viewport = (config.MAP_W, config.MAP_H)   # map cells the page can show

    @staticmethod
    def _parse_scores(text):
        try:
            data = json.loads(text) if text else []
            return [e for e in data if isinstance(e, dict) and "score" in e][:scores.MAX_ENTRIES]
        except ValueError:
            return []

    # ------------------------------------------------------------ actions
    def handle(self, action):
        """Any action may carry "view": [cols, rows], the page's map size in cells."""
        if "view" in action:
            cols, rows = action["view"]
            self.viewport = (max(5, min(150, int(cols))), max(5, min(100, int(rows))))
        kind = action.get("type")
        handler = getattr(self, f"_on_{self.mode}", None)
        if kind == "help" and self.mode == "play":
            self.mode, self.panel = "help", {"title": "Night Shift", "lines": HELP,
                                             "choices": [{"label": "Back to work"}]}
            return
        if handler:
            handler(kind, action)

    def _on_title(self, kind, action):
        if kind == "start":
            seed = action.get("seed")
            seed = int(seed) if str(seed or "").strip().isdigit() else None
            self.begin(Game(seed=seed, start_floor=int(action.get("floor") or 1)))
        elif kind == "resume" and self.saved:
            game, self.saved = self.saved, None
            self.begin(game, resumed=True)

    def begin(self, game, resumed=False):
        self.game = game
        self.mode = "play"
        if resumed:
            game.log.add("Shift resumed. Nobody noticed you were gone.", "info")
        if game.state == "floor_done":
            self._start_interlude()
        else:
            self._save()

    def _on_play(self, kind, action):
        g = self.game
        acted = False
        if kind == "dir":
            acted = g.move_player(int(action["dx"]), int(action["dy"]))
        elif kind == "wait":
            acted = g.wait()
        elif kind == "lift":
            acted = g.take_lift()
        elif kind == "slot":
            i = int(action["slot"])
            inv = g.player.inventory
            if 0 <= i < len(inv) and inv[i].needs_direction:
                self.aiming = i
                self.mode = "aim"
                self.prompt = f"Aim the {inv[i].name.lower()}: pick a direction."
                return
            acted = g.use_item(i)
        elif kind == "lash":
            if g.player.weapon and g.player.weapon.key == "cable":
                self.aiming, self.mode = "lash", "aim"
                self.prompt = "Lash which way? The cable reaches 2 tiles."
                return
            g.lash((0, 0))
        elif kind == "drop":
            if g.player.inventory:
                self.mode, self.prompt = "drop", "Tap the item to drop."
        elif kind == "quit":
            self.mode = "quit"
            self.panel = {"title": "Abandon your shift?",
                          "lines": _lines("This run will be lost. Permadeath, remember.", "dim"),
                          "choices": [{"label": "Keep working"},
                                      {"label": "Abandon shift", "color": "bad"}]}
        if acted:
            self._after_turn()

    def _on_aim(self, kind, action):
        g = self.game
        if kind == "dir":
            d = (int(action["dx"]), int(action["dy"]))
            target, self.aiming = self.aiming, None
            self.mode, self.prompt = "play", None
            acted = g.lash(d) if target == "lash" else g.use_item(target, d)
            if acted:
                self._after_turn()
        elif kind in ("cancel", "slot", "lash"):
            self.mode, self.prompt, self.aiming = "play", None, None

    def _on_drop(self, kind, action):
        self.mode, self.prompt = "play", None
        if kind == "slot" and self.game.drop_item(int(action["slot"])):
            self._after_turn()

    def _on_quit(self, kind, action):
        if kind == "choose" and action.get("index") == 1:
            self.game = None
            self.persist["save"] = ""
            self.mode, self.panel = "title", None
        else:
            self.mode, self.panel = "play", None

    def _on_help(self, kind, action):
        self.mode, self.panel = "play", None

    def _after_turn(self):
        g = self.game
        if g.state == "floor_done":
            self._start_interlude()
        elif g.state in ("dead", "won"):
            self._finish()
        else:
            self.turns_since_save += 1
            if self.turns_since_save >= SAVE_EVERY:
                self._save()

    def _save(self):
        self.turns_since_save = 0
        if self.game and self.game.state in ("playing", "floor_done"):
            self.persist["save"] = savegame.dumps(self.game)

    def force_save(self):
        """The page calls this when it's about to be hidden or closed."""
        if self.mode in ("play", "aim", "drop", "help", "quit"):
            self._save()
        return self.take_persist()

    def take_persist(self):
        out, self.persist = self.persist, {}
        return out

    # ------------------------------------------------------------ between floors
    def _start_interlude(self):
        g = self.game
        self._save()      # state is floor_done: a reload resumes at the lift
        hour = (config.START_HOUR + g.floor) % 24
        self.header = f"Floor {g.floor} survived. The lift crawls down. It is now {hour:02d}:00."
        self.event = interlude.roll_event(g)
        self.steps = []
        if self.event:
            self.steps.append(self._show_event)
        self.steps.append(self._show_shop_or_freeze)
        if g.floor + 1 == config.TOTAL_FLOORS:
            self.steps.append(self._show_final_intro)
        self._advance()

    def _advance(self):
        if self.steps:
            self.steps.pop(0)()
            return
        self.game.next_floor()
        self.mode, self.panel, self.shop = "play", None, None
        self._save()

    def _show_event(self):
        e = self.event
        self.mode = "event"
        self.panel = {"kicker": self.header, "title": e.title, "lines": _lines(e.text),
                      "choices": [{"label": label} for label, _ in e.choices]}

    def _on_event(self, kind, action):
        if kind != "choose":
            return
        index = int(action.get("index", 0))
        if not 0 <= index < len(self.event.choices):
            return
        result = self.event.choose(self.game, index)
        self.mode = "notice"
        self.panel = {"kicker": self.header, "title": self.event.title,
                      "lines": _lines(result, "info"), "choices": [{"label": "Continue"}]}

    def _on_notice(self, kind, action):
        if kind == "choose":
            self._advance()

    def _show_shop_or_freeze(self):
        g = self.game
        if g.shop_closed:
            self.mode = "notice"
            self.panel = {"kicker": self.header, "title": "Vending machine",
                          "lines": [["The vending machine has a laminated sign:", "normal"],
                                    ["CHANGE FREEZE IN EFFECT", "warn"]],
                          "choices": [{"label": "Continue"}]}
            return
        self.shop = interlude.Shop(g)
        self.shop_note = [self.shop.quip, "dim"]
        self.mode = "shop"
        self._shop_panel()

    def _shop_panel(self):
        p = self.game.player
        choices = [{"label": item.label, "sub": item.desc, "price": item.price,
                    "glyph": item.glyph, "color": item.color,
                    "enabled": p.tickets >= item.price and len(p.inventory) < p.INVENTORY_SIZE}
                   for item in self.shop.stock]
        self.panel = {"kicker": self.header, "title": "Vending machine",
                      "lines": [self.shop_note,
                                [f"You have {p.tickets} ticket closures. "
                                 f"Pockets {len(p.inventory)}/{p.INVENTORY_SIZE}.", "money"]],
                      "choices": choices, "leave": "Back to the lift"}

    def _on_shop(self, kind, action):
        if kind == "buy":
            ok, msg = self.shop.buy(self.game, int(action.get("index", -1)))
            if msg:
                self.shop_note = [msg, "good" if ok else "bad"]
            self._shop_panel()
        elif kind in ("leave", "cancel"):
            self._advance()

    def _show_final_intro(self):
        self.mode = "notice"
        self.panel = {"kicker": "06:00", "title": "The final floor",
                      "lines": [["Every alert on your phone points to the same place: the main "
                                 "data hall, and the Exchange server that lives there.", "normal"],
                                ["It has become sentient. It is not happy about it.", "warn"],
                                ["Tip: an ethernet cable reaches two tiles. "
                                 "The server's arms don't.", "dim"]],
                      "choices": [{"label": "Step out of the lift"}]}

    # ------------------------------------------------------------ end of run
    def _finish(self):
        g = self.game
        cause = report.cause_text(g)
        self.entries, self.last_rank = scores.insert(self.entries, g, cause)
        self.persist["scores"] = json.dumps(self.entries)
        self.persist["save"] = ""          # permadeath
        score = scores.compute_score(g)
        summary = f"Score {score}  ·  Floor {g.floor}  ·  Kills {g.player.kills}  ·  Seed {g.seed}"
        if g.state == "won":
            panel = {"kicker": "07:00", "title": "Handover complete", "ticket": {
                "number": "REQ0000700", "fields": [
                    ["Short description", "Shift handover"], ["Status", "Resolved"],
                    ["Notes", "Day shift: 'Quiet night, was it?'"]]}}
        else:
            number, fields = report.incident_ticket(g)
            panel = {"kicker": g.clock, "title": "Your shift is over",
                     "ticket": {"number": number, "fields": [list(f) for f in fields]}}
        lines = [[summary, "money"]]
        if g.start_floor != 1:
            lines.append(["Practice run from a later floor: not recorded.", "dim"])
        panel.update(lines=lines, scores=self.entries[:5], rank=self.last_rank,
                     choices=[{"label": "Replay this seed"}, {"label": "New shift"},
                              {"label": "Title screen"}])
        self.mode, self.panel = "end", panel

    def _on_end(self, kind, action):
        if kind != "choose":
            return
        index = action.get("index")
        if index == 0:
            self.begin(Game(seed=self.game.seed, start_floor=self.game.start_floor))
        elif index == 1:
            self.begin(Game(start_floor=self.game.start_floor))
        else:
            self.game, self.mode, self.panel = None, "title", None

    # ------------------------------------------------------------ view
    def view(self):
        v = {"mode": self.mode, "prompt": self.prompt, "panel": self.panel}
        if self.mode == "title":
            s = self.saved
            v["title"] = {"scores": self.entries[:5],
                          "resume": (f"Floor {s.floor}, {s.clock}, seed {s.seed}" if s else None)}
            return v
        g = self.game
        p = g.player
        v["hud"] = {
            "floor": g.floor, "floors": config.TOTAL_FLOORS, "clock": g.clock, "seed": g.seed,
            "statuses": [list(s) for s in g.status_effects()],
            "hp": [p.hp, p.max_hp], "caf": [p.caffeine, p.max_caffeine],
            "san": [p.sanity, p.max_sanity], "weapon": p.weapon_name, "tickets": p.tickets,
            "can_lash": bool(p.weapon and p.weapon.key == "cable"),
            "on_lift": g.gmap.lift is not None and p.pos == g.gmap.lift,
            "inventory": [{"label": i.label, "glyph": i.glyph, "color": i.color,
                           "aim": i.needs_direction} for i in p.inventory],
            "pockets": p.INVENTORY_SIZE,
        }
        v["log"] = [[text + (f" (x{count})" if count > 1 else ""), color, turn >= g.log.turn - 1]
                    for text, color, count, turn in g.log.recent(6)]
        v["map"] = self.render_map()
        return v

    def render_map(self):
        """The viewport-sized window of the map centred on the player, as one
        string of glyphs and one of colour codes per row."""
        g = self.game
        gm, p = g.gmap, g.player
        cols, rows = self.viewport
        ox, oy = p.x - cols // 2, p.y - rows // 2
        normal, memory, jam = CODE["normal"], CODE["memory"], CODE["jam"]
        glyphs = [[" "] * cols for _ in range(rows)]
        colors = [[normal] * cols for _ in range(rows)]
        visible, jams = g.visible, gm.jams
        for sy in range(rows):
            y = oy + sy
            if not 0 <= y < gm.height:
                continue
            row_g, row_c, explored, tiles = glyphs[sy], colors[sy], gm.explored[y], gm.tiles[y]
            for sx in range(max(0, -ox), min(cols, gm.width - ox)):
                x = ox + sx
                if explored[x]:
                    glyph, color = TILE_CODES[tiles[x]]
                    if jams and (x, y) in jams:
                        glyph, color = "%", jam
                    row_g[sx] = glyph
                    row_c[sx] = color if (x, y) in visible else memory

        def put(x, y, glyph, color):
            sx, sy = x - ox, y - oy
            if 0 <= sx < cols and 0 <= sy < rows:
                glyphs[sy][sx], colors[sy][sx] = glyph, CODE.get(color, normal)

        for it in g.items:
            if it.pos in visible:
                put(it.x, it.y, it.glyph, it.color)
        extras = g.extra_glyphs()
        for x, y, glyph, color in extras:
            put(x, y, glyph, color)
        for e in g.enemies:
            if e.pos in visible:
                put(e.x, e.y, e.glyph, e.color)
        on_target = any(e[:2] == p.pos for e in extras)
        put(p.x, p.y, "@", "telegraph" if on_target else "player")
        return {"ox": ox, "oy": oy, "px": p.x, "py": p.y,
                "glyphs": ["".join(r) for r in glyphs], "colors": ["".join(r) for r in colors]}
