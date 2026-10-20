from nightshift import combat, entities, items, mapgen
from nightshift.game import Game


def boss_game(seed=1):
    g = Game(seed=seed, start_floor=12)
    boss = g.boss
    assert boss is not None
    g.enemies[:] = [boss]
    boss.awake = True
    # stand the player a few tiles from the boss
    dist = g.gmap.distances_from(*boss.pos)
    g.player.x, g.player.y = next(p for p, d in sorted(dist.items()) if d == 4)
    g.player.max_hp = g.player.hp = 500
    g.player.max_sanity = g.player.sanity = 500
    g.update_view()
    return g, boss


def test_boss_floor_has_boss_and_no_lift():
    g = Game(seed=3, start_floor=12)
    assert g.is_boss_floor and g.boss and g.gmap.lift is None
    assert not g.take_lift()


def test_phase1_mail_storm_telegraphs_then_lands():
    g, boss = boss_game()
    for _ in range(4):
        g.wait()
        if boss.marked:
            break
    assert g.player.pos in boss.marked
    hp = g.player.hp
    g.wait()       # stand still on a marked tile
    assert g.player.hp < hp
    assert any(isinstance(e, entities.SpamEmail) for e in g.enemies)


def test_dodging_the_storm_avoids_damage():
    g, boss = boss_game(2)
    for _ in range(4):
        g.wait()
        if boss.marked:
            break
    g.enemies[:] = [boss]      # no spam interference
    p = g.player
    safe = next(d for d in mapgen.DIRS if (p.x + d[0], p.y + d[1]) not in boss.marked
                and not g.blocked(p.x + d[0], p.y + d[1]))
    hp = p.hp
    g.move_player(*safe)
    assert p.hp == hp


def test_phase2_quota_archives_items_to_floor():
    g, boss = boss_game()
    boss.hp = boss.max_hp // 2
    g.player.inventory = [items.make("coffee"), items.make("meal")]
    before = len(g.items)
    for _ in range(6):
        g.wait()
    assert boss.phase == 2
    assert len(g.player.inventory) < 2 and len(g.items) > before
    assert g.player.sanity < 500


def test_phase3_shield_blocks_damage():
    g, boss = boss_game()
    boss.hp = boss.max_hp // 4
    for _ in range(3):
        g.wait()
        if boss.shield:
            break
    assert boss.phase == 3 and boss.shield
    hp = boss.hp
    combat.damage_enemy(g, boss, 5)
    assert boss.hp == hp
    for _ in range(5):
        g.wait()
        if not boss.shield:
            break
    assert not boss.shield
    combat.damage_enemy(g, boss, 5)
    assert boss.hp == hp - 5


def test_boss_is_not_stunlocked():
    g, boss = boss_game()
    boss.stunned = 50
    for _ in range(4):
        g.wait()
    assert boss.marked or boss.timer != 2


def test_killing_boss_wins():
    g, boss = boss_game()
    combat.damage_enemy(g, boss, 999)
    assert g.state == "won" and g.clock == "07:00"
