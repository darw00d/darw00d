"""Dry IT humour, kept in one place so the code stays readable."""

FLOOR_INTROS = [
    "The lift doors open onto floor {floor}. The motion-sensor lights consider you, then decline.",
    "Floor {floor}. Someone has left a monitor on displaying 'Do not switch off'.",
    "Floor {floor}. The air conditioning is set to 'November'.",
    "Floor {floor}. A sticky note on the lift reads: 'IT - urgent - see me'. It is unsigned.",
    "Floor {floor}. Somewhere, a UPS beeps every thirty seconds. Forever.",
    "Floor {floor}. The carpet smells faintly of burnt toast and broken promises.",
]

ROOM_ENTRY = {
    "openplan": ["Rows of desks stretch out. Every monitor is on. Nobody is here.",
                 "An open-plan office. Hot-desking: like musical chairs, but sadder."],
    "server": ["The server room hums. It's 16 degrees and smells of ozone.",
               "Blinking lights everywhere. Several of them are amber. One is screaming."],
    "comms": ["A comms cupboard. Patch cables hang like vines in a very boring jungle.",
              "A comms cupboard. Someone labelled every port 'DO NOT UNPLUG'. Helpful."],
    "meeting": ["A meeting room booked until 2031 by someone who left in 2019.",
                "A meeting room. The whiteboard reads 'SYNERGY?' in permanent marker."],
    "kitchen": ["The kitchenette. A passive-aggressive note guards the milk.",
                "The kitchenette. The microwave clock flashes 12:00, as is tradition."],
    "supply": ["The supply cupboard. Treasure, if you value toner."],
    "hall": ["The main data hall. Something enormous is processing your presence."],
}

WAIT = [
    "You stare at a loading bar. It stares back.",
    "You wait. Somewhere a ticket ages gracefully.",
    "You take a moment. The building does not.",
]

PLAYER_HIT = [
    "You hit the {name}.",
    "You escalate the {name} with force.",
    "You apply percussive maintenance to the {name}.",
]

ANGRY_USER_SPOT = [
    "An Angry User spots you. \"Is the internet down?\"",
    "An Angry User spots you. \"Oh good, IT. I've been waiting since 2pm.\"",
    "An Angry User spots you. \"I don't want to log a ticket, I just want it FIXED.\"",
]

ANGRY_USER_ATTACK = [
    "The Angry User asks if you've tried turning it off and on again.",
    "The Angry User explains that their nephew 'does computers'.",
    "The Angry User demands to know why 'the cloud' is wet.",
    "The Angry User reads their password out loud. It is 'Password1'.",
    "The Angry User insists it was working yesterday.",
    "The Angry User CCs your manager on a verbal complaint.",
]

ANGRY_USER_DEATH = [
    "The Angry User storms off to write a strongly-worded email.",
    "The Angry User is satisfied with the resolution. Ticket closed.",
    "The Angry User remembers they have a train to catch.",
]

HALLUCINATIONS = [
    "You hear a Teams call ringing. You don't have Teams open.",
    "A printer laughs, somewhere far away.",
    "The exit sign briefly reads 'NO EXIT'.",
    "Your phone buzzes: 'Can you just quickly...'. No sender.",
    "You see your own name in the out-of-office replies.",
]

PRINTER_SPOT = [
    "A Rogue Printer whirs to life. Its display reads: PC LOAD LETTER.",
    "A Rogue Printer wakes. It has been waiting for this. It has been waiting for you.",
]

PRINTER_FIRE = [
    "The Rogue Printer fires a ream of jammed A4.",
    "The Rogue Printer spits out 400 pages of someone's holiday photos.",
    "The Rogue Printer prints a test page. Aggressively.",
]

PRINTER_SHOCK = [
    "You restart the printer. It restarts you.",
    "You open tray 2. Tray 2 opens you.",
]

PRINTER_DEATH = [
    "The Rogue Printer prints its last page: 'Toner low'.",
    "The Rogue Printer is decommissioned. Nobody will miss it. Nobody ever does.",
]

JAM_CLEAR = [
    "You clear the paper jam. It was one sheet, folded with malice.",
    "You clear the paper jam. PC LOAD LETTER, indeed.",
]

CERT_SPOT = [
    "An Expired Cert flickers into view. Valid until: last Tuesday.",
    "An Expired Cert notices you. Your browser would like a word.",
]

CERT_SPLIT = [
    "The Expired Cert renews itself. Nobody approved this.",
    "The Expired Cert spawns an intermediate. The chain of trust weeps.",
]

CERT_DEATH = [
    "The Expired Cert is revoked.",
    "The Expired Cert is added to the CRL. Finally.",
]

PHISH_DISGUISES = [
    ("$", "money", "a stack of ticket closures"),
    ("!", "coffee", "a cup of coffee"),
    ("?", "warn", "a sticky note"),
]

PHISH_REVEAL = [
    "The {disguise} was a Phishing Email! 'URGENT: verify ur pasword'",
    "The {disguise} was a Phishing Email! 'Your parcel could not be delivered.'",
    "The {disguise} was a Phishing Email! 'CEO here. Need gift cards, quick.'",
]

PHISH_ATTACK = [
    "The Phishing Email harvests your credentials.",
    "The Phishing Email asks you to 'just click the link'.",
]

PHISH_DEATH = [
    "You report the Phishing Email. A warm glow of compliance.",
    "The Phishing Email is quarantined.",
]

CAFFEINE_LOW = "Your eyelids weigh roughly as much as a 2U server. (Caffeine low: you're slower.)"
CAFFEINE_OUT = "You are fully decaffeinated. Your head pounds like a failing hard drive."
SANITY_LOW = "The fluorescent lights are starting to talk to you. (Sanity low.)"
