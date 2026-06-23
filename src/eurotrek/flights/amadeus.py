from __future__ import annotations

import re
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import httpx

from eurotrek.cache import cache_get, cache_set, make_key
from eurotrek.models import Offer, Segment


_ISO_DURATION_RE = re.compile(r"PT(?:(\d+)H)?(?:(\d+)M)?")


def _parse_iso_duration(duration: str) -> timedelta:
    m = _ISO_DURATION_RE.match(duration or "")
    if not m:
        return timedelta()
    hours = int(m.group(1) or 0)
    minutes = int(m.group(2) or 0)
    return timedelta(hours=hours, minutes=minutes)


class AmadeusClient:
    def __init__(self, client_id: str, client_secret: str, base_url: str) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._base_url = base_url.rstrip("/")
        self._token: str | None = None
        self._token_expires_at: float = 0.0
        self._http = httpx.AsyncClient(
            timeout=20.0,
            headers={"User-Agent": "eurotrek/0.1.0 personal-tool"},
        )

    async def close(self) -> None:
        await self._http.aclose()

    async def _ensure_token(self) -> None:
        if self._token and time.time() < self._token_expires_at - 30:
            return
        if not self._client_id or self._client_id == "your_client_id_here":
            self._token = None
            return
        resp = await self._http.post(
            f"{self._base_url}/v1/security/oauth2/token",
            data={
                "grant_type": "client_credentials",
                "client_id": self._client_id,
                "client_secret": self._client_secret,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        self._token = data["access_token"]
        self._token_expires_at = time.time() + data.get("expires_in", 1799)

    async def search_flights(
        self,
        origin: str,
        destination: str,
        departure_date: date,
        adults: int = 1,
        max_results: int = 10,
        currency: str = "GBP",
        ttl: int = 3600,
    ) -> list[Offer]:
        cache_key = make_key(
            "amadeus", origin, destination, departure_date.isoformat(), currency
        )
        cached = await cache_get(cache_key)
        if cached is not None:
            return [_offer_from_dict(o) for o in cached]

        try:
            await self._ensure_token()
        except Exception:
            return []

        if not self._token:
            return []

        try:
            resp = await self._http.get(
                f"{self._base_url}/v2/shopping/flight-offers",
                params={
                    "originLocationCode": origin,
                    "destinationLocationCode": destination,
                    "departureDate": departure_date.isoformat(),
                    "adults": adults,
                    "max": max_results,
                    "currencyCode": currency,
                    "nonStop": "false",
                },
                headers={"Authorization": f"Bearer {self._token}"},
            )
            resp.raise_for_status()
        except Exception:
            return []

        data = resp.json().get("data", [])
        offers = [self._parse_offer(raw, currency) for raw in data]
        offers = [o for o in offers if o is not None]
        await cache_set(cache_key, [o.to_dict() for o in offers], ttl)
        return offers

    def _parse_offer(self, raw: dict, currency: str) -> Offer | None:
        try:
            segments: list[Segment] = []
            for itin in raw.get("itineraries", []):
                for seg in itin.get("segments", []):
                    dep_info = seg["departure"]
                    arr_info = seg["arrival"]
                    segments.append(
                        Segment(
                            origin=dep_info["iataCode"],
                            destination=arr_info["iataCode"],
                            departure=datetime.fromisoformat(dep_info["at"]),
                            arrival=datetime.fromisoformat(arr_info["at"]),
                            carrier=seg.get("carrierCode", ""),
                            number=f"{seg.get('carrierCode', '')} {seg.get('number', '')}".strip(),
                            mode="flight",
                        )
                    )
            if not segments:
                return None

            total_duration = sum(
                (_parse_iso_duration(itin.get("duration", "")) for itin in raw.get("itineraries", [])),
                timedelta(),
            )
            price_info = raw.get("price", {})
            grand_total = price_info.get("grandTotal") or price_info.get("total")
            price = Decimal(str(grand_total)) if grand_total else None
            seats = raw.get("numberOfBookableSeats")

            return Offer(
                segments=segments,
                total_duration=total_duration,
                price_gbp=price,
                currency=currency,
                seats_available=int(seats) if seats is not None else None,
                deep_link=None,
                source="amadeus",
            )
        except Exception:
            return None


def _offer_from_dict(d: dict) -> Offer:
    segments = [
        Segment(
            origin=s["origin"],
            destination=s["destination"],
            departure=datetime.fromisoformat(s["departure"]),
            arrival=datetime.fromisoformat(s["arrival"]),
            carrier=s["carrier"],
            number=s["number"],
            mode=s["mode"],
        )
        for s in d.get("segments", [])
    ]
    return Offer(
        segments=segments,
        total_duration=timedelta(minutes=d.get("duration_minutes", 0)),
        price_gbp=Decimal(str(d["price_gbp"])) if d.get("price_gbp") is not None else None,
        currency=d.get("currency", "GBP"),
        seats_available=d.get("seats_available"),
        deep_link=d.get("deep_link"),
        source=d.get("source", "amadeus"),
    )
