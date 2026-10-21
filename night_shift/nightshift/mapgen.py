"""Procedural office floors: rooms, corridors, furniture and field of view.

Every floor is generated from its own RNG derived from the run seed and the
floor number, so a seed always produces the same building no matter what the
player did on earlier floors.
"""

from collections import deque
from dataclasses import dataclass

from . import config, seeding

# Tile glyphs double as tile types.
WALL = "#"
FLOOR = "."
DOOR = "+"
LOCKED = "L"   # locked door, drawn as a red '+'
LIFT = ">"
DESK = "="
RACK = "|"

WALKABLE = {FLOOR, DOOR, LIFT}
OPAQUE = {WALL, RACK, LOCKED}

TILE_NAMES = {
    WALL: "wall",
    FLOOR: "carpet tile",
    DOOR: "door",
    LOCKED: "locked door",
    LIFT: "lift",
    DESK: "desk",
    RACK: "server rack",
}

DIRS = ((0, -1), (0, 1), (-1, 0), (1, 0))

# Outer sizes include walls.
ROOM_KINDS = {
    "openplan": {"w": (11, 17), "h": (7, 10), "weight": 3, "name": "open-plan office"},
    "server": {"w": (8, 13), "h": (6, 9), "weight": 2, "name": "server room"},
    "comms": {"w": (4, 6), "h": (4, 5), "weight": 2, "name": "comms cupboard"},
    "meeting": {"w": (6, 9), "h": (5, 7), "weight": 2, "name": "meeting room"},
    "kitchen": {"w": (6, 8), "h": (5, 6), "weight": 1, "name": "kitchenette"},
}

ROOM_NAMES = {k: v["name"] for k, v in ROOM_KINDS.items()}
ROOM_NAMES["supply"] = "supply cupboard"
ROOM_NAMES["hall"] = "data hall"


