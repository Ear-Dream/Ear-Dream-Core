from fastapi import APIRouter

from app.api.v1 import model_info, phrases, recognize, sentence, speech, vocabulary

api_router = APIRouter()
api_router.include_router(recognize.router)
api_router.include_router(sentence.router)
api_router.include_router(speech.router)
api_router.include_router(vocabulary.router)
api_router.include_router(model_info.router)
api_router.include_router(phrases.router)
