from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

import aiosqlite

_DB_PATH = Path.home() / ".config" / "eurotrek" / "cache.db"


def _cache_key(*parts: str) -> str:
    raw = "|".join(parts)
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


async def _get_db() -> aiosqlite.Connection:
    _DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(_DB_PATH)
    await db.execute(
        "CREATE TABLE IF NOT EXISTS cache "
        "(key TEXT PRIMARY KEY, value TEXT, created_at REAL, ttl INTEGER)"
    )
    await db.commit()
    return db


async def cache_get(key: str) -> Any | None:
    try:
        async with aiosqlite.connect(_DB_PATH) as db:
            async with db.execute(
                "SELECT value, created_at, ttl FROM cache WHERE key = ?", (key,)
            ) as cursor:
                row = await cursor.fetchone()
                if row is None:
                    return None
                value, created_at, ttl = row
                if time.time() > created_at + ttl:
                    return None
                return json.loads(value)
    except Exception:
        return None


async def cache_set(key: str, value: Any, ttl: int) -> None:
    try:
        async with aiosqlite.connect(_DB_PATH) as db:
            await db.execute(
                "INSERT OR REPLACE INTO cache (key, value, created_at, ttl) VALUES (?, ?, ?, ?)",
                (key, json.dumps(value), time.time(), ttl),
            )
            await db.commit()
    except Exception:
        pass


async def cache_clear(older_than_hours: int = 24) -> int:
    cutoff = time.time() - older_than_hours * 3600
    try:
        async with aiosqlite.connect(_DB_PATH) as db:
            cursor = await db.execute(
                "DELETE FROM cache WHERE created_at < ?", (cutoff,)
            )
            await db.commit()
            return cursor.rowcount
    except Exception:
        return 0


def make_key(*parts: str) -> str:
    return _cache_key(*parts)
