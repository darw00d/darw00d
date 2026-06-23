from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal
from urllib.parse import quote

import httpx

from eurotrek.cache import cache_get, cache_set, make_key
from eurotrek.models import Offer, Segment
from eurotrek.trains.constants import DB_BOOKING_URL, STATION_IDS, STATION_NAMES


class DbHafasClient:
    def __init__(self, base_url: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._http = httpx.AsyncClient(
            timeout=15.0,
            headers={"User-Agent": "eurotrek/0.1.0 personal-tool"},
        )

    async def close(self) -> None:
        await self._http.aclose()

    async def search_journeys(
        self,
        destination_code: str,
        departure_date: date,
        results: int = 5,
        ttl: int = 14400,
    ) -> list[Offer]:
        dest_id = STATION_IDS.get(destination_code)
        if not dest_id:
            return []

        cache_key = make_key("db_hafas", destination_code, departure_date.isoformat())
        cached = await cache_get(cache_key)
        if cached is not None:
            return [_offer_from_dict(o) for o in cached]

        departure_dt = datetime.combine(departure_date, datetime.min.time().replace(hour=6))
        deep_link = DB_BOOKING_URL.format(
            destination=quote(STATION_NAMES.get(destination_code, destination_code)),
            date=departure_date.strftime("%d.%m.%Y"),
        )

        try:
            resp = await self._http.get(
                f"{self._base_url}/journeys",
                params={
                    "from": STATION_IDS["STP"],
                    "to": dest_id,
                    "departure": departure_dt.isoformat(),
                    "results": results,
                    "stopovers": "false",
                    "language": "en",
                },
            )
            resp.raise_for_status()
            journeys = resp.json().get("journeys", [])
        except Exception:
            return _url_fallback_offers(destination_code, departure_date, deep_link)

        offers = [_parse_journey(j, destination_code, deep_link) for j in journeys]
        offers = [o for o in offers if o is not None]
        await cache_set(cache_key, [o.to_dict() for o in offers], ttl)
        return offers


def _parse_journey(raw: dict, destination_code: str, deep_link: str) -> Offer | None:
    try:
        legs = raw.get("legs", [])
        if not legs:
            return None

        segments: list[Segment] = []
        for leg in legs:
            dep_str = leg.get("plannedDeparture") or leg.get("departure")
            arr_str = leg.get("plannedArrival") or leg.get("arrival")
            if not dep_str or not arr_str:
                continue
            line = leg.get("line") or {}
            operator = (line.get("operator") or {}).get("name", "")
            line_name = line.get("name") or line.get("fahrtNr") or operator or "Train"
            origin_stop = leg.get("origin") or {}
            dest_stop = leg.get("destination") or {}
            segments.append(
                Segment(
                    origin=origin_stop.get("name", ""),
                    destination=dest_stop.get("name", ""),
                    departure=datetime.fromisoformat(dep_str.replace("Z", "+00:00")),
                    arrival=datetime.fromisoformat(arr_str.replace("Z", "+00:00")),
                    carrier=operator,
                    number=line_name,
                    mode="train",
                )
            )

        if not segments:
            return None

        total_duration = segments[-1].arrival - segments[0].departure
        price_info = raw.get("price")
        price = Decimal(str(price_info["amount"])) if price_info and price_info.get("amount") else None
        currency = price_info.get("currency", "EUR") if price_info else "EUR"

        return Offer(
            segments=segments,
            total_duration=total_duration,
            price_gbp=price,
            currency=currency,
            seats_available=None,
            deep_link=deep_link,
            source="db_hafas",
        )
    except Exception:
        return None


def _url_fallback_offers(destination_code: str, departure_date: date, deep_link: str) -> list[Offer]:
    dest_name = STATION_NAMES.get(destination_code, destination_code)
    fake_dep = datetime.combine(departure_date, datetime.min.time().replace(hour=9))
    return [
        Offer(
            segments=[
                Segment(
                    origin="London St Pancras",
                    destination=dest_name,
                    departure=fake_dep,
                    arrival=fake_dep,
                    carrier="Eurostar / DB",
                    number="Check site",
                    mode="train",
                )
            ],
            total_duration=timedelta(),
            price_gbp=None,
            currency="GBP",
            seats_available=None,
            deep_link=deep_link,
            source="url_fallback",
        )
    ]


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
        currency=d.get("currency", "EUR"),
        seats_available=d.get("seats_available"),
        deep_link=d.get("deep_link"),
        source=d.get("source", "db_hafas"),
    )
