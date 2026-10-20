"""Entry point: argument parsing, screens and the main input loop."""

import argparse
import curses
import os

from . import config, interlude, report, scores, ui
from .game import Game


def parse_args(argv=None):
    parser = argparse.ArgumentParser(prog="nightshift", description="Survive the IT night shift.")
    parser.add_argument("--seed", type=int, help="seed for a replayable run")
    parser.add_argument("--start-floor", type=int, default=1,
                        help=f"start on a later floor (1-{config.TOTAL_FLOORS}), for practice")
    args = parser.parse_args(argv)
    args.start_floor = max(1, min(config.TOTAL_FLOORS, args.start_floor))
    return args


class App:
    def __init__(self, scr, args):
        self.ui = ui.UI(scr)
        self.args = args

    def main(self):
        seed = self.args.seed
        self.title_screen(seed)
        while True:
            game = Game(seed=seed, start_floor=self.args.start_floor)
            result = self.play(game)
            if result == "quit":
                return
            key = self.end_screen(game)
            if key in (ord("r"), ord("R")):
                seed = game.seed
            elif key in (ord("n"), ord("N")):
                seed = None
            else:
                return

    # ------------------------------------------------------------ play loop
    def play(self, game):
        u = self.ui
        while game.state in ("playing", "floor_done"):
            if game.state == "floor_done":
                self.between_floors(game)
                game.next_floor()
                continue
            if u.too_small():
                u.draw_too_small()
                if u.get_key() in (ord("q"), ord("Q")):
                    return "quit"
                continue
            u.render(game)
            key = u.get_key()
            if key == curses.KEY_RESIZE:
                continue
            if key in ui.KEY_DIRS:
                game.move_player(*ui.KEY_DIRS[key])
            elif key in (ord(" "), ord("."), ord("z"), ord("Z")):
                game.wait()
            elif key in (ord("e"), ord("E"), ord(">")):
                game.take_lift()
            elif ord("1") <= key <= ord("9"):
                self.use_item(game, key - ord("1"))
            elif key in (ord("f"), ord("F")):
                if game.player.weapon and game.player.weapon.key == "cable":
                    d = u.ask_direction(game, "Lash which way? (arrows/WASD, Esc cancels)")
                    if d:
                        game.lash(d)
                else:
                    game.lash((0, 0))
            elif key in (ord("x"), ord("X")):
                slot = u.ask_slot(game, "Drop which item? (1-9, anything else cancels)")
                if slot is not None:
                    game.drop_item(slot)
            elif key == ord("?"):
                u.text_screen(ui.HELP_LINES)
            elif key in (ord("q"), ord("Q")):
                if u.confirm(game, "Abandon your shift?"):
                    return "quit"
        return game.state

    def between_floors(self, game):
        hour = (config.START_HOUR + game.floor) % 24
        header = (f"Floor {game.floor} survived. The lift crawls down. "
                  f"It is now {hour:02d}:00.")
        event = interlude.roll_event(game)
        if event:
            choice = self.ui.event_screen(event, header)
            result = event.choose(game, choice)
            self.ui.text_screen([(header, "dim"), ("", "normal")] + self.ui.wrap(result, "info"))
        if game.shop_closed:
            self.ui.text_screen([(header, "dim"), ("", "normal"),
                                 ("The vending machine has a laminated sign:", "normal"),
                                 ("'CHANGE FREEZE IN EFFECT'", "warn")])
        else:
            self.ui.shop_screen(game, interlude.Shop(game), header)
        if game.floor + 1 == config.TOTAL_FLOORS:
            self.ui.text_screen([
                ("06:00. The final floor.", "bad"), ("", "normal"),
                ("Every alert on your phone points to the same place:", "normal"),
                ("the main data hall, and the Exchange server that lives there.", "normal"),
                ("", "normal"),
                ("It has become sentient. It is not happy about it.", "warn")])

    def use_item(self, game, index):
        inv = game.player.inventory
        if index >= len(inv):
            return
        direction = None
        if inv[index].needs_direction:
            direction = self.ui.ask_direction(game, f"Aim the {inv[index].name.lower()} which way?")
            if direction is None:
                return
        game.use_item(index, direction)

    def title_screen(self, seed):
        lines = [(row, "title") for row in ui.TITLE_ART]
        lines += [("", "normal"),
                  ("You are the only IT tech in the building. It is 19:00.", "normal"),
                  ("Twelve floors. Twelve hours. One handover at 07:00.", "normal"),
                  ("", "normal"),
                  (f"Seed: {seed if seed is not None else 'random'}", "dim"),
                  ("", "normal"),
                  ("Top shifts", "info")]
        lines += ui.scores_lines(scores.load(), limit=5)
        self.ui.text_screen(lines, "Press any key to clock in  (? in game for help)")

    def end_screen(self, game):
        cause = report.cause_text(game)
        entries, rank = scores.record(game, cause)
        score = scores.compute_score(game)
        if game.state == "won":
            lines = [("=== HANDOVER COMPLETE ===", "good"), ("", "normal"),
                     ("REQ0000700  Shift handover", "warn"),
                     ("Status: Resolved", "normal"),
                     ("Notes from day shift: 'Quiet night, was it?'", "normal"),
                     ("", "normal"),
                     ("The Exchange server is dead. Long live the Exchange server.", "dim")]
        else:
            number, fields = report.incident_ticket(game)
            lines = [("=== YOUR SHIFT IS OVER ===", "bad"), ("", "normal"),
                     (f"{number}", "warn")]
            for name, value in fields:
                wrapped = self.ui.wrap(value, "normal", 50)
                lines.append((f"{name + ':':<19}{wrapped[0][0]}", "normal"))
                lines += [(" " * 19 + text, "normal") for text, _ in wrapped[1:]]
        lines += [("", "normal"),
                  (f"Score {score}   Floor {game.floor}   Kills {game.player.kills}   "
                   f"Seed {game.seed}", "money"), ("", "normal")]
        if game.start_floor != 1:
            lines += [("(Practice run from a later floor: not recorded.)", "dim"), ("", "normal")]
        lines += ui.scores_lines(entries, highlight=rank, limit=5)
        return self.ui.text_screen(lines, "R: replay this seed   N: new shift   Q: quit")


def run(argv=None):
    args = parse_args(argv)
    os.environ.setdefault("ESCDELAY", "25")
    try:
        curses.wrapper(lambda scr: App(scr, args).main())
    except KeyboardInterrupt:
        pass
    print("Shift ended. Remember to log your hours.")
