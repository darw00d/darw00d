import pytest

from nightshift import items, mapgen, savegame
from nightshift.game import Game


def snapshot(g):
    return (g.player.pos, g.player.hp, g.player.sanity, g.player.caffeine, g.player.tickets,
            [(type(e).__name__, e.pos, e.hp) for e in g.enemies], g.turn, g.floor,
            sorted(g.gmap.jams.items()), [m[0] for m in g.log.recent(5)])


def play(g, n):
    for t in range(n):
        if g.state != "playing":
            break
        if t % 2:
            g.move_player(*mapgen.DIRS[t % 4])
        else:
            g.wait()


@pytest.mark.parametrize("seed,floor", [(1, 1), (8, 6), (4, 12)])
def test_restored_game_continues_identically(seed, floor):
    g = Game(seed=seed, start_floor=floor)
    g.player.inventory.append(items.make("labeller"))
    play(g, 25)
    g2 = savegame.loads(savegame.dumps(g))
    assert snapshot(g2) == snapshot(g)
    play(g, 40)
    play(g2, 40)
    assert snapshot(g2) == snapshot(g)


def test_shared_references_survive():
    for seed in range(50):
        g = Game(seed=seed)
        if g.gmap.locked_room:
            break
    g2 = savegame.loads(savegame.dumps(g))
    assert g2.gmap.locked_room in g2.gmap.rooms
    assert any(r is g2.gmap.locked_room for r in g2.gmap.rooms)


def test_rejects_bad_saves():
    with pytest.raises(ValueError):
        savegame.loads('{"v": 999}')
    with pytest.raises(KeyError):
        savegame.loads('{"v": 1, "game": {"o": "os.system", "id": 0, "d": {}}}')
