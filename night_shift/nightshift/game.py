"""Game state and the turn loop. Contains no curses code, so it can be tested
headlessly and replayed from a seed."""

import random

from . import combat, config, entities, flavour, items, mapgen, seeding


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
        self.start_floor = start_floor
        self.turn = 0
        self.state = "playing"      # playing | floor_done | dead | won
        self.cause = None           # (source, kind) when dead
        self.enemies = []
        self.items = []
        self.visible = set()
        self._dist_map = None
        self.current_room = None
        self.phantom = None
        self.warned_sanity = False
        self.shop_closed = False    # set by the change-freeze event
        self.extra_angry = 0        # Angry Users owed to the next floor by events
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
        self.items = items.scatter(self.gmap, self.seed, self.floor,
                                   {e.pos for e in self.enemies})
        self.log.add(self.rng.choice(flavour.FLOOR_INTROS).format(floor=self.floor), "info")
        self.update_view()

    def populate(self):
        frng = seeding.rng(self.seed, "spawn", self.floor)
        if self.is_boss_floor:
            hall = next(r for r in self.gmap.rooms if r.kind == "hall")
            self.enemies.append(entities.ExchangeServer(*hall.center))
            for _ in range(2):
                pos = self.random_spawn_tile(frng)
                if pos:
                    self.enemies.append(entities.ExpiredCert(*pos))
            return
        count = 3 + self.floor // 2
        table = [(entities.AngryUser, 3), (entities.ExpiredCert, 3), (entities.RoguePrinter, 2)]
        if self.floor >= 2:
            table.append((entities.PhishingEmail, 2))
        kinds, weights = zip(*table)
        printers = 0
        for _ in range(count):
            kind = frng.choices(kinds, weights)[0]
            if kind is entities.RoguePrinter:
                printers += 1
                if printers > 2:
                    kind = entities.AngryUser
            pos = self.random_spawn_tile(frng)
            if not pos:
                continue
            if kind is entities.PhishingEmail:
                self.enemies.append(kind(*pos, frng.choice(flavour.PHISH_DISGUISES)))
            else:
                self.enemies.append(kind(*pos))
        for _ in range(self.extra_angry):
            pos = self.random_spawn_tile(frng)
            if pos:
                self.enemies.append(entities.AngryUser(*pos))
        self.extra_angry = 0

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

    def add_floor_item(self, pos, item):
        self.items.append(items.FloorItem(*pos, item=item))

    def boss_defeated(self):
        self.state = "won"
        self.log.add("07:00. The day shift wanders in, holding coffees. "
                     "'Quiet night?' they ask.", "good")

    @property
    def boss(self):
        return next((e for e in self.enemies if isinstance(e, entities.ExchangeServer)), None)

    def extra_glyphs(self):
        out = [self.phantom] if self.phantom else []
        boss = self.boss
        if boss:
            out += [(x, y, "*", "telegraph") for x, y in sorted(boss.marked)]
        return out

    def item_at(self, x, y):
        for it in self.items:
            if it.x == x and it.y == y:
                return it
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
        if (nx, ny) in self.gmap.jams:
            del self.gmap.jams[(nx, ny)]
            self.log.add(self.rng.choice(flavour.JAM_CLEAR))
            return self.end_turn()
        tile = self.gmap.tile(nx, ny)
        if not self.gmap.walkable(nx, ny):
            if tile == mapgen.LOCKED:
                return self.try_unlock(nx, ny)
            return False
        p.x, p.y = nx, ny
        if tile == mapgen.LIFT:
            self.log.add("You're at the lift. Press E (or >) to head down.", "info")
        self.pick_up()
        return self.end_turn()

    def try_unlock(self, x, y):
        p = self.player
        note = next((i for i in p.inventory if i.key == "password"), None)
        if not note:
            self.log.add("The door is locked. A keypad blinks: 'ADMIN ONLY'. "
                         "Somebody must have the password written down...")
            return False
        p.inventory.remove(note)
        room = self.gmap.locked_room
        for rx, ry in (room.rim() if room else [(x, y)]):
            if self.gmap.tile(rx, ry) == mapgen.LOCKED:
                self.gmap.set(rx, ry, mapgen.DOOR)
        self.log.add(f"You type in '{self.rng.choice(items.PASSWORDS)}' from the sticky note. "
                     "It works. Of course it works.", "good")
        return self.end_turn()

    def pick_up(self):
        p = self.player
        it = self.item_at(p.x, p.y)
        if not it:
            return
        if it.item is None:
            p.tickets += it.tickets
            self.items.remove(it)
            self.log.add(f"You find {it.tickets} closed tickets someone forgot to claim. "
                         "Yours now.", "money")
        elif len(p.inventory) >= p.INVENTORY_SIZE:
            self.log.add(f"You see a {it.item.name.lower()}, but your pockets are full.", "warn")
        else:
            p.inventory.append(it.item)
            self.items.remove(it)
            self.log.add(f"You pick up the {it.item.label.lower()}. "
                         f"[{len(p.inventory)}] {it.item.desc}", it.item.color)

    def use_item(self, index, direction=None):
        if self.state != "playing" or not 0 <= index < len(self.player.inventory):
            return False
        if items.use(self, self.player.inventory[index], direction):
            return self.end_turn()
        return False

    def lash(self, direction):
        p = self.player
        if self.state != "playing":
            return False
        if not p.weapon or p.weapon.key != "cable":
            self.log.add("You need an ethernet cable equipped to lash things.")
            return False
        items.lash(self, direction)
        return self.end_turn()

    def drop_item(self, index):
        p = self.player
        if self.state != "playing" or not 0 <= index < len(p.inventory):
            return False
        if self.item_at(p.x, p.y) or self.gmap.tile(p.x, p.y) == mapgen.LIFT:
            self.log.add("There's already something here. Find a cleaner patch of carpet.")
            return False
        item = p.inventory.pop(index)
        self.items.append(items.FloorItem(p.x, p.y, item=item))
        self.log.add(f"You drop the {item.name.lower()}.")
        return self.end_turn()

    def wait(self):
        if self.state != "playing":
            return False
        if self.rng.random() < 0.05:
            self.log.add(self.rng.choice(flavour.WAIT), "dim")
        return self.end_turn()

    def take_lift(self):
        if self.state != "playing":
            return False
        if self.is_boss_floor:
            self.log.add("The lift is out of service. Something in the data hall has seen to that.")
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
        self.shop_closed = False
        self.new_floor()

    # ------------------------------------------------------------ turn loop
    def action_cost(self):
        if self.player.wired:
            return 70
        c = self.player.caffeine
        if c <= 0:
            return 180
        if c < 30:
            return 140
        return config.ACTION_COST

    def status_effects(self):
        p = self.player
        out = []
        boss = self.boss
        if boss and boss.awake:
            out.append((f"EXCHANGE {boss.hp}/{boss.max_hp} P{boss.phase}"
                        + (" SHIELD" if boss.shield else ""), "boss"))
        if p.wired:
            out.append((f"WIRED {p.wired}", "item"))
        if p.caffeine <= 0:
            out.append(("DECAF", "bad"))
        elif p.caffeine < 30:
            out.append(("SLUGGISH", "warn"))
        if p.sanity < 30:
            out.append(("HALLUCINATING", "phish"))
        return out

    def tick_player_stats(self):
        """Per-turn upkeep: caffeine, slow regen, sanity side effects."""
        p = self.player
        if p.wired:
            p.wired -= 1
            if not p.wired:
                p.caffeine = max(0, p.caffeine - 45)
                p.sanity = max(1, p.sanity - 8)
                self.log.add("The energy drink wears off. You crash. Hard. (-45 Caffeine, -8 Sanity)",
                             "bad")
        before = p.caffeine
        if self.turn % 3 == 0:
            p.caffeine = max(0, p.caffeine - 1)
        if before >= 30 > p.caffeine:
            self.log.add(flavour.CAFFEINE_LOW, "warn")
        if before > 0 == p.caffeine:
            self.log.add(flavour.CAFFEINE_OUT, "bad")
        if p.caffeine <= 0 and self.turn % 15 == 0:
            self.log.add("Caffeine withdrawal headache. (-1 HP)", "bad")
            combat.hurt_player(self, 1, "caffeine withdrawal")
        elif p.caffeine > 0 and self.turn % 15 == 0:
            p.hp = min(p.max_hp, p.hp + 1)
        if self.turn % 20 == 0:
            p.sanity = min(p.max_sanity, p.sanity + 1)
        self.phantom = None
        if p.sanity < 30:
            if not self.warned_sanity:
                self.log.add(flavour.SANITY_LOW, "phish")
                self.warned_sanity = True
            if self.rng.random() < 0.06:
                self.log.add(self.rng.choice(flavour.HALLUCINATIONS), "phish")
            if self.rng.random() < 0.15:
                spots = [pos for pos in self.visible
                         if self.gmap.tile(*pos) == mapgen.FLOOR and not self.blocked(*pos)]
                if spots:
                    x, y = self.rng.choice(sorted(spots))
                    self.phantom = (x, y, self.rng.choice("UPce"), "angry")
        else:
            self.warned_sanity = False

    def end_turn(self):
        self.turn += 1
        self.floor_turns += 1
        self.log.turn = self.turn
        p = self.player
        p.energy -= self.action_cost()
        for pos in list(self.gmap.jams):
            self.gmap.jams[pos] -= 1
            if self.gmap.jams[pos] <= 0:
                del self.gmap.jams[pos]
        self.update_view()
        self.tick_player_stats()
        for enemy in list(self.enemies):
            enemy.observe(self)
        self._dist_map = None       # computed on demand by chasing enemies
        while p.energy < 0 and self.state == "playing":
            p.energy += p.speed
            for enemy in list(self.enemies):
                if enemy not in self.enemies:
                    continue
                enemy.energy += enemy.speed
                while enemy.energy >= 0 and enemy in self.enemies and self.state == "playing":
                    enemy.energy -= config.ACTION_COST
                    if enemy.stunned and not enemy.stun_immune:
                        enemy.stunned -= 1
                    else:
                        enemy.take_turn(self)
        # The player hasn't moved since update_view() above, so the view still holds.
        self._dist_map = None
        return True

    @property
    def dist_map(self):
        """Steps from the player to every reachable tile, for chasing enemies."""
        if self._dist_map is None:
            self._dist_map = self.gmap.distances_from(*self.player.pos)
        return self._dist_map

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
