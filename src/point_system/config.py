from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import tomllib
except ModuleNotFoundError:
    tomllib = None
    import toml


class ConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class AppConfig:
    spreadsheet: str
    service_account_info: dict[str, Any]
    admin_password: str

    @property
    def service_account_email(self) -> str:
        return str(self.service_account_info.get("client_email", ""))


def _load_streamlit_secrets(root: Path) -> dict[str, Any]:
    secrets_path = root / ".streamlit" / "secrets.toml"
    if not secrets_path.exists():
        return {}
    if tomllib is not None:
        with secrets_path.open("rb") as secrets_file:
            return tomllib.load(secrets_file)
    return toml.load(str(secrets_path))


def _load_service_account_from_env() -> dict[str, Any] | None:
    raw_json = os.getenv("POINT_SYSTEM_SERVICE_ACCOUNT_JSON")
    if raw_json:
        try:
            return json.loads(raw_json)
        except json.JSONDecodeError as exc:
            raise ConfigError("POINT_SYSTEM_SERVICE_ACCOUNT_JSON is not valid JSON") from exc

    credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if credentials_path:
        try:
            return json.loads(Path(credentials_path).read_text(encoding="utf-8"))
        except OSError as exc:
            raise ConfigError(f"Cannot read GOOGLE_APPLICATION_CREDENTIALS file: {credentials_path}") from exc
        except json.JSONDecodeError as exc:
            raise ConfigError(f"GOOGLE_APPLICATION_CREDENTIALS is not valid JSON: {credentials_path}") from exc

    return None


def load_config(root: Path | None = None) -> AppConfig:
    project_root = root or Path.cwd()
    secrets = _load_streamlit_secrets(project_root)
    gsheets_secrets = secrets.get("connections", {}).get("gsheets", {})

    spreadsheet = os.getenv("POINT_SYSTEM_SPREADSHEET") or gsheets_secrets.get("spreadsheet", "")
    if not spreadsheet:
        raise ConfigError("Missing spreadsheet URL. Set POINT_SYSTEM_SPREADSHEET or .streamlit/secrets.toml connections.gsheets.spreadsheet.")

    service_account_info = _load_service_account_from_env()
    if service_account_info is None:
        service_account_info = {key: value for key, value in gsheets_secrets.items() if key != "spreadsheet"}

    if not service_account_info:
        raise ConfigError("Missing Google service account credentials.")

    admin_password = os.getenv("POINT_SYSTEM_ADMIN_PASSWORD") or str(secrets.get("admin_password", "220911"))
    return AppConfig(
        spreadsheet=str(spreadsheet),
        service_account_info=service_account_info,
        admin_password=admin_password,
    )
