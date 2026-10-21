"""Loot: what it is, what it does, and where it turns up."""

from . import combat, mapgen, seeding

PASSWORDS = ["Adm1n!2019", "Summer2024!", "Password123", "Welcome1", "letmein", "Qwerty!23"]


class Item:
    """An item type. Instances are copied per pickup so charges are per-item."""

    def __init__(self, key, name, glyph, color, price, desc, charges=None, needs_direction=False,
                 damage=None):
        self.key = key
        self.name = name
        self.glyph = glyph
        self.color = color
        self.price = price
        self.desc = desc
        self.charges = charges
        self.needs_direction = needs_direction
        self.damage = damage       # melee damage range, for weapons

    def copy(self):
        return Item(self.key, self.name, self.glyph, self.color, self.price, self.desc,
                    self.charges, self.needs_direction, self.damage)

    @property
    def label(self):
        return f"{self.name} ({self.charges})" if self.charges is not None else self.name


CATALOGUE = {
    "coffee": Item("coffee", "Coffee", "!", "coffee", 3, "+35 Caffeine. Tastes of burnt beans."),
    "energy": Item("energy", "Energy drink", "!", "item", 5,
                   "+60 Caffeine and Wired for 20 turns. Then you crash."),
    "meal": Item("meal", "Meal deal", ",", "good", 6, "+12 Health. Sandwich, crisps, regret."),
    "stress": Item("stress", "Stress ball", "*", "info", 5, "+20 Sanity. Squeeze firmly."),
    "password": Item("password", "Admin password", "?", "warn", 8,
                     "A sticky note. Opens a locked supply cupboard."),
    "cable": Item("cable", "Ethernet cable", ")", "item", 12,
                  "Weapon: 2-5 melee. Press f to lash enemies 2 tiles away.", damage=(2, 5)),
    "labeller": Item("labeller", "Label maker", ")", "info", 10,
                     "Ranged: 3-6 damage + stun, range 8.", charges=5, needs_direction=True),
    "extinguisher": Item("extinguisher", "Extinguisher", ")", "bad", 14,
                         "Blasts everything within 2 tiles: 4-7 damage, stuns, clears jams.",
                         charges=3),
}


def make(key):
    return CATALOGUE[key].copy()


class FloorItem:
    """An item (or a pile of ticket closures) lying on the carpet."""

    def __init__(self, x, y, item=None, tickets=0):
        self.x, self.y = x, y
        self.item = item
        self.tickets = tickets

    @property
    def pos(self):
        return (self.x, self.y)

    @property
    def glyph(self):
        return self.item.glyph if self.item else "$"

    @property
    def color(self):
        return self.item.color if self.item else "money"

    @property
    def name(self):
        return self.item.name if self.item else f"{self.tickets} ticket closures"


# --------------------------------------------------------------------------- using items

def use(game, item, direction=None):
    """Apply an inventory item. Returns True if it took a turn."""
    p = game.player
    log = game.log
    k = item.key
    if k == "coffee":
        p.caffeine = min(p.max_caffeine, p.caffeine + 35)
        p.sanity = min(p.max_sanity, p.sanity + 2)
        log.add("You drink the coffee. It's been on the hotplate since Tuesday. Bliss.", "coffee")
    elif k == "energy":
        p.caffeine = min(p.max_caffeine, p.caffeine + 60)
        p.wired = 20
        log.add("You neck the energy drink. You can hear colours. (Wired!)", "item")
    elif k == "meal":
        p.hp = min(p.max_hp, p.hp + 12)
        log.add("You eat the meal deal. The crisps were the best part, as always.", "good")
    elif k == "stress":
        p.sanity = min(p.max_sanity, p.sanity + 20)
        log.add("You squeeze the stress ball until it squeaks for mercy. Better.", "info")
    elif k == "password":
        log.add(f"The sticky note says '{game.rng.choice(PASSWORDS)}'. Find a locked door.")
        return False
    elif k == "cable":
        p.inventory.remove(item)
        if p.weapon:
            p.inventory.append(p.weapon)
        p.weapon = item
        log.add("You wrap the ethernet cable around your fist. Cat6. Shielded. Ready.", "item")
        return True
    elif k == "labeller":
        fire_labeller(game, item, direction)
    elif k == "extinguisher":
        blast_extinguisher(game, item)
    if item.charges is None:
        p.inventory.remove(item)
    elif item.charges <= 0:
        p.inventory.remove(item)
        log.add(f"The {item.name.lower()} is empty. You bin it.", "dim")
    return True


