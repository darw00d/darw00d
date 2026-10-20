"""Game state and the turn loop. Contains no curses code, so it can be tested
headlessly and replayed from a seed."""

import random

from . import combat, config, entities, flavour, mapgen


class MessageLog:
    def __init__(self, limit=200):
        self.messages = []    # [text, color, count, turn]
        self.limit = limit
        self.turn = 0

    def add(self, text, color="normal"):
        if self.messages and self.messages[-1][0] == text:
            self.messages[-1][2] += 1
            self.messages[-1][3] = self.turn
        else:
            self.messages.append([text, color, 1, self.turn])
            del self.messages[:-self.limit]

    def recent(self, n):
        return self.messages[-n:]


class Game:
    def __init__(self, seed=None, start_floor=1):
        self.seed = seed if seed is not None else random.randrange(1, 10**6)
        self.rng = random.Random(self.seed)
        self.player = entities.Player()
        self.log = MessageLog()
        self.floor = start_floor
        self.turn = 0
        self.state = "playing"      # playing | floor_done | dead | won
        self.cause = None           # (source, kind) when dead
        self.enemies = []
        self.visible = set()
        self.dist_map = {}
        self.current_room = None
        self.new_floor()

    # ------------------------------------------------------------ floors
    @property
    def is_boss_floor(self):
        return self.floor == config.TOTAL_FLOORS

    @property
    def clock(self):
        hour = (config.START_HOUR + self.floor - 1) % 24
        if self.state == "won":
            return "07:00"
        minute = min(59, self.floor_turns // 4)
        return f"{hour:02d}:{minute:02d}"

    def new_floor(self):
        self.gmap = mapgen.generate_floor(self.seed, self.floor, boss=self.is_boss_floor)
        self.player.x, self.player.y = self.gmap.start
        self.enemies = []
        self.floor_turns = 0
        self.current_room = None
        self.state = "playing"
        self.populate()
        self.log.add(self.rng.choice(flavour.FLOOR_INTROS).format(floor=self.floor), "info")
        self.update_view()

    def populate(self):
        frng = random.Random(f"{self.seed}:spawn:{self.floor}")
        count = 2 + self.floor // 2
        for _ in range(count):
            pos = self.random_spawn_tile(frng)
            if pos:
                self.enemies.append(entities.AngryUser(*pos))

    def random_spawn_tile(self, rng, min_dist=7):
        start_room = self.gmap.room_at(*self.gmap.start)
        candidates = []
        for room in self.gmap.rooms:
            if room is start_room or room is self.gmap.locked_room:
                continue
            for x, y in room.interior():
                if (self.gmap.tile(x, y) == mapgen.FLOOR and not self.blocked(x, y)
                        and abs(x - self.player.x) + abs(y - self.player.y) >= min_dist):
                    candidates.append((x, y))
        return rng.choice(candidates) if candidates else None

    # ------------------------------------------------------------ queries
    def enemy_at(self, x, y):
        for e in self.enemies:
            if e.x == x and e.y == y:
                return e
        return None

    def blocked(self, x, y):
        if not self.gmap.walkable(x, y):
            return True
        if (x, y) == self.player.pos:
            return True
        return self.enemy_at(x, y) is not None

    def can_see(self, entity):
        return entity.pos in self.visible

    # ------------------------------------------------------------ player actions
    # Each returns True if it used up the player's turn.
    def move_player(self, dx, dy):
        if self.state != "playing":
            return False
        p = self.player
        nx, ny = p.x + dx, p.y + dy
        enemy = self.enemy_at(nx, ny)
        if enemy:
            combat.player_melee(self, enemy)
            return self.end_turn()
        tile = self.gmap.tile(nx, ny)
        if not self.gmap.walkable(nx, ny):
            if tile == mapgen.LOCKED:
                self.log.add("The door is locked. A keypad blinks: 'ADMIN ONLY'.")
            else:
                return False
            return False
        p.x, p.y = nx, ny
        if tile == mapgen.LIFT:
            self.log.add("You're at the lift. Press E (or >) to head down.", "info")
        return self.end_turn()

    def wait(self):
        if self.state != "playing":
            return False
        if self.rng.random() < 0.15:
            self.log.add(self.rng.choice(flavour.WAIT), "dim")
        return self.end_turn()

    def take_lift(self):
        if self.state != "playing":
            return False
        if self.player.pos != self.gmap.lift:
            self.log.add("There's no lift here. Just carpet, and regret.")
            return False
        self.log.add("The lift doors close. Another hour gone.", "info")
        self.state = "floor_done"
        return True

    def next_floor(self):
        """Called by the UI after any between-floor screens."""
        self.floor += 1
        self.new_floor()

    # ------------------------------------------------------------ turn loop
    def action_cost(self):
        return config.ACTION_COST

    def end_turn(self):
        self.turn += 1
        self.floor_turns += 1
        self.log.turn = self.turn
        p = self.player
        p.energy -= self.action_cost()
        self.update_view()
        self.dist_map = self.gmap.distances_from(p.x, p.y)
        while p.energy < 0 and self.state == "playing":
            p.energy += p.speed
            for enemy in list(self.enemies):
                if enemy not in self.enemies:
                    continue
                enemy.energy += enemy.speed
                while enemy.energy >= 0 and enemy in self.enemies and self.state == "playing":
                    enemy.energy -= config.ACTION_COST
                    if enemy.stunned:
                        enemy.stunned -= 1
                    else:
                        enemy.take_turn(self)
        self.update_view()
        return True

    def update_view(self):
        p = self.player
        self.visible = mapgen.compute_fov(self.gmap, p.x, p.y)
        for x, y in self.visible:
            self.gmap.explored[y][x] = True
        room = self.gmap.room_at(p.x, p.y)
        if room is not None and room is not self.current_room:
            lines = flavour.ROOM_ENTRY.get(room.kind)
            if lines and self.rng.random() < 0.6:
                self.log.add(self.rng.choice(lines), "dim")
        self.current_room = room

    def player_died(self, source, kind):
        self.state = "dead"
        self.cause = (source, kind)
