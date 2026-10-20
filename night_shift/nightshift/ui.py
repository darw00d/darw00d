"""Everything that touches curses lives here."""

import curses
import textwrap

from . import config, mapgen

SIDEBAR_W = 24
LOG_H = 6   # including separator line

KEY_DIRS = {
    curses.KEY_UP: (0, -1), curses.KEY_DOWN: (0, 1),
    curses.KEY_LEFT: (-1, 0), curses.KEY_RIGHT: (1, 0),
    ord("w"): (0, -1), ord("s"): (0, 1), ord("a"): (-1, 0), ord("d"): (1, 0),
    ord("W"): (0, -1), ord("S"): (0, 1), ord("A"): (-1, 0), ord("D"): (1, 0),
}
# windows-curses reports the keypad arrows under separate codes.
for _name, _d in (("KEY_A2", (0, -1)), ("KEY_C2", (0, 1)), ("KEY_B1", (-1, 0)), ("KEY_B3", (1, 0))):
    if hasattr(curses, _name):
        KEY_DIRS[getattr(curses, _name)] = _d

ESC = 27

# name -> (foreground, bold)
PALETTE = {
    "normal": (curses.COLOR_WHITE, False),
    "dim": ("grey", False),
    "memory": (curses.COLOR_BLUE, False),
    "player": (curses.COLOR_WHITE, True),
    "angry": (curses.COLOR_RED, True),
    "cert": (curses.COLOR_YELLOW, False),
    "printer": (curses.COLOR_CYAN, True),
    "phish": (curses.COLOR_MAGENTA, True),
    "boss": (curses.COLOR_RED, True),
    "spam": (curses.COLOR_MAGENTA, False),
    "item": (curses.COLOR_GREEN, True),
    "coffee": (curses.COLOR_YELLOW, True),
    "money": (curses.COLOR_YELLOW, True),
    "good": (curses.COLOR_GREEN, True),
    "bad": (curses.COLOR_RED, True),
    "info": (curses.COLOR_CYAN, False),
    "warn": (curses.COLOR_YELLOW, True),
    "wall": (curses.COLOR_WHITE, False),
    "floor": ("grey", False),
    "desk": (curses.COLOR_YELLOW, False),
    "rack": (curses.COLOR_BLUE, True),
    "door": (curses.COLOR_YELLOW, False),
    "locked": (curses.COLOR_RED, True),
    "lift": (curses.COLOR_GREEN, True),
    "jam": (curses.COLOR_WHITE, True),
    "telegraph": (curses.COLOR_RED, True),
    "title": (curses.COLOR_CYAN, True),
}

TILE_STYLE = {
    mapgen.WALL: ("#", "wall"),
    mapgen.FLOOR: (".", "floor"),
    mapgen.DOOR: ("+", "door"),
    mapgen.LOCKED: ("+", "locked"),
    mapgen.LIFT: (">", "lift"),
    mapgen.DESK: ("=", "desk"),
    mapgen.RACK: ("|", "rack"),
}