def first_enemy_in_line(game, direction, reach):
    dx, dy = direction
    x, y = game.player.pos
    for _ in range(reach):
        x, y = x + dx, y + dy
        enemy = game.enemy_at(x, y)
        if enemy:
            return enemy
        if not game.gmap.transparent(x, y) or not game.gmap.walkable(x, y):
            return None
    return None


def fire_labeller(game, item, direction):
    item.charges -= 1
    enemy = first_enemy_in_line(game, direction, 8)
    if not enemy:
        game.log.add("You fire a label into the void. It reads 'NOT MY PROBLEM'.", "dim")
        return
    label = game.rng.choice(["OUT OF ORDER", "DO NOT TOUCH", "PROPERTY OF IT", "DECOMMISSIONED"])
    dmg = game.rng.randint(3, 6)
    game.log.add(f"You label the {enemy.name} '{label}'. It's confused. ({dmg})", "info")
    if not combat.damage_enemy(game, enemy, dmg):
        enemy.stunned = max(enemy.stunned, 1)


def blast_extinguisher(game, item):
    item.charges -= 1
    p = game.player
    game.log.add("WHOOSH. You empty a cloud of CO2 over everything nearby.", "info")
    hit = 0
    for enemy in list(game.enemies):
        if enemy.distance_to(p) <= 2:
            hit += 1
            dmg = game.rng.randint(4, 7)
            if not combat.damage_enemy(game, enemy, dmg):
                enemy.stunned = max(enemy.stunned, 2)
    for pos in list(game.gmap.jams):
        if max(abs(pos[0] - p.x), abs(pos[1] - p.y)) <= 2:
            del game.gmap.jams[pos]
    if not hit:
        game.log.add("Nothing was on fire. Facilities will be thrilled.", "dim")


def lash(game, direction):
    """Ethernet cable whip: reach 2 in a straight line."""
    enemy = first_enemy_in_line(game, direction, 2)
    if not enemy:
        game.log.add("You crack the ethernet cable at nothing. Very intimidating.", "dim")
        return
    dmg = game.rng.randint(*game.player.weapon.damage)
    game.log.add(f"You lash the {enemy.name} with the cable. Snap! ({dmg})")
    if not combat.damage_enemy(game, enemy, dmg):
        enemy.on_hit_by_player(game)


# --------------------------------------------------------------------------- placement

def scatter(gmap, seed, floor, occupied):
    """Return FloorItems for a new floor. `occupied` is a set of blocked positions."""
    rng = seeding.rng(seed, "items", floor)
    out = []
    taken = set(occupied) | {gmap.start, gmap.lift}
    boss = gmap.lift is None

    def spot(rooms):
        tiles = [p for r in rooms for p in r.interior()
                 if gmap.tile(*p) == mapgen.FLOOR and p not in taken]
        if not tiles:
            return None
        p = rng.choice(tiles)
        taken.add(p)
        return p

    open_rooms = [r for r in gmap.rooms if r is not gmap.locked_room]

    def drop(rooms, item=None, tickets=0):
        p = spot(rooms)
        if p:
            out.append(FloorItem(*p, item=item, tickets=tickets))

    consumables = ["coffee", "energy", "meal", "stress"]
    for _ in range(rng.randint(6, 8) if boss else rng.randint(3, 5)):
        drop(open_rooms, make(rng.choices(consumables, [4, 2, 2, 2])[0]))
    for room in open_rooms:
        if room.kind == "kitchen":
            for _ in range(rng.randint(1, 2)):
                drop([room], make("coffee"))
    for _ in range(rng.randint(2, 3)):
        drop(open_rooms, tickets=rng.randint(2, 5))

    comms = [r for r in open_rooms if r.kind == "comms"] or open_rooms
    if floor == 1 or rng.random() < 0.3:
        drop(comms, make("cable"))
    if rng.random() < 0.3:
        drop(open_rooms, make("labeller"))
    if rng.random() < 0.2:
        drop(open_rooms, make("extinguisher"))

    if gmap.locked_room:
        drop([r for r in open_rooms if r.kind != "comms"] or open_rooms, make("password"))
        loot = ["extinguisher", "labeller", "energy", "meal", "stress"]
        for key in rng.sample(loot, 2):
            drop([gmap.locked_room], make(key))
        drop([gmap.locked_room], tickets=rng.randint(8, 12))
    return out
