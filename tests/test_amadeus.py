from __future__ import annotations

import re
from datetime import date, timedelta
from decimal import Decimal

import pytest
from pytest_httpx import HTTPXMock

from eurotrek.flights.amadeus import AmadeusClient, _parse_iso_duration


MOCK_TOKEN_RESPONSE = {
    "type": "amadeusOAuth2Token",
    "access_token": "test-token-abc123",
    "expires_in": 1799,
    "state": "approved",
}

MOCK_FLIGHT_RESPONSE = {
    "data": [
        {
            "itineraries": [
                {
                    "duration": "PT2H30M",
                    "segments": [
                        {
                            "departure": {"iataCode": "LHR", "at": "2026-06-29T08:00:00"},
                            "arrival": {"iataCode": "PRG", "at": "2026-06-29T10:30:00"},
                            "carrierCode": "BA",
                            "number": "701",
                        }
                    ],
                }
            ],
            "price": {"grandTotal": "89.50", "currency": "GBP"},
            "numberOfBookableSeats": 4,
        }
    ]
}

TOKEN_URL = re.compile(r"https://test\.api\.amadeus\.com/v1/security/oauth2/token")
FLIGHTS_URL = re.compile(r"https://test\.api\.amadeus\.com/v2/shopping/flight-offers")


def test_parse_iso_duration():
    assert _parse_iso_duration("PT2H30M") == timedelta(hours=2, minutes=30)
    assert _parse_iso_duration("PT45M") == timedelta(minutes=45)
    assert _parse_iso_duration("PT1H") == timedelta(hours=1)
    assert _parse_iso_duration("") == timedelta()


@pytest.mark.asyncio
async def test_search_flights_success(httpx_mock: HTTPXMock):
    httpx_mock.add_response(method="POST", url=TOKEN_URL, json=MOCK_TOKEN_RESPONSE)
    httpx_mock.add_response(method="GET", url=FLIGHTS_URL, json=MOCK_FLIGHT_RESPONSE)

    client = AmadeusClient(
        client_id="test-id",
        client_secret="test-secret",
        base_url="https://test.api.amadeus.com",
    )
    offers = await client.search_flights("LHR", "PRG", date(2026, 6, 29), ttl=0)
    await client.close()

    assert len(offers) == 1
    offer = offers[0]
    assert offer.origin == "LHR"
    assert offer.destination == "PRG"
    assert offer.price_gbp == Decimal("89.50")
    assert offer.total_duration == timedelta(hours=2, minutes=30)
    assert offer.seats_available == 4
    assert offer.source == "amadeus"
    assert len(offer.segments) == 1
    assert offer.segments[0].carrier == "BA"
    assert offer.segments[0].number == "BA 701"


@pytest.mark.asyncio
async def test_search_flights_no_credentials():
    client = AmadeusClient(
        client_id="your_client_id_here",
        client_secret="",
        base_url="https://test.api.amadeus.com",
    )
    offers = await client.search_flights("LHR", "PRG", date(2026, 6, 29), ttl=0)
    await client.close()
    assert offers == []


@pytest.mark.asyncio
async def test_search_flights_api_error(httpx_mock: HTTPXMock):
    httpx_mock.add_response(method="POST", url=TOKEN_URL, json=MOCK_TOKEN_RESPONSE)
    httpx_mock.add_response(
        method="GET",
        url=FLIGHTS_URL,
        status_code=429,
        json={"errors": [{"code": 38192, "title": "Too many requests"}]},
    )

    client = AmadeusClient(
        client_id="test-id",
        client_secret="test-secret",
        base_url="https://test.api.amadeus.com",
    )
    offers = await client.search_flights("LHR", "PRG", date(2026, 6, 29), ttl=0)
    await client.close()
    assert offers == []
