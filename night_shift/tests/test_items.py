from nightshift import entities, items, mapgen
from nightshift.game import Game


def fresh(seed=20):
    g = Game(seed=seed)
    g.enemies.clear()
    g.items.clear()
    g.update_view()
    return g


def open_dir(g):
    p = g.player
    for d in mapgen.DIRS:
        if g.gmap.walkable(p.x + d[0], p.y + d[1]) and not g.blocked(p.x + d[0], p.y + d[1]):
            return d
    raise AssertionError


def line_spot(g, d, n):
    """Tile n steps from the player in direction d, if the path is open."""
    p = g.player
    for i in range(1, n + 1):
        x, y = p.x + d[0] * i, p.y + d[1] * i
        if not g.gmap.walkable(x, y):
            return None
    return (x, y)


def find_line(g, n):
    for seed in range(20, 80):
        g = fresh(seed)
        for d in mapgen.DIRS:
            spot = line_spot(g, d, n)
            if spot:
                return g, d, spot
    raise AssertionError


def test_pickup_and_coffee():
    g = fresh()
    d = open_dir(g)
    p = g.player
    g.items.append(items.FloorItem(p.x + d[0], p.y + d[1], item=items.make("coffee")))
    g.move_player(*d)
    assert [i.key for i in p.inventory] == ["coffee"]
    p.caffeine = 10
    g.use_item(0)
    assert p.caffeine >= 44 and not p.inventory


def test_ticket_pile_pickup():
    g = fresh()
    d = open_dir(g)
    g.items.append(items.FloorItem(g.player.x + d[0], g.player.y + d[1], tickets=4))
    g.move_player(*d)
    assert g.player.tickets == 4 and not g.items


def test_full_inventory_leaves_item():
    g = fresh()
    p = g.player
    p.inventory = [items.make("coffee") for _ in range(p.INVENTORY_SIZE)]
    d = open_dir(g)
    g.items.append(items.FloorItem(p.x + d[0], p.y + d[1], item=items.make("meal")))
    g.move_player(*d)
    assert len(g.items) == 1


def test_energy_drink_boosts_then_crashes():
    g = fresh()
    p = g.player
    p.caffeine = 50
    p.inventory.append(items.make("energy"))
    g.use_item(0)
    assert p.wired and p.caffeine == 100
    assert g.action_cost() < 100
    for _ in range(25):
        g.wait()
    assert not p.wired and p.caffeine < 70 and p.sanity < 100


def test_cable_equip_and_lash_reach_two():
    g, d, spot = find_line(fresh(), 2)
    p = g.player
    p.inventory.append(items.make("cable"))
    g.use_item(0)
    assert p.weapon.key == "cable" and p.melee_damage == (2, 5)
    u = entities.AngryUser(*spot)
    u.hp = 2
    g.enemies.append(u)
    g.lash(d)
    assert u not in g.enemies


def test_labeller_ranged_uses_charges():
    g, d, spot = find_line(fresh(), 4)
    p = g.player
    p.inventory.append(items.make("labeller"))
    u = entities.AngryUser(*spot)
    u.hp = 100
    g.enemies.append(u)
    g.use_item(0, d)
    assert u.hp < 100 and p.inventory[0].charges == 4


def test_extinguisher_area_and_clears_jams():
    g = fresh()
    p = g.player
    p.inventory.append(items.make("extinguisher"))
    around = [(p.x + dx, p.y + dy) for dx in (-2, -1, 1, 2) for dy in (-2, 0, 2)
              if g.gmap.walkable(p.x + dx, p.y + dy)]
    foes = []
    for pos in around[:2]:
        e = entities.AngryUser(*pos)
        e.hp = 100
        foes.append(e)
        g.enemies.append(e)
    for pos in around[2:4]:
        g.gmap.jams[pos] = 50
    g.use_item(0)
    assert all(e.hp < 100 for e in foes)
    assert not any(pos in g.gmap.jams for pos in around[2:4])


def test_locked_room_needs_password():
    for seed in range(100):
        g = fresh(seed)
        if g.gmap.locked_room:
            break
    gm = g.gmap
    door = next(pos for pos in gm.locked_room.rim() if gm.tile(*pos) == mapgen.LOCKED)
    outside = next((door[0] + dx, door[1] + dy) for dx, dy in mapgen.DIRS
                   if gm.walkable(door[0] + dx, door[1] + dy)
                   and not gm.locked_room.contains(door[0] + dx, door[1] + dy))
    p = g.player
    p.x, p.y = outside
    d = (door[0] - outside[0], door[1] - outside[1])
    assert not g.move_player(*d)
    assert gm.tile(*door) == mapgen.LOCKED
    p.inventory.append(items.make("password"))
    assert g.move_player(*d)
    assert gm.tile(*door) == mapgen.DOOR and not p.inventory
    assert any(pos in gm.distances_from(*p.pos) for pos in gm.locked_room.interior())


def test_floors_with_locked_rooms_spawn_a_password_outside():
    for seed in range(40):
        g = Game(seed=seed)
        if g.gmap.locked_room:
            notes = [i for i in g.items if i.item and i.item.key == "password"]
            assert notes
            dist = g.gmap.distances_from(*g.gmap.start)
            assert all(n.pos in dist for n in notes)


def test_drop_item():
    g = fresh()
    g.player.inventory.append(items.make("stress"))
    g.drop_item(0)
    assert not g.player.inventory and g.item_at(*g.player.pos)
