"""What happens in the lift between floors: random events and the vending machine.

Pure logic: the UI shows the text and passes back the player's choice.
"""

from . import items, seeding


class Event:
    def __init__(self, key, title, text, choices):
        self.key = key
        self.title = title
        self.text = text
        self.choices = choices      # [(label, fn(game) -> result text)]

    def choose(self, game, index):
        return self.choices[index][1](game)


def _adjust(game, hp=0, caffeine=0, sanity=0, tickets=0):
    """Events sting but never kill: stats bottom out at 1."""
    p = game.player
    p.hp = max(1, min(p.max_hp, p.hp + hp))
    p.caffeine = max(0, min(p.max_caffeine, p.caffeine + caffeine))
    p.sanity = max(1, min(p.max_sanity, p.sanity + sanity))
    p.tickets = max(0, p.tickets + tickets)


def _give(game, key):
    if len(game.player.inventory) < game.player.INVENTORY_SIZE:
        game.player.inventory.append(items.make(key))
        return True
    return False


# --------------------------------------------------------------------------- events

def _p1_fix(game):
    _adjust(game, sanity=-15, tickets=8)
    return "You fix it. It was in aeroplane mode. (-15 Sanity, +8 ticket closures)"


def _p1_escalate(game):
    if game.rng.random() < 0.5:
        _adjust(game, sanity=-5)
        return "The vendor fixes it after 55 minutes of hold music. (-5 Sanity)"
    _adjust(game, hp=-8)
    return ("The vendor reboots the core switch. The whole building goes down. "
            "Somehow it's your fault. You're shoved into a cable tray. (-8 HP)")


def _freeze_respect(game):
    game.shop_closed = True
    _adjust(game, sanity=5)
    return ("You respect the freeze. The vending machine is also frozen (it's a change). "
            "But doing nothing is weirdly relaxing. (+5 Sanity, shop closed)")


def _freeze_break(game):
    game.extra_angry += 1
    _adjust(game, sanity=-10)
    return ("You raise an emergency change. The CAB will want to discuss this. "
            "One of them is waiting on the next floor. (-10 Sanity, +1 Angry User)")


def _favour_yes(game):
    _adjust(game, caffeine=-20, sanity=-10, tickets=12)
    return ("It was not quick. It was not a favour. It was a SharePoint migration. "
            "(-20 Caffeine, -10 Sanity, +12 ticket closures)")


def _favour_no(game):
    game.extra_angry += 1
    _adjust(game, sanity=-5)
    return ("You leave it on read. Read receipts are on. They come looking. "
            "(-5 Sanity, +1 Angry User next floor)")


def _pizza_eat(game):
    _adjust(game, hp=10, sanity=5)
    return "Cold pepperoni at 2am. Peak IT. (+10 HP, +5 Sanity)"


def _pizza_save(game):
    if _give(game, "meal"):
        return "You wrap a slice in a printout of the incident report. (+1 Meal deal)"
    _adjust(game, hp=10)
    return "Your pockets are full, so you eat it anyway. (+10 HP)"


def _alarm_leave(game):
    _adjust(game, sanity=-10)
    got = _give(game, "extinguisher")
    return ("You stand in the car park for 20 minutes. It was a test. Nobody told you. "
            + ("You liberate an extinguisher on the way back in. (-10 Sanity, +1 Extinguisher)"
               if got else "(-10 Sanity)"))


def _alarm_ignore(game):
    _adjust(game, caffeine=15)
    return "You ignore it and finish your coffee. Fire wardens hate you. (+15 Caffeine)"


def _resets_do(game):
    _adjust(game, caffeine=-10, tickets=6)
    return "37 resets later, every password is now 'Winter2025!'. (-10 Caffeine, +6 ticket closures)"


def _resets_automate(game):
    _adjust(game, sanity=-12, tickets=2)
    return ("You spend the hour writing a self-service script. Nobody uses it. "
            "(-12 Sanity, +2 ticket closures)")


EVENTS = [
    Event("p1", "P1 INCIDENT",
          "PRIORITY 1: The CEO's iPad 'won't connect to the internet'. "
          "He's on a flight to Singapore in 20 minutes.",
          [("Drop everything and fix it", _p1_fix), ("Escalate to the vendor", _p1_escalate)]),
    Event("freeze", "CHANGE FREEZE",
          "An all-staff email: CHANGE FREEZE IN EFFECT. No changes to any system "
          "until further notice. The vending machine counts as a system.",
          [("Respect the freeze", _freeze_respect),
           ("Raise an emergency change anyway", _freeze_break)]),
    Event("favour", "A QUICK FAVOUR",
          "Your manager messages at 1am: 'Hey, could you do me a quick favour?' "
          "Those are the four most dangerous words in IT.",
          [("'Sure, happy to help!'", _favour_yes), ("Pretend you didn't see it", _favour_no)]),
    Event("pizza", "FREE PIZZA",
          "The sales team left pizza in the meeting room after closing a deal. "
          "Nobody will ever know.",
          [("Eat it now", _pizza_eat), ("Save a slice for later", _pizza_save)]),
    Event("alarm", "FIRE ALARM",
          "The fire alarm goes off. Everyone else has gone home. The lift stops.",
          [("Evacuate like a good citizen", _alarm_leave), ("Ignore it", _alarm_ignore)]),
    Event("resets", "PASSWORD RESET STORM",
          "37 password reset requests arrive at once. It's the first Monday of the month "
          "somewhere.",
          [("Just do them", _resets_do), ("Automate it", _resets_automate)]),
]


def roll_event(game):
    """Pick the event for the lift ride after the current floor, or None."""
    rng = seeding.rng(game.seed, "event", game.floor)
    if rng.random() < 0.3:
        return None
    return rng.choice(EVENTS)


# --------------------------------------------------------------------------- vending machine

SHOP_POOL = ["coffee", "coffee", "energy", "meal", "stress", "labeller", "extinguisher",
             "cable", "password"]

SHOP_QUIPS = [
    "The vending machine accepts ticket closures. Nobody knows why. Nobody asks.",
    "The vending machine hums. One of the coils is labelled 'B4 - DO NOT'.",
    "The vending machine's screen says 'EXACT CHANGE ONLY'. You have tickets.",
]


class Shop:
    def __init__(self, game):
        rng = seeding.rng(game.seed, "shop", game.floor)
        pool = [k for k in SHOP_POOL
                if not (k == "cable" and game.player.weapon and game.player.weapon.key == "cable")]
        self.stock = [items.make(k) for k in rng.sample(pool, 5)]
        self.quip = rng.choice(SHOP_QUIPS)

    def buy(self, game, index):
        """Returns (ok, message)."""
        p = game.player
        if not 0 <= index < len(self.stock):
            return False, ""
        item = self.stock[index]
        if p.tickets < item.price:
            return False, f"You need {item.price} ticket closures. You have {p.tickets}."
        if len(p.inventory) >= p.INVENTORY_SIZE:
            return False, "Your pockets are full. Drop or use something first."
        p.tickets -= item.price
        p.inventory.append(item)
        self.stock.pop(index)
        return True, f"Clunk. The {item.name.lower()} drops into the tray."
