"""Save and restore a whole Game as JSON.

pickle works but is ~1000x slower under Brython (the browser build), so this
walks the object graph itself and leans on json, which Brython runs natively.
Shared objects stay shared (gmap.locked_room is also in gmap.rooms).
"""

import json
import random

from . import entities, items, mapgen
from .game import Game, MessageLog

VERSION = 1
CLASSES = {cls.__name__: cls for cls in (
    Game, MessageLog, mapgen.GameMap, mapgen.Room, items.Item, items.FloorItem,
    entities.Player, entities.AngryUser, entities.RoguePrinter, entities.ExpiredCert,
    entities.PhishingEmail, entities.SpamEmail, entities.ExchangeServer,
)}
PLAIN = (str, int, float, bool, type(None))


def dumps(game):
    memo = {}

    def enc(obj):
        if isinstance(obj, PLAIN):
            return obj
        if isinstance(obj, list):
            if all(isinstance(x, PLAIN) for x in obj):
                return obj
            return [enc(x) for x in obj]
        if isinstance(obj, tuple):
            return {"t": [enc(x) for x in obj]}
        if isinstance(obj, set):
            return {"s": [enc(x) for x in sorted(obj)]}
        if isinstance(obj, dict):
            return {"m": [[enc(k), enc(v)] for k, v in obj.items()]}
        if isinstance(obj, random.Random):
            return {"rng": enc(obj.getstate())}
        name = type(obj).__name__
        if CLASSES.get(name) is not type(obj):
            raise TypeError(f"can't save {name}")
        if id(obj) in memo:
            return {"ref": memo[id(obj)]}
        memo[id(obj)] = len(memo)
        return {"o": name, "id": memo[id(obj)], "d": {k: enc(v) for k, v in vars(obj).items()}}

    return json.dumps({"v": VERSION, "game": enc(game)}, separators=(",", ":"))


def loads(text):
    data = json.loads(text)
    if data.get("v") != VERSION:
        raise ValueError("save from a different version")
    memo = {}

    def dec(obj):
        if isinstance(obj, list):
            return [dec(x) for x in obj]
        if not isinstance(obj, dict):
            return obj
        if "t" in obj:
            return tuple(dec(x) for x in obj["t"])
        if "s" in obj:
            return {dec(x) for x in obj["s"]}
        if "m" in obj:
            return {dec(k): dec(v) for k, v in obj["m"]}
        if "rng" in obj:
            r = random.Random()
            r.setstate(dec(obj["rng"]))
            return r
        if "ref" in obj:
            return memo[obj["ref"]]
        cls = CLASSES[obj["o"]]
        inst = cls.__new__(cls)
        memo[obj["id"]] = inst
        for k, v in obj["d"].items():
            setattr(inst, k, dec(v))
        return inst

    game = dec(data["game"])
    if not isinstance(game, Game):
        raise ValueError("not a saved game")
    return game
