"""Screen flow in main.py, with a fake UI standing in for curses."""

from nightshift import combat, main, ui
from nightshift.game import Game


class FakeUI:
    wrap = ui.UI.wrap

    def __init__(self, keys=()):
        self.screens = []
        self.keys = list(keys)

    def text_screen(self, lines, footer=""):
        self.screens.append("\n".join(t for t, _ in lines))
        return self.keys.pop(0) if self.keys else ord("q")

    def event_screen(self, event, header):
        self.screens.append(event.title)
        return 0

    def shop_screen(self, game, shop, header):
        self.screens.append("SHOP")


def app(fake):
    a = main.App.__new__(main.App)
    a.ui = fake
    a.args = main.parse_args([])
    return a


def test_victory_screen(tmp_path, monkeypatch):
    monkeypatch.setenv("NIGHTSHIFT_SCORES", str(tmp_path / "s.json"))
    g = Game(seed=5)
    g.state = "won"
    fake = FakeUI()
    app(fake).end_screen(g)
    assert "HANDOVER COMPLETE" in fake.screens[-1] and "HANDOVER" in fake.screens[-1]


def test_death_screen_shows_ticket(tmp_path, monkeypatch):
    monkeypatch.setenv("NIGHTSHIFT_SCORES", str(tmp_path / "s.json"))
    g = Game(seed=5)
    combat.hurt_player(g, 999, "Expired Cert")
    fake = FakeUI()
    app(fake).end_screen(g)
    text = fake.screens[-1]
    assert "INC" in text and "Tech unresponsive" in text and "Resolution" in text


def test_between_floors_flow():
    for seed in range(10):
        g = Game(seed=seed, start_floor=11)
        fake = FakeUI(keys=[ord("x")] * 5)
        app(fake).between_floors(g)
        assert "SHOP" in fake.screens or any("FREEZE" in s for s in fake.screens)
        assert "06:00. The final floor." in fake.screens[-1]
