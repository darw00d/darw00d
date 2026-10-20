from nightshift import combat, report, scores
from nightshift.game import Game


def test_death_ticket_and_score(tmp_path, monkeypatch):
    monkeypatch.setenv("NIGHTSHIFT_SCORES", str(tmp_path / "s.json"))
    g = Game(seed=42)
    combat.hurt_player(g, 999, "Rogue Printer")
    assert g.state == "dead"
    number, fields = report.incident_ticket(g)
    assert number.startswith("INC") and len(number) == 10
    d = dict(fields)
    assert d["Short description"] == "Tech unresponsive"
    assert "Rogue Printer" in d["Description"]
    assert d["Resolution"].startswith("Closed - ")
    entries, rank = scores.record(g, report.cause_text(g))
    assert rank == 1 and scores.load()[0]["seed"] == 42


def test_sanity_death_is_a_resignation():
    g = Game(seed=1)
    combat.hurt_player(g, 999, "Angry User", "sanity")
    assert dict(report.incident_ticket(g)[1])["Short description"] == "Tech has resigned"
    assert report.cause_text(g) == "Resigned (thanks to an Angry User)"


def test_score_table_keeps_top_ten(tmp_path, monkeypatch):
    monkeypatch.setenv("NIGHTSHIFT_SCORES", str(tmp_path / "s.json"))
    for i in range(15):
        g = Game(seed=i)
        g.player.kills = i
        g.state = "dead"
        scores.record(g, "x")
    table = scores.load()
    assert len(table) == 10
    assert [e["kills"] for e in table] == list(range(14, 4, -1))


def test_corrupt_score_file_is_ignored(tmp_path, monkeypatch):
    path = tmp_path / "s.json"
    path.write_text("{not json")
    monkeypatch.setenv("NIGHTSHIFT_SCORES", str(path))
    assert scores.load() == []


def test_practice_runs_not_recorded(tmp_path, monkeypatch):
    monkeypatch.setenv("NIGHTSHIFT_SCORES", str(tmp_path / "s.json"))
    g = Game(seed=1, start_floor=12)
    g.state = "dead"
    assert scores.record(g, "x")[1] is None and scores.load() == []
