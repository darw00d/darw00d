"""The player and everything on the floor that wants them to log a ticket."""

from . import combat, config, flavour, mapgen


class Entity:
    glyph = "?"
    color = "normal"
    name = "thing"
    blocks = False

    def __init__(self, x, y):
        self.x = x
        self.y = y

    @property
    def pos(self):
        return (self.x, self.y)

    def distance_to(self, other):
        """Chebyshev distance."""
        return max(abs(self.x - other.x), abs(self.y - other.y))


class Actor(Entity):
    blocks = True
    max_hp = 1
    speed = 10

    def __init__(self, x, y):
        super().__init__(x, y)
        self.hp = self.max_hp
        self.energy = 0
        self.stunned = 0

    @property
    def alive(self):
        return self.hp > 0


class Player(Actor):
    glyph = "@"
    color = "player"
    name = "you"
    max_hp = config.PLAYER_HP
    speed = config.PLAYER_SPEED

    def __init__(self, x=0, y=0):
        super().__init__(x, y)
        self.caffeine = config.PLAYER_CAFFEINE
        self.max_caffeine = config.PLAYER_CAFFEINE
        self.sanity = config.PLAYER_SANITY
        self.max_sanity = config.PLAYER_SANITY
        self.inventory = []
        self.weapon = None
        self.tickets = 0
        self.kills = 0

    @property
    def melee_damage(self):
        return self.weapon.damage if self.weapon else (1, 3)

    @property
    def weapon_name(self):
        return self.weapon.name if self.weapon else "bare hands"


class Enemy(Actor):
    damage = (1, 2)
    reward = (1, 2)            # ticket closures when killed
    attack_kind = "hp"         # or "sanity"
    death_lines = ("The {name} is resolved.",)

    def __init__(self, x, y):
        super().__init__(x, y)
        self.awake = False

    # Hooks -------------------------------------------------------------
    def take_turn(self, game):
        pass

    def on_spot(self, game):
        pass

    def on_death(self, game):
        pass

    def observe(self, game):
        """Called once per player turn, before anyone acts."""

    def on_hit_by_player(self, game):
        pass

    def take_damage(self, game, amount):
        """Return the damage actually taken (lets bosses shrug things off)."""
        self.hp -= amount
        return amount

    # Shared behaviour ---------------------------------------------------
    def notice_player(self, game):
        if not self.awake and game.can_see(self):
            self.awake = True
            self.on_spot(game)
        return self.awake

    def adjacent_to_player(self, game):
        p = game.player
        return abs(self.x - p.x) + abs(self.y - p.y) == 1

    def chase(self, game):
        """Step downhill on the player-distance map."""
        dist = game.dist_map
        here = dist.get(self.pos, 999)
        options = []
        for dx, dy in ((0, -1), (0, 1), (-1, 0), (1, 0)):
            nx, ny = self.x + dx, self.y + dy
            d = dist.get((nx, ny))
            if d is not None and d < here and not game.blocked(nx, ny):
                options.append((d, nx, ny))
        if not options:
            return False
        best = min(o[0] for o in options)
        _, nx, ny = game.rng.choice([o for o in options if o[0] == best])
        self.x, self.y = nx, ny
        return True

    def wander(self, game):
        if game.rng.random() < 0.5:
            return
        dx, dy = game.rng.choice(((0, -1), (0, 1), (-1, 0), (1, 0)))
        nx, ny = self.x + dx, self.y + dy
        if game.gmap.walkable(nx, ny) and not game.blocked(nx, ny):
            self.x, self.y = nx, ny

    def melee(self, game, line=None):
        combat.enemy_attack(game, self, line)


class AngryUser(Enemy):
    """Chases relentlessly. Hurts your Sanity, not your Health."""
    glyph = "U"
    color = "angry"
    name = "Angry User"
    max_hp = 8
    speed = 11
    damage = (4, 8)
    reward = (2, 4)
    attack_kind = "sanity"
    death_lines = flavour.ANGRY_USER_DEATH

    def on_spot(self, game):
        game.log.add(game.rng.choice(flavour.ANGRY_USER_SPOT), "angry")

    def take_turn(self, game):
        if not self.notice_player(game):
            self.wander(game)
            return
        if self.adjacent_to_player(game):
            self.melee(game, game.rng.choice(flavour.ANGRY_USER_ATTACK))
        else:
            self.chase(game)


