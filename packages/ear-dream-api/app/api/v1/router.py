from fastapi import APIRouter

from app.api.v1 import phrases, recognize

api_router = APIRouter()
api_router.include_router(recognize.router)
api_router.include_router(phrases.router)
