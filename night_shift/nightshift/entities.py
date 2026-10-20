"""The player and everything on the floor that wants them to log a ticket."""

from . import combat, config, flavour


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
