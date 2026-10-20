"""Launch the real curses game in a pseudo-terminal. Skipped without pty/pyte."""

import pytest

pytest.importorskip("pyte")
pty = pytest.importorskip("pty")

from tests.tui_harness import TUI  # noqa: E402


def test_game_starts_moves_and_quits(tmp_path):
    t = TUI("--seed", "6", cols=80, rows=24, env={"NIGHTSHIFT_SCORES": str(tmp_path / "s.json")})
    assert "Press any key to clock in" in t.text
    t.send("x")
    assert "Floor 1/12" in t.text and "[ 19:00 ]" in t.text and "@" in t.text
    t.send("right", "down", "d", "s", " ", "?")
    assert "controls" in t.text
    t.send("x", "q", "y")
    assert t.wait_exit() == 0
    assert b"Traceback" not in t.output