class UI:
    def __init__(self, scr):
        self.scr = scr
        self.attrs = {}
        try:
            curses.curs_set(0)
        except curses.error:
            pass
        scr.keypad(True)
        self._init_colors()

    def _init_colors(self):
        if not curses.has_colors():
            self.attrs = {k: (curses.A_BOLD if b else 0) for k, (_, b) in PALETTE.items()}
            return
        curses.start_color()
        bg = curses.COLOR_BLACK
        try:
            curses.use_default_colors()
            bg = -1
        except curses.error:
            pass
        grey = 8 if curses.COLORS >= 16 else curses.COLOR_WHITE
        for i, (name, (fg, bold)) in enumerate(PALETTE.items(), start=1):
            if fg == "grey":
                fg = grey
            try:
                curses.init_pair(i, fg, bg)
                attr = curses.color_pair(i)
            except curses.error:
                attr = 0
            if bold:
                attr |= curses.A_BOLD
            if name in ("dim", "floor") and grey == curses.COLOR_WHITE:
                attr |= curses.A_DIM
            self.attrs[name] = attr

    def attr(self, name):
        return self.attrs.get(name, 0)

    # ------------------------------------------------------------ primitives
    def size(self):
        return self.scr.getmaxyx()

    def put(self, y, x, text, color="normal"):
        rows, cols = self.size()
        if y < 0 or y >= rows or x >= cols:
            return
        text = text[: max(0, cols - x)]
        if y == rows - 1 and x + len(text) >= cols:
            text = text[:-1]     # writing the bottom-right cell raises in curses
        try:
            self.scr.addstr(y, x, text, self.attr(color))
        except curses.error:
            pass

    def get_key(self):
        while True:
            key = self.scr.getch()
            if key == curses.KEY_RESIZE:
                try:
                    curses.update_lines_cols()
                except AttributeError:
                    pass
                return key
            if key != -1:
                return key

    def too_small(self):
        rows, cols = self.size()
        return rows < config.MIN_ROWS or cols < config.MIN_COLS

    def draw_too_small(self):
        self.scr.erase()
        rows, cols = self.size()
        self.put(0, 0, f"Terminal is {cols}x{rows}.", "warn")
        self.put(1, 0, f"Night Shift needs at least {config.MIN_COLS}x{config.MIN_ROWS}.")
        self.put(2, 0, "Resize the window, or press Q to quit.")
        self.scr.refresh()

    # ------------------------------------------------------------ game screen
    def render(self, game, prompt=None):
        self.scr.erase()
        rows, cols = self.size()
        view_w = cols - SIDEBAR_W
        view_h = rows - LOG_H - 1
        self._draw_topbar(game, cols)
        self._draw_map(game, 1, 0, view_w, view_h)
        self._draw_sidebar(game, 1, view_w, rows - LOG_H - 1)
        self._draw_log(game, rows - LOG_H, cols, prompt)
        self.scr.refresh()

    def _draw_topbar(self, game, cols):
        left = f" NIGHT SHIFT  Floor {game.floor}/{config.TOTAL_FLOORS}"
        clock = f"[ {game.clock} ] "
        self.put(0, 0, left.ljust(cols), "title")
        self.put(0, cols - len(clock), clock, "warn")

    def _camera(self, game, view_w, view_h):
        gm, p = game.gmap, game.player

        def axis(pos, view, size):
            if size <= view:
                return -((view - size) // 2)
            return max(0, min(pos - view // 2, size - view))

        return axis(p.x, view_w, gm.width), axis(p.y, view_h, gm.height)

    def _draw_map(self, game, top, left, view_w, view_h):
        gm = game.gmap
        cam_x, cam_y = self._camera(game, view_w, view_h)
        for sy in range(view_h):
            my = cam_y + sy
            if not 0 <= my < gm.height:
                continue
            for sx in range(view_w):
                mx = cam_x + sx
                if not 0 <= mx < gm.width or not gm.explored[my][mx]:
                    continue
                glyph, color = TILE_STYLE[gm.tile(mx, my)]
                if (mx, my) in gm.jams:
                    glyph, color = "%", "jam"
                if (mx, my) not in game.visible:
                    color = "memory"
                self.put(top + sy, left + sx, glyph, color)

        def draw(x, y, glyph, color):
            sx, sy = x - cam_x, y - cam_y
            if 0 <= sx < view_w and 0 <= sy < view_h:
                self.put(top + sy, left + sx, glyph, color)

        for it in game.items:
            if it.pos in game.visible:
                draw(it.x, it.y, it.glyph, it.color)
        for x, y, glyph, color in game.extra_glyphs() if hasattr(game, "extra_glyphs") else ():
            draw(x, y, glyph, color)
        for e in game.enemies:
            if e.pos in game.visible:
                draw(e.x, e.y, e.glyph, e.color)
        draw(game.player.x, game.player.y, "@", "player")

    @staticmethod
    def _bar(value, maximum, width=10):
        filled = round(width * value / maximum) if maximum else 0
        return "[" + "#" * filled + "-" * (width - filled) + "]"

    def _stat_color(self, value, maximum):
        frac = value / maximum if maximum else 0
        return "good" if frac > 0.6 else "warn" if frac > 0.3 else "bad"

    def _draw_sidebar(self, game, top, left, height):
        p = game.player
        x = left + 1
        for row in range(height):
            self.put(top + row, left, "|", "dim")
        y = top
        for label, val, mx in (("Health ", p.hp, p.max_hp),
                               ("Caffeine", p.caffeine, p.max_caffeine),
                               ("Sanity ", p.sanity, p.max_sanity)):
            self.put(y, x, f"{label:<8} {val:>3}/{mx}", "normal")
            self.put(y + 1, x + 1, self._bar(val, mx, 16), self._stat_color(val, mx))
            y += 2
        y += 1
        self.put(y, x, f"Weapon: {p.weapon_name}", "normal")
        y += 1
        self.put(y, x, f"Tickets closed: {p.tickets}", "money")
        y += 2
        status = game.status_effects() if hasattr(game, "status_effects") else []
        for text, color in status:
            self.put(y, x, text, color)
            y += 1
        if status:
            y += 1
        self.put(y, x, "Inventory", "info")
        y += 1
        if not p.inventory:
            self.put(y, x, " (empty)", "dim")
            y += 1
        for i, item in enumerate(p.inventory, start=1):
            self.put(y, x, f"{i} {item.label}"[: SIDEBAR_W - 2], item.color)
            y += 1
        self.put(top + height - 1, x, f"Seed {game.seed}  ? help", "dim")

    def _draw_log(self, game, top, cols, prompt):
        self.put(top, 0, "-" * cols, "dim")
        lines = []
        for text, color, count, turn in game.log.recent(LOG_H * 2):
            if count > 1:
                text = f"{text} (x{count})"
            if turn < game.log.turn - 1 and color not in ("bad",):
                color = "dim"
            for chunk in textwrap.wrap(text, cols - 1) or [""]:
                lines.append((chunk, color))
        if prompt:
            lines.append((prompt, "warn"))
        for i, (text, color) in enumerate(lines[-(LOG_H - 1):]):
            self.put(top + 1 + i, 0, text, color)

    # ------------------------------------------------------------ prompts & screens
    def ask_direction(self, game, prompt="Which direction? (arrows/WASD, Esc cancels)"):
        self.render(game, prompt)
        while True:
            key = self.get_key()
            if key in KEY_DIRS:
                return KEY_DIRS[key]
            if key in (ESC, ord("q"), ord("Q")):
                return None

    def ask_slot(self, game, prompt):
        self.render(game, prompt)
        key = self.get_key()
        if ord("1") <= key <= ord("9"):
            return key - ord("1")
        return None

    def confirm(self, game, prompt):
        self.render(game, prompt + " (y/n)")
        return self.get_key() in (ord("y"), ord("Y"))

    def wrap(self, text, color="normal", width=64):
        return [(line, color) for line in textwrap.wrap(text, width)] or [("", color)]

    def event_screen(self, event, header):
        lines = [(header, "dim"), ("", "normal"), (f"*** {event.title} ***", "warn"), ("", "normal")]
        lines += self.wrap(event.text)
        lines.append(("", "normal"))
        for i, (label, _) in enumerate(event.choices, start=1):
            lines.append((f"  {i}) {label}", "info"))
        while True:
            key = self.text_screen(lines, "Choose 1 or 2")
            if ord("1") <= key < ord("1") + len(event.choices):
                return key - ord("1")

    def shop_screen(self, game, shop, header):
        note = (shop.quip, "dim")
        while True:
            p = game.player
            lines = [(header, "dim"), ("", "normal"), ("=== VENDING MACHINE ===", "warn"),
                     note, ("", "normal")]
            for i, item in enumerate(shop.stock, start=1):
                lines.append((f" {i}) {item.label:<22} {item.price:>3} tickets", item.color))
                lines.append((f"      {item.desc}", "dim"))
            if not shop.stock:
                lines.append(("  (sold out)", "dim"))
            lines += [("", "normal"),
                      (f"You have {p.tickets} ticket closures. "
                       f"Pockets: {len(p.inventory)}/{p.INVENTORY_SIZE}", "money")]
            key = self.text_screen(lines, "1-9 buy   Enter/Esc leave")
            if ord("1") <= key <= ord("9"):
                ok, msg = shop.buy(game, key - ord("1"))
                if msg:
                    note = (msg, "good" if ok else "bad")
            elif key in (10, 13, curses.KEY_ENTER, ESC, ord("q"), ord("Q"), ord(" ")):
                return

    def text_screen(self, lines, footer="Press any key"):
        """lines: list of (text, color). Centred block of text."""
        self.scr.clear()     # full repaint: menus replace the whole screen
        rows, cols = self.size()
        top = max(0, (rows - len(lines) - 2) // 2)
        width = max((len(t) for t, _ in lines), default=0)
        left = max(0, (cols - width) // 2)
        for i, (text, color) in enumerate(lines):
            self.put(top + i, left, text, color)
        if footer:
            self.put(min(rows - 1, top + len(lines) + 1), max(0, (cols - len(footer)) // 2),
                     footer, "dim")
        self.scr.refresh()
        return self.get_key()


HELP_LINES = [
    ("NIGHT SHIFT - controls", "title"),
    ("", "normal"),
    ("Arrows / WASD    move, or bump into things to hit them", "normal"),
    ("Space / . / z    wait a turn", "normal"),
    ("E / >            take the lift (when standing on it)", "normal"),
    ("1-9              use an inventory item", "normal"),
    ("f                lash with the ethernet cable (reach 2)", "normal"),
    ("x                drop an item", "normal"),
    ("?                this help", "normal"),
    ("Q                quit (abandon shift)", "normal"),
    ("", "normal"),
    ("Survive each floor and take the lift. Each floor is one hour.", "info"),
    ("Reach 07:00 handover to win.", "info"),
]
