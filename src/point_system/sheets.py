from __future__ import annotations

from typing import Any

import pandas as pd
from gspread.exceptions import APIError, WorksheetNotFound
from gspread_dataframe import get_as_dataframe, set_with_dataframe
from gspread import service_account_from_dict

from .config import AppConfig


class SheetAccessError(RuntimeError):
    def __init__(self, action: str, original: Exception):
        self.action = action
        self.original = original
        self.status_code = getattr(getattr(original, "response", None), "status_code", "Unknown")
        super().__init__(f"Google Sheets error while {action}: {original}")


class GoogleSheetsStore:
    def __init__(self, config: AppConfig):
        self.config = config
        try:
            self.client = service_account_from_dict(config.service_account_info)
            self.spreadsheet = self.client.open_by_url(config.spreadsheet)
        except APIError as exc:
            raise SheetAccessError("opening spreadsheet", exc) from exc

    def _worksheet(self, worksheet: str | int) -> Any:
        try:
            if isinstance(worksheet, int):
                result = self.spreadsheet.get_worksheet(worksheet)
                if result is None:
                    raise WorksheetNotFound(f"Worksheet index {worksheet} not found")
                return result
            return self.spreadsheet.worksheet(worksheet)
        except WorksheetNotFound:
            raise
        except APIError as exc:
            raise SheetAccessError(f"opening worksheet {worksheet}", exc) from exc

    def read_worksheet(self, worksheet: str | int) -> pd.DataFrame:
        try:
            return get_as_dataframe(self._worksheet(worksheet), evaluate_formulas=True)
        except WorksheetNotFound:
            raise
        except APIError as exc:
            raise SheetAccessError(f"reading worksheet {worksheet}", exc) from exc

    def create_worksheet(self, worksheet: str, data: pd.DataFrame) -> None:
        rows = max(len(data) + 5, 20)
        cols = max(len(data.columns) + 2, 4)
        try:
            self.spreadsheet.add_worksheet(title=worksheet, rows=rows, cols=cols)
        except APIError as exc:
            raise SheetAccessError(f"creating worksheet {worksheet}", exc) from exc
        self.write_worksheet(worksheet, data)

    def write_worksheet(self, worksheet: str | int, data: pd.DataFrame) -> None:
        try:
            target = self._worksheet(worksheet)
            target.clear()
            set_with_dataframe(target, data, include_index=False, resize=True)
        except WorksheetNotFound:
            raise
        except APIError as exc:
            raise SheetAccessError(f"updating worksheet {worksheet}", exc) from exc

    def upsert_named_worksheet(self, worksheet: str, data: pd.DataFrame) -> None:
        try:
            self.write_worksheet(worksheet, data)
        except WorksheetNotFound:
            self.create_worksheet(worksheet, data)
