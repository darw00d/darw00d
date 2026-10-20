"""Random play across many seeds: nothing should crash, runs must replay exactly."""

import random

from nightshift.game import Game

ACTIONS = ["up", "down", "left", "right", "wait", "lift"]
DIRS = {"up": (0, -1), "down": (0, 1), "left": (-1, 0), "right": (1, 0)}


def drive(game, rng, action):
    if action in DIRS:
        game.move_player(*DIRS[action])
    elif action == "wait":
        game.wait()
    elif action == "lift":
        game.take_lift()


def play(seed, steps=600):
    game = Game(seed=seed)
    rng = random.Random(seed * 7)
    trace = []
    for _ in range(steps):
        if game.state == "floor_done":
            game.next_floor()
        if game.state not in ("playing",):
            break
        # head for the lift sometimes so we see later floors
        if rng.random() < 0.3:
            dist = game.gmap.distances_from(*game.gmap.lift)
            here = dist.get(game.player.pos, 999)
            for name, (dx, dy) in DIRS.items():
                if dist.get((game.player.x + dx, game.player.y + dy), 999) < here:
                    action = name
                    break
            else:
                action = "lift"
        else:
            action = rng.choice(ACTIONS)
        drive(game, rng, action)
        trace.append((game.player.pos, game.player.hp, game.player.sanity, game.floor))
    return game, trace


def test_random_play_does_not_crash():
    for seed in range(12):
        play(seed)


def test_same_seed_same_run():
    _, a = play(99)
    _, b = play(99)
    assert a == b
