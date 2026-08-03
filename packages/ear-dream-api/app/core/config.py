from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="EAR_DREAM_")

    app_name: str = "Ear Dream API"
    api_v1_prefix: str = "/api/v1"
    cors_allow_origins: list[str] = ["*"]


settings = Settings()
