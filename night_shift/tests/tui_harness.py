"""Drive the real curses game inside a pseudo-terminal and read the screen.

Linux/macOS only (uses pty). Needs `pip install pyte`.
"""

import fcntl
import os
import pty
import select
import struct
import sys
import termios
import time

import pyte

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

KEYS = {"up": b"\x1b[A", "down": b"\x1b[B", "right": b"\x1b[C", "left": b"\x1b[D", "esc": b"\x1b"}


class TUI:
    def __init__(self, *args, cols=100, rows=30, env=None):
        self.screen = pyte.Screen(cols, rows)
        self.stream = pyte.ByteStream(self.screen)
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.chdir(ROOT)
            os.environ.update({"TERM": "xterm-256color", "LINES": str(rows),
                               "COLUMNS": str(cols), **(env or {})})
            os.execvp(sys.executable, [sys.executable, "-m", "nightshift", *args])
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        self.output = b""
        self.pump(1.0)

    def pump(self, quiet=0.15, limit=5.0):
        end = time.time() + limit
        while time.time() < end:
            r, _, _ = select.select([self.fd], [], [], quiet)
            if not r:
                return
            try:
                data = os.read(self.fd, 65536)
            except OSError:
                return
            if not data:
                return
            self.output += data
            self.stream.feed(data)

    def send(self, *keys, quiet=0.08):
        for k in keys:
            os.write(self.fd, KEYS.get(k, k.encode() if isinstance(k, str) else k))
            self.pump(quiet)
        self.pump(0.2)

    @property
    def text(self):
        return "\n".join(self.screen.display)

    def wait_exit(self, timeout=5):
        end = time.time() + timeout
        while time.time() < end:
            self.pump(0.1, 0.5)
            pid, status = os.waitpid(self.pid, os.WNOHANG)
            if pid:
                return os.waitstatus_to_exitcode(status)
        os.kill(self.pid, 9)
        raise TimeoutError("game did not exit")
