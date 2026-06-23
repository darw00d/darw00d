from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Literal


@dataclass
class Segment:
    origin: str
    destination: str
    departure: datetime
    arrival: datetime
    carrier: str
    number: str
    mode: Literal["flight", "train"]

    def duration(self) -> timedelta:
        return self.arrival - self.departure


@dataclass
class Offer:
    segments: list[Segment]
    total_duration: timedelta
    price_gbp: Decimal | None
    currency: str
    seats_available: int | None
    deep_link: str | None
    source: str

    @property
    def stops(self) -> int:
        return len(self.segments) - 1

    @property
    def origin(self) -> str:
        return self.segments[0].origin if self.segments else ""

    @property
    def destination(self) -> str:
        return self.segments[-1].destination if self.segments else ""

    @property
    def departure(self) -> datetime | None:
        return self.segments[0].departure if self.segments else None

    @property
    def arrival(self) -> datetime | None:
        return self.segments[-1].arrival if self.segments else None

    def to_dict(self) -> dict:
        return {
            "origin": self.origin,
            "destination": self.destination,
            "departure": self.departure.isoformat() if self.departure else None,
            "arrival": self.arrival.isoformat() if self.arrival else None,
            "duration_minutes": int(self.total_duration.total_seconds() / 60),
            "stops": self.stops,
            "price_gbp": float(self.price_gbp) if self.price_gbp is not None else None,
            "currency": self.currency,
            "seats_available": self.seats_available,
            "deep_link": self.deep_link,
            "source": self.source,
            "segments": [
                {
                    "origin": s.origin,
                    "destination": s.destination,
                    "departure": s.departure.isoformat(),
                    "arrival": s.arrival.isoformat(),
                    "carrier": s.carrier,
                    "number": s.number,
                    "mode": s.mode,
                }
                for s in self.segments
            ],
        }
