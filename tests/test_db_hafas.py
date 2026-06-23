from __future__ import annotations

import re
from datetime import date

import pytest
from pytest_httpx import HTTPXMock

from eurotrek.trains.db_hafas import DbHafasClient


MOCK_JOURNEYS_RESPONSE = {
    "journeys": [
        {
            "legs": [
                {
                    "origin": {"name": "London St Pancras International"},
                    "destination": {"name": "Bruxelles-Midi"},
                    "plannedDeparture": "2026-06-29T09:01:00+01:00",
                    "plannedArrival": "2026-06-29T12:05:00+02:00",
                    "line": {
                        "name": "Eurostar 9114",
                        "operator": {"name": "Eurostar"},
                    },
                },
                {
                    "origin": {"name": "Bruxelles-Midi"},
                    "destination": {"name": "Berlin Hbf"},
                    "plannedDeparture": "2026-06-29T13:25:00+02:00",
                    "plannedArrival": "2026-06-29T19:55:00+02:00",
                    "line": {
                        "name": "ICE 16",
                        "operator": {"name": "DB"},
                    },
                },
            ],
            "price": None,
        }
    ]
}

HAFAS_URL = re.compile(r"https://v6\.db\.transport\.rest/journeys")


@pytest.mark.asyncio
async def test_search_journeys_success(httpx_mock: HTTPXMock):
    httpx_mock.add_response(method="GET", url=HAFAS_URL, json=MOCK_JOURNEYS_RESPONSE)

    client = DbHafasClient(base_url="https://v6.db.transport.rest")
    offers = await client.search_journeys("BER", date(2026, 6, 29), ttl=0)
    await client.close()

    assert len(offers) == 1
    offer = offers[0]
    assert len(offer.segments) == 2
    assert offer.segments[0].carrier == "Eurostar"
    assert offer.segments[1].carrier == "DB"
    assert offer.price_gbp is None
    assert offer.deep_link is not None
    assert "bahn.de" in offer.deep_link
    assert offer.source == "db_hafas"


@pytest.mark.asyncio
async def test_search_journeys_api_failure_returns_fallback(httpx_mock: HTTPXMock):
    httpx_mock.add_exception(exception=Exception("Connection refused"), url=HAFAS_URL)

    client = DbHafasClient(base_url="https://v6.db.transport.rest")
    offers = await client.search_journeys("PRG", date(2026, 6, 29), ttl=0)
    await client.close()

    assert len(offers) == 1
    assert offers[0].source == "url_fallback"
    assert offers[0].deep_link is not None


@pytest.mark.asyncio
async def test_search_journeys_unknown_destination():
    client = DbHafasClient(base_url="https://v6.db.transport.rest")
    offers = await client.search_journeys("XYZ", date(2026, 6, 29), ttl=0)
    await client.close()
    assert offers == []
