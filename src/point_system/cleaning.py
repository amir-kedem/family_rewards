from __future__ import annotations

import pandas as pd

from .constants import DEFAULT_MEMBERS


def clean_members_df(df: pd.DataFrame) -> pd.DataFrame:
    members = df.copy()
    if "Name" not in members.columns:
        members["Name"] = ""
    if "Points" not in members.columns:
        members["Points"] = 0

    members = members[["Name", "Points"]].dropna(subset=["Name"])
    members["Name"] = members["Name"].astype(str).str.strip()
    members = members[members["Name"] != ""].reset_index(drop=True)
    members["Points"] = pd.to_numeric(members["Points"], errors="coerce").fillna(0).astype(int)
    return members


def build_members_template(existing_members: pd.DataFrame | None = None) -> pd.DataFrame:
    if existing_members is None or existing_members.empty:
        members = pd.DataFrame({"Name": DEFAULT_MEMBERS, "Points": [0] * len(DEFAULT_MEMBERS)})
    else:
        members = clean_members_df(existing_members)

    for member_name in DEFAULT_MEMBERS:
        if member_name not in members["Name"].tolist():
            members = pd.concat(
                [members, pd.DataFrame([{"Name": member_name, "Points": 0}])],
                ignore_index=True,
            )

    members = members.drop_duplicates(subset=["Name"], keep="first").reset_index(drop=True)
    return clean_members_df(members)


def clean_catalog_df(df: pd.DataFrame, value_column: str) -> pd.DataFrame:
    catalog = df.copy()
    if "Title" not in catalog.columns:
        catalog["Title"] = ""
    if value_column not in catalog.columns:
        catalog[value_column] = 0

    catalog = catalog[["Title", value_column]].dropna(subset=["Title"])
    catalog["Title"] = catalog["Title"].astype(str).str.strip()
    catalog = catalog[catalog["Title"] != ""].reset_index(drop=True)
    catalog[value_column] = pd.to_numeric(catalog[value_column], errors="coerce").fillna(0).astype(int)
    catalog = catalog[catalog[value_column] > 0].reset_index(drop=True)
    catalog = catalog.sort_values(by=[value_column, "Title"], ascending=[True, True], kind="stable").reset_index(drop=True)
    return catalog


def clean_history_df(df: pd.DataFrame) -> pd.DataFrame:
    history = df.copy()
    for column in ["Date", "Time", "User", "Action", "Points", "PreviousPoints", "CurrentPoints", "Timestamp"]:
        if column not in history.columns:
            history[column] = ""

    history = history[["Date", "Time", "User", "Action", "Points", "PreviousPoints", "CurrentPoints", "Timestamp"]].dropna(how="all")
    history["User"] = history["User"].astype(str).str.strip()
    history["Action"] = history["Action"].astype(str).str.strip()
    history["Points"] = pd.to_numeric(history["Points"], errors="coerce").fillna(0).astype(int)
    history["PreviousPoints"] = pd.to_numeric(history["PreviousPoints"], errors="coerce")
    history["CurrentPoints"] = pd.to_numeric(history["CurrentPoints"], errors="coerce")
    history["Timestamp"] = pd.to_datetime(history["Timestamp"], errors="coerce")
    history = history.dropna(subset=["Timestamp"]).sort_values(by="Timestamp", ascending=False, kind="stable").reset_index(drop=True)
    history["Date"] = history["Timestamp"].dt.strftime("%Y-%m-%d")
    history["Time"] = history["Timestamp"].dt.strftime("%H:%M:%S")
    history["PreviousPoints"] = history["PreviousPoints"].astype("Int64")
    history["CurrentPoints"] = history["CurrentPoints"].astype("Int64")
    history["Timestamp"] = history["Timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")
    return history


def clean_monthly_ledger_df(df: pd.DataFrame) -> pd.DataFrame:
    ledger = df.copy()
    for column in ["Month", "Date", "Time", "User", "Action", "Points", "Timestamp"]:
        if column not in ledger.columns:
            ledger[column] = ""

    ledger = ledger[["Month", "Date", "Time", "User", "Action", "Points", "Timestamp"]].dropna(how="all")
    ledger["User"] = ledger["User"].astype(str).str.strip()
    ledger["Action"] = ledger["Action"].astype(str).str.strip()
    ledger["Points"] = pd.to_numeric(ledger["Points"], errors="coerce").fillna(0).astype(int)
    ledger["Timestamp"] = pd.to_datetime(ledger["Timestamp"], errors="coerce")
    ledger = ledger.dropna(subset=["Timestamp"]).sort_values(by="Timestamp", ascending=False, kind="stable").reset_index(drop=True)
    ledger["Month"] = ledger["Timestamp"].dt.strftime("%Y-%m")
    ledger["Date"] = ledger["Timestamp"].dt.strftime("%Y-%m-%d")
    ledger["Time"] = ledger["Timestamp"].dt.strftime("%H:%M:%S")
    ledger["Timestamp"] = ledger["Timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")
    return ledger
