"""Stable sub-seeds. Python's str seeding isn't portable (Brython in the web
build hashes it differently), so derive integer seeds with FNV-1a instead."""

import random


def derive(*parts):
    h = 0xCBF29CE484222325
    for byte in ":".join(str(p) for p in parts).encode():
        h = ((h ^ byte) * 0x100000001B3) & 0xFFFFFFFFFFFFFFFF
    # Fold to 32 bits: Brython seeds Mersenne Twister wrongly from ints past 2**53.
    return (h ^ (h >> 32)) & 0xFFFFFFFF


def rng(*parts):
    return random.Random(derive(*parts))
