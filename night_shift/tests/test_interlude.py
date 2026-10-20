from nightshift import interlude, items
from nightshift.game import Game


def test_every_event_choice_runs_and_never_kills():
    for event in interlude.EVENTS:
        for i in range(len(event.choices)):
            g = Game(seed=1)
            g.player.hp = g.player.sanity = 1
            text = event.choose(g, i)
            assert text and g.player.hp >= 1 and g.player.sanity >= 1


def test_change_freeze_closes_shop_until_next_floor():
    g = Game(seed=2)
    freeze = next(e for e in interlude.EVENTS if e.key == "freeze")
    freeze.choose(g, 0)
    assert g.shop_closed
    g.next_floor()
    assert not g.shop_closed


def test_ignoring_manager_adds_angry_user():
    g = Game(seed=3)
    base = Game(seed=3)
    base.next_floor()
    favour = next(e for e in interlude.EVENTS if e.key == "favour")
    favour.choose(g, 1)
    g.next_floor()
    angry = lambda game: sum(type(e).__name__ == "AngryUser" for e in game.enemies)
    assert angry(g) == angry(base) + 1


def test_events_deterministic_per_seed():
    a = [interlude.roll_event(Game(seed=9, start_floor=f)) for f in range(1, 6)]
    b = [interlude.roll_event(Game(seed=9, start_floor=f)) for f in range(1, 6)]
    assert [e and e.key for e in a] == [e and e.key for e in b]


def test_shop_buy():
    g = Game(seed=4)
    shop = interlude.Shop(g)
    assert len(shop.stock) == 5
    ok, msg = shop.buy(g, 0)
    assert not ok and "need" in msg
    g.player.tickets = 100
    price = shop.stock[0].price
    ok, _ = shop.buy(g, 0)
    assert ok and g.player.tickets == 100 - price and len(g.player.inventory) == 1
    g.player.inventory = [items.make("coffee")] * 9
    ok, msg = shop.buy(g, 0)
    assert not ok and "full" in msg
