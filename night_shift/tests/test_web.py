import json

from nightshift import combat, items, mapgen, web


def started(seed=6, floor=1):
    app = web.WebApp()
    app.handle({"type": "start", "seed": str(seed), "floor": floor})
    app.game.enemies.clear()
    return app


def test_title_then_play_view():
    app = web.WebApp()
    v = app.view()
    assert v["mode"] == "title" and v["title"]["resume"] is None
    app.handle({"type": "start", "seed": "42"})
    v = app.view()
    assert v["mode"] == "play" and v["hud"]["seed"] == 42 and v["hud"]["clock"] == "19:00"
    m = v["map"]
    assert len(m["glyphs"]) == 32 and all(len(r) == 64 for r in m["glyphs"])
    assert m["glyphs"][m["py"] - m["oy"]][m["px"] - m["ox"]] == "@"
    app.handle({"type": "noop", "view": [21, 15]})
    m = app.view()["map"]
    assert len(m["glyphs"]) == 15 and all(len(r) == 21 for r in m["glyphs"])
    assert m["glyphs"][7][10] == "@" and (m["ox"], m["oy"]) == (m["px"] - 10, m["py"] - 7)
    assert set("".join(m["colors"])) <= set(web.CODE.values())
    json.dumps(v)   # the page receives this as JSON


def test_moving_and_waiting():
    app = started()
    g = app.game
    turn = g.turn
    for dx, dy in mapgen.DIRS:
        if g.gmap.walkable(g.player.x + dx, g.player.y + dy):
            app.handle({"type": "dir", "dx": dx, "dy": dy})
            break
    app.handle({"type": "wait"})
    assert g.turn == turn + 2


def test_aiming_an_item():
    app = started()
    g = app.game
    g.player.inventory.append(items.make("labeller"))
    app.handle({"type": "slot", "slot": 0})
    assert app.view()["mode"] == "aim" and app.view()["prompt"]
    app.handle({"type": "dir", "dx": 1, "dy": 0})
    assert app.mode == "play" and g.player.inventory[0].charges == 4
    app.handle({"type": "slot", "slot": 0})
    app.handle({"type": "cancel"})
    assert app.mode == "play" and g.player.inventory[0].charges == 4


def test_drop_mode():
    app = started()
    app.game.player.inventory.append(items.make("coffee"))
    app.handle({"type": "drop"})
    assert app.mode == "drop"
    app.handle({"type": "slot", "slot": 0})
    assert app.mode == "play" and not app.game.player.inventory


def test_full_interlude_reaches_next_floor():
    for seed in range(12):
        app = started(seed)
        g = app.game
        g.player.x, g.player.y = g.gmap.lift
        g.player.tickets = 50
        app.handle({"type": "lift"})
        seen = []
        for _ in range(10):
            seen.append(app.mode)
            if app.mode == "event":
                app.handle({"type": "choose", "index": 1})
            elif app.mode == "notice":
                app.handle({"type": "choose", "index": 0})
            elif app.mode == "shop":
                app.handle({"type": "buy", "index": 0})
                app.handle({"type": "leave"})
            else:
                break
        assert app.mode == "play" and g.floor == 2, (seed, seen)
        assert "save" in app.take_persist()


def test_death_records_score_and_clears_save():
    app = started(3)
    combat.hurt_player(app.game, 999, "Angry User", "sanity")
    app.handle({"type": "wait"})   # the game is already over, so nothing happens...
    app._after_turn()              # ...but the page's next action reaches _finish
    assert app.mode == "end"
    persist = app.take_persist()
    assert persist["save"] == "" and json.loads(persist["scores"])[0]["seed"] == 3
    ticket = app.view()["panel"]["ticket"]
    assert ticket["number"].startswith("INC")
    app.handle({"type": "choose", "index": 0})
    assert app.mode == "play" and app.game.seed == 3 and app.game.floor == 1


def test_resume_from_save():
    app = started(9)
    for _ in range(7):
        app.handle({"type": "wait"})
    persist = app.force_save()
    pos, turn = app.game.player.pos, app.game.turn
    app2 = web.WebApp(scores_json="", save_json=persist["save"])
    assert app2.view()["title"]["resume"].startswith("Floor 1")
    app2.handle({"type": "resume"})
    assert app2.mode == "play" and app2.game.player.pos == pos and app2.game.turn == turn


def test_corrupt_storage_is_ignored():
    app = web.WebApp(scores_json="{nope", save_json="also nope")
    assert app.entries == [] and app.saved is None


def test_quit_and_help():
    app = started()
    app.handle({"type": "help"})
    assert app.mode == "help"
    app.handle({"type": "choose", "index": 0})
    app.handle({"type": "quit"})
    app.handle({"type": "choose", "index": 0})
    assert app.mode == "play"
    app.handle({"type": "quit"})
    app.handle({"type": "choose", "index": 1})
    assert app.mode == "title" and app.take_persist()["save"] == ""
