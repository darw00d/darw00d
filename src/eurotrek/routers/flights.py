from __future__ import annotations

import asyncio
from datetime import date, timedelta
from typing import Annotated

from fastapi import APIRouter, Query, Request

from eurotrek.flights.constants import DESTINATIONS, UK_AIRPORTS
from eurotrek.models import Offer

router = APIRouter()


def _resolve_dates(days_param: str) -> list[date]:
    today = date.today()
    if ".." in days_param:
        parts = days_param.split("..")
        start = int(parts[0])
        end = int(parts[1])
        return [today + timedelta(days=i) for i in range(start, end + 1)]
    elif "," in days_param:
        return [today + timedelta(days=int(d)) for d in days_param.split(",")]
    else:
        n = int(days_param)
        return [today + timedelta(days=i) for i in range(1, n + 1)]


def _sort_offers(offers: list[Offer], sort: str) -> list[Offer]:
    if sort == "depart":
        return sorted(offers, key=lambda o: o.departure or date.min)
    if sort == "duration":
        return sorted(offers, key=lambda o: o.total_duration)
    # default: price (None prices go last)
    return sorted(offers, key=lambda o: (o.price_gbp is None, o.price_gbp or 0))


@router.get("/flights")
async def search_flights(
    request: Request,
    origins: str = Query(default=",".join(UK_AIRPORTS.keys())),
    destinations: str = Query(default=",".join(DESTINATIONS.keys())),
    days: str = Query(default="1..10"),
    sort: str = Query(default="price"),
    currency: str = Query(default="GBP"),
    no_cache: bool = Query(default=False, alias="no_cache"),
) -> dict:
    amadeus = request.app.state.amadeus
    origin_list = [o.strip().upper() for o in origins.split(",") if o.strip()]
    dest_list = [d.strip().upper() for d in destinations.split(",") if d.strip()]
    date_list = _resolve_dates(days)

    combos = [
        (origin, dest, dep_date)
        for origin in origin_list
        for dest in dest_list
        for dep_date in date_list
        if origin in UK_AIRPORTS and dest in DESTINATIONS
    ]

    async def fetch(origin: str, dest: str, dep_date: date) -> list[Offer]:
        try:
            return await amadeus.search_flights(
                origin=origin,
                destination=dest,
                departure_date=dep_date,
                currency=currency,
            )
        except Exception:
            return []

    results_nested = await asyncio.gather(*[fetch(o, d, dt) for o, d, dt in combos])
    all_offers: list[Offer] = [offer for sublist in results_nested for offer in sublist]
    sorted_offers = _sort_offers(all_offers, sort)

    return {
        "offers": [o.to_dict() for o in sorted_offers],
        "count": len(sorted_offers),
        "origins_searched": origin_list,
        "destinations_searched": dest_list,
        "dates_searched": [d.isoformat() for d in date_list],
    }
