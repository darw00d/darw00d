from __future__ import annotations

import uvicorn
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from eurotrek.config import settings
from eurotrek.flights.amadeus import AmadeusClient
from eurotrek.routers.flights import router as flights_router
from eurotrek.routers.trains import router as trains_router
from eurotrek.trains.db_hafas import DbHafasClient

STATIC_DIR = Path(__file__).parents[2] / "static"

app = FastAPI(title="EuroTrek", description="UK → Central Europe flight and train checker")


@app.on_event("startup")
async def startup() -> None:
    app.state.amadeus = AmadeusClient(
        client_id=settings.amadeus_client_id,
        client_secret=settings.amadeus_client_secret,
        base_url=settings.amadeus_base_url,
    )
    app.state.hafas = DbHafasClient(base_url=settings.db_hafas_base_url)


@app.on_event("shutdown")
async def shutdown() -> None:
    await app.state.amadeus.close()
    await app.state.hafas.close()


app.include_router(flights_router, prefix="/api")
app.include_router(trains_router, prefix="/api")

if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


def run() -> None:
    uvicorn.run("eurotrek.main:app", host="0.0.0.0", port=settings.port, reload=True)


if __name__ == "__main__":
    run()
