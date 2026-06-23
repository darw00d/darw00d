from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parents[2] / ".env")


@dataclass
class Settings:
    amadeus_client_id: str
    amadeus_client_secret: str
    amadeus_env: str = "test"
    db_hafas_base_url: str = "https://v6.db.transport.rest"
    cache_ttl_flights: int = 3600
    cache_ttl_trains: int = 14400
    default_currency: str = "GBP"
    port: int = 8000

    @property
    def amadeus_base_url(self) -> str:
        if self.amadeus_env == "production":
            return "https://api.amadeus.com"
        return "https://test.api.amadeus.com"


def load_settings() -> Settings:
    client_id = os.getenv("AMADEUS_CLIENT_ID", "")
    client_secret = os.getenv("AMADEUS_CLIENT_SECRET", "")
    if not client_id or client_id == "your_client_id_here":
        print(
            "Warning: AMADEUS_CLIENT_ID not set. "
            "Copy .env.example to .env and add your Amadeus credentials. "
            "Flight search will return empty results."
        )
    return Settings(
        amadeus_client_id=client_id,
        amadeus_client_secret=client_secret,
        amadeus_env=os.getenv("AMADEUS_ENV", "test"),
        db_hafas_base_url=os.getenv("DB_HAFAS_BASE_URL", "https://v6.db.transport.rest"),
        cache_ttl_flights=int(os.getenv("CACHE_TTL_FLIGHTS", "3600")),
        cache_ttl_trains=int(os.getenv("CACHE_TTL_TRAINS", "14400")),
        default_currency=os.getenv("DEFAULT_CURRENCY", "GBP"),
        port=int(os.getenv("PORT", "8000")),
    )


settings = load_settings()
