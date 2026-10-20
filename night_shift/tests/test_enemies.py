from nightshift import entities, flavour, mapgen
from nightshift.game import Game


def open_spot(game, min_d, max_d, los=True):
    """A reachable floor tile min_d..max_d steps from the player."""
    p = game.player
    dist = game.gmap.distances_from(*p.pos)
    for pos, d in sorted(dist.items()):
        if min_d <= d <= max_d and game.gmap.tile(*pos) == mapgen.FLOOR:
            if not los or (pos in game.visible and mapgen.has_los(game.gmap, *pos, *p.pos)):
                return pos
    raise AssertionError("no spot")


def fresh(seed):
    g = Game(seed=seed)
    g.enemies.clear()
    g.update_view()
    return g


def test_printer_is_stationary_and_jams_tiles():
    g = fresh(10)
    pos = open_spot(g, 3, 5)
    printer = entities.RoguePrinter(*pos)
    g.enemies.append(printer)
    for _ in range(10):
        g.wait()
    assert printer.pos == pos
    assert g.gmap.jams, "printer should have jammed something"
    jam = next(iter(g.gmap.jams))
    assert not g.gmap.walkable(*jam)


def test_bumping_a_jam_clears_it():
    g = fresh(11)
    p = g.player
    for dx, dy in mapgen.DIRS:
        if g.gmap.walkable(p.x + dx, p.y + dy):
            g.gmap.jams[(p.x + dx, p.y + dy)] = 20
            g.move_player(dx, dy)
            assert (p.x, p.y) != (p.x + dx, p.y + dy)
            assert not g.gmap.jams
            return
    raise AssertionError


def test_jams_expire():
    g = fresh(12)
    spot = open_spot(g, 4, 6, los=False)
    g.gmap.jams[spot] = 3
    for _ in range(3):
        g.wait()
    assert spot not in g.gmap.jams


def test_cert_multiplies_when_ignored():
    g = fresh(13)
    pos = open_spot(g, 4, 7)
    cert = entities.ExpiredCert(*pos)
    cert.awake = True
    g.enemies.append(cert)
    g.player.max_hp = g.player.hp = 999   # survive long enough to watch
    for _ in range(30):
        g.wait()
    certs = [e for e in g.enemies if isinstance(e, entities.ExpiredCert)]
    assert len(certs) > 2


def test_cert_population_is_capped():
    g = fresh(14)
    g.player.max_hp = g.player.hp = 10**6
    g.player.max_sanity = g.player.sanity = 10**6
    g.enemies.append(entities.ExpiredCert(*open_spot(g, 3, 6)))
    g.enemies[0].awake = True
    for _ in range(300):
        g.wait()
    assert sum(isinstance(e, entities.ExpiredCert) for e in g.enemies) <= entities.ExpiredCert.max_certs


def test_phishing_hides_until_close_then_steals():
    g = fresh(15)
    g.player.tickets = 20
    far = open_spot(g, 5, 7)
    phish = entities.PhishingEmail(*far, flavour.PHISH_DISGUISES[0])
    g.enemies.append(phish)
    g.wait()
    assert phish.disguised and phish.glyph == "$" and phish.pos == far
    # walk toward it
    for _ in range(10):
        if not phish.disguised:
            break
        dist = g.gmap.distances_from(*phish.pos)
        p = g.player
        here = dist[p.pos]
        for dx, dy in mapgen.DIRS:
            if dist.get((p.x + dx, p.y + dy), 999) < here:
                g.move_player(dx, dy)
                break
    assert not phish.disguised and phish.glyph == "e"
    for _ in range(6):
        if phish not in g.enemies:
            break
        g.wait()
    assert g.player.tickets < 20


def test_low_caffeine_makes_you_slower():
    g = fresh(16)
    pos = open_spot(g, 8, 12, los=False)

    def steps_taken(caffeine):
        g2 = fresh(16)
        u = entities.AngryUser(*pos)
        u.awake = True
        u.speed = 10
        g2.enemies.append(u)
        g2.player.caffeine = caffeine
        d0 = g2.gmap.distances_from(*g2.player.pos)[u.pos]
        for _ in range(3):
            g2.player.caffeine = caffeine
            g2.wait()
        return d0 - g2.gmap.distances_from(*g2.player.pos).get(u.pos, 0)

    assert steps_taken(0) > steps_taken(100)


def test_sanity_zero_is_death():
    g = fresh(17)
    g.player.sanity = 3
    u = entities.AngryUser(*open_spot(g, 1, 1))
    u.awake = True
    g.enemies.append(u)
    for _ in range(3):
        g.wait()
    assert g.state == "dead" and g.cause == ("Angry User", "sanity")
