"""Turns a finished run into a service desk ticket."""

import random

RESOLUTIONS = [
    "Closed - user error",
    "Closed - could not reproduce",
    "Closed - working as intended",
    "Closed - duplicate of INC0000001",
    "Closed - no fault found",
    "Closed - resolved by itself",
]


def cause_text(game):
    if game.state == "won":
        return "Survived to handover"
    if game.cause is None:
        return "Abandoned shift"
    source, kind = game.cause
    if kind == "sanity":
        return f"Resigned (thanks to {_a(source)})"
    return f"Downed by {_a(source)}"


def _a(source):
    if source.startswith(("a ", "an ", "the ", "caffeine")):
        return source
    return ("an " if source[0].lower() in "aeiou" else "a ") + source


def incident_ticket(game):
    """Returns (number, list of (field, value)) for a death."""
    rng = random.Random(f"{game.seed}:ticket:{game.turn}")
    number = f"INC{rng.randint(1, 9999999):07d}"
    source, kind = game.cause or ("unknown causes", "hp")
    room = game.gmap.room_at(*game.player.pos)
    where = f"the {room.name} on floor {game.floor}" if room else f"a corridor on floor {game.floor}"
    if kind == "sanity":
        short = "Tech has resigned"
        desc = (f"At {game.clock} the night tech left a resignation note in {where}. "
                f"It mentions {_a(source)} 14 times and is mostly capital letters.")
    else:
        short = "Tech unresponsive"
        desc = (f"Night tech found unresponsive in {where} at {game.clock}. "
                f"Last seen in an altercation with {_a(source)}.")
    fields = [
        ("Short description", short),
        ("Opened", f"{game.clock} by Night Shift Monitoring"),
        ("Priority", rng.choice(["P4 - Low", "P5 - Whenever", "P4 - Low (raised by tech: P1)"])),
        ("Description", desc),
        ("Work notes", f"Closed {game.player.kills} other tickets beforehand. "
                       f"{game.player.tickets} ticket closures unclaimed."),
        ("Assigned to", "Service Desk (the tech)"),
        ("Resolution", rng.choice(RESOLUTIONS)),
    ]
    return number, fields
