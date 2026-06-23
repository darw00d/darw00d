STATION_IDS: dict[str, str] = {
    "STP": "8096049",   # London St Pancras International
    "PRG": "8057400",   # Praha hl.n.
    "BER": "8011160",   # Berlin Hbf
    "MUC": "8000261",   # München Hbf
    "VIE": "8100003",   # Wien Hbf
}

STATION_NAMES: dict[str, str] = {
    "STP": "London St Pancras",
    "PRG": "Prague (Praha hl.n.)",
    "BER": "Berlin Hbf",
    "MUC": "Munich (München Hbf)",
    "VIE": "Vienna (Wien Hbf)",
}

DB_BOOKING_URL = (
    "https://www.bahn.de/buchung/fahrplan/suche"
    "#sts=true&so=London+St+Pancras&zo={destination}&hd={date}&hza=D&ar=false&s=true"
)

EUROSTAR_DEST_IDS: dict[str, str] = {
    "PRG": "8057400",
    "BER": "8011160",
    "MUC": "8000261",
    "VIE": "8100003",
}
