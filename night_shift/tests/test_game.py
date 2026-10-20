from nightshift import entities
from nightshift.game import Game


def clear_enemies(game):
    game.enemies.clear()


def test_movement_and_walls():
    g = Game(seed=1)
    clear_enemies(g)
    x, y = g.player.pos
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        if g.gmap.walkable(x + dx, y + dy):
            assert g.move_player(dx, dy)
            assert g.player.pos == (x + dx, y + dy)
            break
    # walking into a wall costs no turn
    g.player.x, g.player.y = g.gmap.start
    turn = g.turn
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        if not g.gmap.walkable(g.player.x + dx, g.player.y + dy):
            assert not g.move_player(dx, dy)
            assert g.turn == turn


def place_next_to_player(game, enemy_cls):
    p = game.player
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        if game.gmap.walkable(p.x + dx, p.y + dy):
            e = enemy_cls(p.x + dx, p.y + dy)
            game.enemies.append(e)
            return e, (dx, dy)
    raise AssertionError("player boxed in")


def test_angry_user_drains_sanity_not_health():
    g = Game(seed=2)
    clear_enemies(g)
    u, _ = place_next_to_player(g, entities.AngryUser)
    u.awake = True
    g.update_view()
    for _ in range(5):
        g.wait()
    assert g.player.hp == g.player.max_hp
    assert g.player.sanity < g.player.max_sanity


def test_angry_user_chases():
    g = Game(seed=3)
    clear_enemies(g)
    gm = g.gmap
    dist = gm.distances_from(*g.player.pos)
    far = max((p for p, d in dist.items() if d <= 12), key=dist.get)
    u = entities.AngryUser(*far)
    u.awake = True
    g.enemies.append(u)
    start = dist[far]
    for _ in range(6):
        g.wait()
    assert gm.distances_from(*g.player.pos).get(u.pos, 99) < start


def test_bump_attack_kills_and_pays():
    g = Game(seed=4)
    clear_enemies(g)
    u, (dx, dy) = place_next_to_player(g, entities.AngryUser)
    u.hp = 1
    g.move_player(dx, dy)
    assert u not in g.enemies
    assert g.player.tickets > 0 and g.player.kills == 1


def test_lift_advances_floor():
    g = Game(seed=5)
    clear_enemies(g)
    g.player.x, g.player.y = g.gmap.lift
    assert g.take_lift()
    assert g.state == "floor_done"
    g.next_floor()
    assert g.floor == 2 and g.state == "playing" and g.clock.startswith("20:")
