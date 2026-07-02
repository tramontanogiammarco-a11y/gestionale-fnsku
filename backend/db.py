"""Connessione MongoDB condivisa e utility di serializzazione."""
import os
from motor.motor_asyncio import AsyncIOMotorClient

# Client Mongo unico per tutta l'app (usa solo variabili d'ambiente)
_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = _client[os.environ["DB_NAME"]]


def get_db():
    """Dependency FastAPI per ottenere il database."""
    return db
