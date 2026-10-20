from nightshift import mapgen


def test_floors_are_connected_and_deterministic():
    for seed in range(40):
        for floor in (1, 5, 11):
            gm = mapgen.generate_floor(seed, floor)
            dist = gm.distances_from(*gm.start)
            assert gm.lift in dist, (seed, floor)
            assert gm.tile(*gm.lift) == mapgen.LIFT
            for room in gm.rooms:
                if room is gm.locked_room:
                    assert not any(p in dist for p in room.interior())
                else:
                    assert any(p in dist for p in room.interior()), (seed, floor, room)
            again = mapgen.generate_floor(seed, floor)
            assert again.tiles == gm.tiles


def test_boss_floor_has_reachable_hall():
    for seed in range(20):
        gm = mapgen.generate_floor(seed, 12, boss=True)
        hall = next(r for r in gm.rooms if r.kind == "hall")
        assert hall.center in gm.distances_from(*gm.start)


def test_fov_blocked_by_walls():
    gm = mapgen.GameMap(10, 5)
    for x in range(1, 9):
        gm.set(x, 2, mapgen.FLOOR)
    gm.set(5, 2, mapgen.WALL)
    vis = mapgen.compute_fov(gm, 1, 2)
    assert (4, 2) in vis and (5, 2) in vis and (6, 2) not in vis
