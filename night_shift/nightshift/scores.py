"""A simple JSON high score table."""

import json
import os
from pathlib import Path

MAX_ENTRIES = 10


def score_path():
    return Path(os.environ.get("NIGHTSHIFT_SCORES", Path.home() / ".nightshift_scores.json"))


def compute_score(game):
    p = game.player
    floors = game.floor - game.start_floor + (1 if game.state == "won" else 0)
    return floors * 100 + p.kills * 10 + p.tickets * 2 + (1000 if game.state == "won" else 0)


def load():
    try:
        data = json.loads(score_path().read_text())
        return [e for e in data if isinstance(e, dict) and "score" in e][:MAX_ENTRIES]
    except (OSError, ValueError):
        return []


def record(game, cause_text):
    """Add this run to the score file. Returns (entries, rank or None).
    Practice runs (started past floor 1) are not recorded."""
    entries, rank = insert(load(), game, cause_text)
    if rank is not None:
        try:
            score_path().write_text(json.dumps(entries, indent=2))
        except OSError:
            pass   # read-only home dir: the run still counts in our hearts
    return entries, rank


def insert(entries, game, cause_text):
    """Pure version of record(): returns the new table and this run's rank."""
    if game.start_floor != 1:
        return entries, None
    entry = {
        "score": compute_score(game),
        "won": game.state == "won",
        "floor": game.floor,
        "clock": game.clock,
        "kills": game.player.kills,
        "seed": game.seed,
        "cause": cause_text,
    }
    entries = list(entries) + [entry]
    entries.sort(key=lambda e: e["score"], reverse=True)
    entries = entries[:MAX_ENTRIES]
    rank = next((i for i, e in enumerate(entries, 1) if e is entry), None)
    return entries, rank
