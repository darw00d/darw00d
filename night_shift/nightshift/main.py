"""Entry point: argument parsing, screens and the main input loop."""

import argparse
import curses
import os

from . import config, ui
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
            elif key == ord("?"):
                u.text_screen(ui.HELP_LINES)
            elif key in (ord("q"), ord("Q")):
                if u.confirm(game, "Abandon your shift?"):
                    return "quit"
        return game.state

    def end_screen(self, game):
        lines = [("SHIFT OVER", "bad"), ("", "normal"),
                 (f"Cause: {game.cause}", "normal"),
                 (f"Seed: {game.seed}", "dim")]
        return self.ui.text_screen(lines, "R: replay seed   N: new shift   Q: quit")


def run(argv=None):
    args = parse_args(argv)
    os.environ.setdefault("ESCDELAY", "25")
    try:
        curses.wrapper(lambda scr: App(scr, args).main())
    except KeyboardInterrupt:
        pass
    print("Shift ended. Remember to log your hours.")
