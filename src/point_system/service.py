from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
from gspread.exceptions import WorksheetNotFound

from .cleaning import (
    build_members_template,
    clean_catalog_df,
    clean_history_df,
    clean_members_df,
    clean_monthly_ledger_df,
)
from .config import load_config
from .constants import (
    BEHAVIOR_WORKSHEET,
    CHORES_WORKSHEET,
    DEFAULT_CHORES,
    DEFAULT_PRIZES,
    EDUCATION_WORKSHEET,
    EMPTY_HISTORY,
    EMPTY_MONTHLY_LEDGER,
    EMPTY_TASKS,
    HISTORY_RETENTION_DAYS,
    HISTORY_WORKSHEET,
    LOCAL_TIMEZONE,
    MEMBERS_WORKSHEET,
    MONTHLY_LEDGER_WORKSHEET,
    PRIZES_WORKSHEET,
)
from .sheets import GoogleSheetsStore


class PointSystemService:
    def __init__(self, store: GoogleSheetsStore):
        self.store = store

    def get_members_data(self) -> tuple[pd.DataFrame, str | int]:
        try:
            members = clean_members_df(self.store.read_worksheet(MEMBERS_WORKSHEET))
            if not members.empty:
                return members, MEMBERS_WORKSHEET
        except WorksheetNotFound:
            pass

        try:
            members = clean_members_df(self.store.read_worksheet(0))
            if not members.empty:
                return members, 0
        except Exception:
            pass

        return build_members_template(), MEMBERS_WORKSHEET

    def get_or_create_catalog(self, worksheet: str, value_column: str, defaults: pd.DataFrame) -> pd.DataFrame:
        try:
            catalog = clean_catalog_df(self.store.read_worksheet(worksheet), value_column)
            if catalog.empty:
                self.store.write_worksheet(worksheet, defaults)
                return clean_catalog_df(defaults, value_column)
            return catalog
        except WorksheetNotFound:
            self.store.create_worksheet(worksheet, defaults)
            return clean_catalog_df(defaults, value_column)

    def save_catalog(self, worksheet: str, value_column: str, data: pd.DataFrame) -> None:
        cleaned = clean_catalog_df(data, value_column)
        self.store.write_worksheet(worksheet, cleaned)

    def get_history_data(self) -> pd.DataFrame:
        try:
            return clean_history_df(self.store.read_worksheet(HISTORY_WORKSHEET))
        except WorksheetNotFound:
            self.store.create_worksheet(HISTORY_WORKSHEET, EMPTY_HISTORY)
            return EMPTY_HISTORY.copy()

    def get_monthly_ledger_data(self) -> pd.DataFrame:
        try:
            return clean_monthly_ledger_df(self.store.read_worksheet(MONTHLY_LEDGER_WORKSHEET))
        except WorksheetNotFound:
            self.store.create_worksheet(MONTHLY_LEDGER_WORKSHEET, EMPTY_MONTHLY_LEDGER)
            return EMPTY_MONTHLY_LEDGER.copy()

    def append_history_entry(
        self,
        user_name: str,
        action_label: str,
        points_delta: int,
        previous_points: int | None = None,
        current_points: int | None = None,
    ) -> None:
        now = datetime.now(LOCAL_TIMEZONE)
        cutoff = pd.Timestamp(now - timedelta(days=HISTORY_RETENTION_DAYS)).tz_localize(None)
        history_df = self.get_history_data()

        if not history_df.empty:
            history_df["Timestamp"] = pd.to_datetime(history_df["Timestamp"], errors="coerce")
            history_df = history_df[history_df["Timestamp"] >= cutoff].copy()
            history_df["Date"] = history_df["Timestamp"].dt.strftime("%Y-%m-%d")
            history_df["Time"] = history_df["Timestamp"].dt.strftime("%H:%M:%S")
            history_df["Timestamp"] = history_df["Timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")

        new_entry = pd.DataFrame(
            [
                {
                    "Date": now.strftime("%Y-%m-%d"),
                    "Time": now.strftime("%H:%M:%S"),
                    "User": user_name,
                    "Action": action_label,
                    "Points": int(points_delta),
                    "PreviousPoints": previous_points,
                    "CurrentPoints": current_points,
                    "Timestamp": now.strftime("%Y-%m-%d %H:%M:%S"),
                }
            ]
        )
        updated_history = pd.concat([new_entry, history_df], ignore_index=True)
        self.store.write_worksheet(HISTORY_WORKSHEET, updated_history)

    def append_monthly_ledger_entry(self, user_name: str, action_label: str, points_delta: int) -> None:
        now = datetime.now(LOCAL_TIMEZONE)
        ledger_df = self.get_monthly_ledger_data()
        new_entry = pd.DataFrame(
            [
                {
                    "Month": now.strftime("%Y-%m"),
                    "Date": now.strftime("%Y-%m-%d"),
                    "Time": now.strftime("%H:%M:%S"),
                    "User": user_name,
                    "Action": action_label,
                    "Points": int(points_delta),
                    "Timestamp": now.strftime("%Y-%m-%d %H:%M:%S"),
                }
            ]
        )
        updated_ledger = pd.concat([new_entry, ledger_df], ignore_index=True)
        self.store.write_worksheet(MONTHLY_LEDGER_WORKSHEET, updated_ledger)

    def get_monthly_points_total(self) -> int:
        ledger_df = self.get_monthly_ledger_data()
        if ledger_df.empty:
            return 0

        current_month = datetime.now(LOCAL_TIMEZONE).strftime("%Y-%m")
        monthly_ledger = ledger_df[ledger_df["Month"].astype(str) == current_month].copy()
        monthly_ledger = monthly_ledger[~monthly_ledger["Action"].astype(str).str.contains("מימוש", na=False)]
        if monthly_ledger.empty:
            return 0
        return int(monthly_ledger["Points"].sum())

    def load_starter_template(self, members_df: pd.DataFrame) -> None:
        starter_members = build_members_template(members_df)
        self.store.upsert_named_worksheet(MEMBERS_WORKSHEET, starter_members)
        self.store.upsert_named_worksheet(CHORES_WORKSHEET, DEFAULT_CHORES)
        self.store.upsert_named_worksheet(BEHAVIOR_WORKSHEET, EMPTY_TASKS)
        self.store.upsert_named_worksheet(EDUCATION_WORKSHEET, EMPTY_TASKS)
        self.store.upsert_named_worksheet(PRIZES_WORKSHEET, DEFAULT_PRIZES)
        self.store.upsert_named_worksheet(HISTORY_WORKSHEET, EMPTY_HISTORY)
        self.store.upsert_named_worksheet(MONTHLY_LEDGER_WORKSHEET, EMPTY_MONTHLY_LEDGER)

    def update_member_points(
        self,
        members_df: pd.DataFrame,
        members_target: str | int,
        member_name: str,
        delta: int,
        action_label: str,
    ) -> tuple[str, int, str]:
        live_members = clean_members_df(self.store.read_worksheet(members_target))
        idx = self._member_index(live_members, member_name)
        previous_points = int(live_members.at[idx, "Points"])
        current_points = previous_points + int(delta)

        live_members.at[idx, "Points"] = current_points
        self.store.write_worksheet(members_target, live_members)

        actual_points = self._read_member_points(members_target, member_name)
        if actual_points != current_points:
            self._restore_member_points(members_target, member_name, previous_points)
            raise ActionValidationError(member_name, current_points, actual_points)

        self.append_history_entry(member_name, action_label, delta, previous_points, current_points)
        self.append_monthly_ledger_entry(member_name, action_label, delta)
        return member_name, delta, action_label

    def current_member_points(self, members_df: pd.DataFrame, member_name: str) -> int:
        return int(members_df.loc[members_df["Name"] == member_name, "Points"].iloc[0])

    def clear_history(self) -> None:
        self.store.write_worksheet(HISTORY_WORKSHEET, EMPTY_HISTORY.copy())

    def _member_index(self, members_df: pd.DataFrame, member_name: str) -> int:
        matches = members_df[members_df["Name"] == member_name].index
        if matches.empty:
            raise ValueError(f"Member not found in Members worksheet: {member_name}")
        return int(matches[0])

    def _read_member_points(self, members_target: str | int, member_name: str) -> int:
        members_df = clean_members_df(self.store.read_worksheet(members_target))
        idx = self._member_index(members_df, member_name)
        return int(members_df.at[idx, "Points"])

    def _restore_member_points(self, members_target: str | int, member_name: str, points: int) -> None:
        members_df = clean_members_df(self.store.read_worksheet(members_target))
        idx = self._member_index(members_df, member_name)
        members_df.at[idx, "Points"] = int(points)
        self.store.write_worksheet(members_target, members_df)


class ActionValidationError(RuntimeError):
    def __init__(self, member_name: str, expected_points: int, actual_points: int):
        self.member_name = member_name
        self.expected_points = expected_points
        self.actual_points = actual_points
        super().__init__(
            f"Point validation failed for {member_name}: expected {expected_points}, got {actual_points}"
        )


def create_service(root: Path | None = None) -> PointSystemService:
    config = load_config(root)
    return PointSystemService(GoogleSheetsStore(config))