@dataclass
class Room:
    x: int
    y: int
    w: int
    h: int
    kind: str

    # Interior bounds, inclusive.
    @property
    def x1(self):
        return self.x + 1

    @property
    def y1(self):
        return self.y + 1

    @property
    def x2(self):
        return self.x + self.w - 2

    @property
    def y2(self):
        return self.y + self.h - 2

    @property
    def center(self):
        return ((self.x1 + self.x2) // 2, (self.y1 + self.y2) // 2)

    @property
    def name(self):
        return ROOM_NAMES[self.kind]

    def contains(self, x, y):
        return self.x1 <= x <= self.x2 and self.y1 <= y <= self.y2

    def interior(self):
        for y in range(self.y1, self.y2 + 1):
            for x in range(self.x1, self.x2 + 1):
                yield x, y

    def rim(self):
        for x in range(self.x, self.x + self.w):
            yield x, self.y
            yield x, self.y + self.h - 1
        for y in range(self.y + 1, self.y + self.h - 1):
            yield self.x, y
            yield self.x + self.w - 1, y

    def intersects(self, other, margin=1):
        return (self.x - margin < other.x + other.w and other.x - margin < self.x + self.w
                and self.y - margin < other.y + other.h and other.y - margin < self.y + self.h)


class GameMap:
    def __init__(self, width, height):
        self.width = width
        self.height = height
        self.tiles = [[WALL] * width for _ in range(height)]
        self.explored = [[False] * width for _ in range(height)]
        self.rooms = []
        self.jams = {}        # (x, y) -> turns until the paper jam clears itself
        self.start = (1, 1)
        self.lift = None
        self.locked_room = None

    def in_bounds(self, x, y):
        return 0 <= x < self.width and 0 <= y < self.height

    def tile(self, x, y):
        return self.tiles[y][x] if self.in_bounds(x, y) else WALL

    def set(self, x, y, t):
        self.tiles[y][x] = t

    def walkable(self, x, y):
        return self.tile(x, y) in WALKABLE and (x, y) not in self.jams

    def transparent(self, x, y):
        return self.tile(x, y) not in OPAQUE

    def room_at(self, x, y):
        for room in self.rooms:
            if room.contains(x, y):
                return room
        return None

    def distances_from(self, x, y, through_locked=False):
        """BFS step distances over walkable tiles (ignores monsters).

        Works on flat int lists rather than a dict of tuples: this runs every
        turn, and tuple-keyed dicts are slow under Brython (the web build)."""
        w, h, tiles, jams = self.width, self.height, self.tiles, self.jams
        d = [-1] * (w * h)
        start = y * w + x
        order = [start]
        d[start] = 0
        i = 0
        while i < len(order):
            cur = order[i]
            i += 1
            cy, cx = divmod(cur, w)
            nd = d[cur] + 1
            for dx, dy in DIRS:
                nx, ny = cx + dx, cy + dy
                if 0 <= nx < w and 0 <= ny < h:
                    ni = ny * w + nx
                    if d[ni] < 0:
                        t = tiles[ny][nx]
                        if ((t in WALKABLE and not (jams and (nx, ny) in jams))
                                or (through_locked and t == LOCKED)):
                            d[ni] = nd
                            order.append(ni)
        return DistMap(w, h, d, order)


class DistMap:
    """Read-only {(x, y): steps} view over a flat BFS result."""

    __slots__ = ("w", "h", "d", "order")

    def __init__(self, w, h, d, order):
        self.w, self.h, self.d, self.order = w, h, d, order

    def get(self, pos, default=None):
        x, y = pos
        if 0 <= x < self.w and 0 <= y < self.h:
            v = self.d[y * self.w + x]
            if v >= 0:
                return v
        return default

    def __contains__(self, pos):
        return self.get(pos) is not None

    def __getitem__(self, pos):
        v = self.get(pos)
        if v is None:
            raise KeyError(pos)
        return v

    def __len__(self):
        return len(self.order)

    def __iter__(self):
        return iter(self.keys())

    def keys(self):
        w = self.w
        return [(i % w, i // w) for i in self.order]

    def items(self):
        return [(pos, self[pos]) for pos in self.keys()]


def _bresenham(x0, y0, x1, y1):
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    while True:
        yield x0, y0
        if x0 == x1 and y0 == y1:
            return
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy


def line(x0, y0, x1, y1):
    return list(_bresenham(x0, y0, x1, y1))


def compute_fov(gmap, ox, oy, radius=config.FOV_RADIUS):
    """Ray-cast field of view. Returns a set of visible (x, y)."""
    visible = {(ox, oy)}
    r2 = radius * radius + radius
    edge = []
    for t in range(-radius, radius + 1):
        edge += [(ox + t, oy - radius), (ox + t, oy + radius),
                 (ox - radius, oy + t), (ox + radius, oy + t)]
    for tx, ty in edge:
        for x, y in _bresenham(ox, oy, tx, ty):
            if not gmap.in_bounds(x, y) or (x - ox) ** 2 + (y - oy) ** 2 > r2:
                break
            visible.add((x, y))
            if not gmap.transparent(x, y) and (x, y) != (ox, oy):
                break
    # Light up walls bordering what we can see, so rooms look like rooms.
    extra = set()
    for x, y in visible:
        if gmap.transparent(x, y):
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    nx, ny = x + dx, y + dy
                    if gmap.in_bounds(nx, ny) and not gmap.transparent(nx, ny):
                        extra.add((nx, ny))
    return visible | extra


def has_los(gmap, x0, y0, x1, y1):
    for x, y in _bresenham(x0, y0, x1, y1):
        if (x, y) not in ((x0, y0), (x1, y1)) and not gmap.transparent(x, y):
            return False
    return True


# --------------------------------------------------------------------------- generation

def generate_floor(seed, floor, boss=False, locked_room=True):
    rng = seeding.rng(seed, "map", floor)
    for _ in range(200):
        gmap = _generate_boss(rng) if boss else _generate(rng, locked_room)
        if gmap is not None:
            return gmap
    raise RuntimeError("could not generate a floor (the architects are on strike)")


def _carve_room(gmap, room):
    for x, y in room.interior():
        gmap.set(x, y, FLOOR)


def _carve_corridor(gmap, rng, a, b):
    (x1, y1), (x2, y2) = a, b
    if rng.random() < 0.5:
        path = [(x, y1) for x in _span(x1, x2)] + [(x2, y) for y in _span(y1, y2)]
    else:
        path = [(x1, y) for y in _span(y1, y2)] + [(x, y2) for x in _span(x1, x2)]
    for x, y in path:
        if gmap.tile(x, y) == WALL and 0 < x < gmap.width - 1 and 0 < y < gmap.height - 1:
            gmap.set(x, y, FLOOR)


def _span(a, b):
    step = 1 if b >= a else -1
    return range(a, b + step, step)


def _place_doors(gmap):
    for room in gmap.rooms:
        for x, y in room.rim():
            if gmap.tile(x, y) != FLOOR:
                continue
            horiz = gmap.tile(x - 1, y) == WALL and gmap.tile(x + 1, y) == WALL
            vert = gmap.tile(x, y - 1) == WALL and gmap.tile(x, y + 1) == WALL
            if room.kind == "supply":
                gmap.set(x, y, LOCKED)
            elif horiz or vert:
                gmap.set(x, y, DOOR)


def _furnish(gmap, rng, room):
    """Furniture only goes 2+ tiles from the walls, so the room's inner ring
    always stays clear and every door stays connected."""
    ix1, iy1, ix2, iy2 = room.x1 + 1, room.y1 + 1, room.x2 - 1, room.y2 - 1
    if ix1 > ix2 or iy1 > iy2:
        return
    if room.kind == "openplan":
        for y in range(iy1, iy2 + 1, 2):
            x = ix1
            while x <= ix2:
                run = rng.randint(2, 4)
                for dx in range(run):
                    if x + dx <= ix2:
                        gmap.set(x + dx, y, DESK)
                x += run + rng.randint(1, 2)
    elif room.kind == "server":
        for x in range(ix1, ix2 + 1, 2):
            gap = rng.randint(iy1, iy2) if iy2 - iy1 >= 3 else None
            for y in range(iy1, iy2 + 1):
                if y != gap:
                    gmap.set(x, y, RACK)
    elif room.kind == "meeting":
        for x in range(ix1, ix2 + 1):
            for y in range(iy1, iy2 + 1):
                gmap.set(x, y, DESK)
    elif room.kind == "hall":
        for x in range(ix1 + 1, ix2, 4):
            for y in range(iy1 + 1, iy2, 4):
                if (x, y) != room.center and abs(x - room.center[0]) + abs(y - room.center[1]) > 3:
                    gmap.set(x, y, RACK)


def _place_rooms(gmap, rng, target, existing=()):
    rooms = list(existing)
    kinds = list(ROOM_KINDS)
    weights = [ROOM_KINDS[k]["weight"] for k in kinds]
    for _ in range(400):
        if len(rooms) >= target:
            break
        kind = rng.choices(kinds, weights)[0]
        spec = ROOM_KINDS[kind]
        w, h = rng.randint(*spec["w"]), rng.randint(*spec["h"])
        x = rng.randint(1, gmap.width - w - 1)
        y = rng.randint(1, gmap.height - h - 1)
        room = Room(x, y, w, h, kind)
        if not any(room.intersects(r) for r in rooms):
            rooms.append(room)
    return rooms


def _free_tile(gmap, rng, room, avoid_doors=True):
    tiles = [(x, y) for x, y in room.interior() if gmap.tile(x, y) == FLOOR]
    if avoid_doors:
        tiles = [(x, y) for x, y in tiles
                 if not any(gmap.tile(x + dx, y + dy) in (DOOR, LOCKED) for dx, dy in DIRS)] or tiles
    return rng.choice(tiles) if tiles else None


def _generate(rng, want_locked):
    gmap = GameMap(config.MAP_W, config.MAP_H)
    rooms = _place_rooms(gmap, rng, rng.randint(9, 13))
    if len(rooms) < 7:
        return None

    locked = None
    if want_locked:
        cupboards = [r for r in rooms if r.kind == "comms"]
        if cupboards:
            locked = rng.choice(cupboards)
            locked.kind = "supply"
    main = [r for r in rooms if r is not locked]

    for room in rooms:
        _carve_room(gmap, room)
    chain = sorted(main, key=lambda r: r.center)
    for a, b in zip(chain, chain[1:]):
        _carve_corridor(gmap, rng, a.center, b.center)
    for _ in range(rng.randint(1, 3)):
        a, b = rng.sample(main, 2)
        _carve_corridor(gmap, rng, a.center, b.center)
    if locked:
        nearest = min(main, key=lambda r: abs(r.center[0] - locked.center[0])
                      + abs(r.center[1] - locked.center[1]))
        _carve_corridor(gmap, rng, locked.center, nearest.center)

    gmap.rooms = rooms
    gmap.locked_room = locked
    _place_doors(gmap)
    for room in rooms:
        _furnish(gmap, rng, room)

    start_room = rng.choice([r for r in main if r.kind != "comms"] or main)
    gmap.start = _free_tile(gmap, rng, start_room)
    dist = gmap.distances_from(*gmap.start)

    # Every room other than the locked one must be reachable without a key,
    # and the locked room must actually be locked (only reachable through 'L').
    for room in main:
        if not any(p in dist for p in room.interior()):
            return None
    if locked:
        if any(p in dist for p in locked.interior()):
            return None
        if not any(gmap.tile(x, y) == LOCKED for x, y in locked.rim()):
            return None
        full = gmap.distances_from(*gmap.start, through_locked=True)
        if not any(p in full for p in locked.interior()):
            return None

    far_room = max((r for r in main if r is not start_room),
                   key=lambda r: dist.get(r.center, max((dist.get(p, 0) for p in r.interior()))))
    gmap.lift = _free_tile(gmap, rng, far_room)
    if gmap.lift is None or gmap.lift not in dist:
        return None
    gmap.set(*gmap.lift, LIFT)
    return gmap


def _generate_boss(rng):
    gmap = GameMap(config.MAP_W, config.MAP_H)
    hw, hh = rng.randint(30, 36), rng.randint(16, 19)
    hall = Room((gmap.width - hw) // 2, (gmap.height - hh) // 2, hw, hh, "hall")
    rooms = _place_rooms(gmap, rng, 6, existing=[hall])
    if len(rooms) < 4:
        return None
    for room in rooms:
        _carve_room(gmap, room)
    others = [r for r in rooms if r is not hall]
    for room in others:
        _carve_corridor(gmap, rng, room.center, hall.center)
    gmap.rooms = rooms
    _place_doors(gmap)
    for room in rooms:
        _furnish(gmap, rng, room)
    start_room = max(others, key=lambda r: abs(r.center[0] - hall.center[0])
                     + abs(r.center[1] - hall.center[1]))
    gmap.start = _free_tile(gmap, rng, start_room)
    dist = gmap.distances_from(*gmap.start)
    if hall.center not in dist or gmap.tile(*hall.center) != FLOOR:
        return None
    return gmap