class RoguePrinter(Enemy):
    """Stationary. Fires paper jams that block the tiles around you."""
    glyph = "P"
    color = "printer"
    name = "Rogue Printer"
    max_hp = 10
    damage = (2, 3)
    reward = (3, 5)
    death_lines = flavour.PRINTER_DEATH
    fire_range = 7
    reload = 3

    def __init__(self, x, y):
        super().__init__(x, y)
        self.cooldown = 1

    def on_spot(self, game):
        game.log.add(game.rng.choice(flavour.PRINTER_SPOT), "printer")

    def on_hit_by_player(self, game):
        if game.rng.random() < 0.3:
            game.log.add(game.rng.choice(flavour.PRINTER_SHOCK) + " (-2 HP)", "bad")
            combat.hurt_player(game, 2, self.name)

    def take_turn(self, game):
        if not self.notice_player(game):
            return
        if self.adjacent_to_player(game):
            self.melee(game, "The Rogue Printer grabs your lanyard and feeds it through.")
            return
        self.cooldown -= 1
        p = game.player
        if (self.cooldown <= 0 and self.distance_to(p) <= self.fire_range
                and mapgen.has_los(game.gmap, self.x, self.y, p.x, p.y)):
            self.cooldown = self.reload
            self.fire(game)

    def fire(self, game):
        p = game.player
        path = mapgen.line(self.x, self.y, p.x, p.y)[1:-1]
        target = path[-1] if path else None
        if target is None or game.blocked(*target):
            free = [(p.x + dx, p.y + dy) for dx, dy in mapgen.DIRS
                    if not game.blocked(p.x + dx, p.y + dy)]
            target = game.rng.choice(free) if free else None
        game.log.add(game.rng.choice(flavour.PRINTER_FIRE), "printer")
        if target and len(game.gmap.jams) < 30:
            game.gmap.jams[target] = game.rng.randint(15, 25)
        if game.rng.random() < 0.4:
            game.log.add("A sheet of A4 catches you edge-first. Papercut. (-1 HP)", "bad")
            combat.hurt_player(game, 1, "a papercut from a Rogue Printer")


class ExpiredCert(Enemy):
    """Weak, but once it notices you it keeps renewing itself."""
    glyph = "c"
    color = "cert"
    name = "Expired Cert"
    max_hp = 3
    speed = 9
    damage = (1, 2)
    reward = (1, 1)
    death_lines = flavour.CERT_DEATH
    split_every = 6
    max_certs = 12

    def __init__(self, x, y):
        super().__init__(x, y)
        self.timer = self.split_every

    def on_spot(self, game):
        game.log.add(game.rng.choice(flavour.CERT_SPOT), "cert")

    def take_turn(self, game):
        if not self.notice_player(game):
            self.wander(game)
            return
        self.timer -= 1
        if self.timer <= 0:
            self.timer = self.split_every
            if self.split(game):
                return
        if self.adjacent_to_player(game):
            self.melee(game, "The Expired Cert throws a security warning at you.")
        else:
            self.chase(game)

    def split(self, game):
        if sum(isinstance(e, ExpiredCert) for e in game.enemies) >= self.max_certs:
            return False
        spots = [(self.x + dx, self.y + dy) for dx, dy in mapgen.DIRS
                 if not game.blocked(self.x + dx, self.y + dy)]
        if not spots:
            return False
        child = ExpiredCert(*game.rng.choice(spots))
        child.awake = True
        child.energy = -config.ACTION_COST
        game.enemies.append(child)
        if game.can_see(self):
            game.log.add(game.rng.choice(flavour.CERT_SPLIT), "cert")
        return True


class PhishingEmail(Enemy):
    """Sits still pretending to be loot until you get close."""
    color = "phish"
    max_hp = 6
    speed = 10
    damage = (2, 4)
    reward = (2, 3)
    death_lines = flavour.PHISH_DEATH
    reveal_range = 2

    def __init__(self, x, y, disguise):
        super().__init__(x, y)
        self.disguise = disguise          # (glyph, color, description)
        self.disguised = True
        self.stolen = 0

    @property
    def glyph(self):
        return self.disguise[0] if self.disguised else "e"

    @property
    def color(self):
        return self.disguise[1] if self.disguised else "phish"

    @property
    def name(self):
        return self.disguise[2] if self.disguised else "Phishing Email"

    def take_damage(self, game, amount):
        if self.disguised:
            self.reveal(game)
        return super().take_damage(game, amount)

    def observe(self, game):
        if self.disguised and game.can_see(self) and self.distance_to(game.player) <= self.reveal_range:
            self.reveal(game)

    def reveal(self, game):
        text = game.rng.choice(flavour.PHISH_REVEAL).format(disguise=self.disguise[2][2:])
        self.disguised = False
        self.awake = True
        game.log.add(text, "phish")

    def take_turn(self, game):
        if self.disguised:
            return
        if self.adjacent_to_player(game):
            self.melee(game, game.rng.choice(flavour.PHISH_ATTACK))
            stolen = min(game.player.tickets, game.rng.randint(2, 5))
            if stolen and game.player.alive:
                game.player.tickets -= stolen
                self.stolen += stolen
                game.log.add(f"It makes off with {stolen} of your ticket closures.", "bad")
        else:
            self.chase(game)

    def on_death(self, game):
        if self.stolen:
            game.player.tickets += self.stolen
            game.log.add(f"You recover {self.stolen} stolen ticket closures.", "good")
