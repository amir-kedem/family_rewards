from __future__ import annotations

import argparse
import ast
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd
from gspread import service_account_from_dict
from gspread_dataframe import get_as_dataframe, set_with_dataframe


ROOT = Path(__file__).resolve().parents[1]
APP_PATH = ROOT / "app.py"
SECRETS_PATH = ROOT / ".streamlit" / "secrets.toml"
QA_WORKSHEET = "QA_Check"


def run_step(name: str, fn):
    print(f"[QA] {name}...")
    fn()
    print(f"[QA] {name}: OK")


def assert_true(condition: bool, message: str):
    if not condition:
        raise AssertionError(message)


def compile_app():
    subprocess.run([sys.executable, "-m", "py_compile", str(APP_PATH)], check=True, cwd=ROOT)


def load_symbols() -> dict[str, Any]:
    source = APP_PATH.read_text(encoding="utf-8")
    module = ast.parse(source, filename=str(APP_PATH))

    assign_names = {
        "CHILD_USERS",
        "DEFAULT_MEMBERS",
        "FAMILY_GOAL",
        "HISTORY_RETENTION_DAYS",
        "LOCAL_TIMEZONE",
    }
    function_names = {
        "clean_members_df",
        "build_members_template",
        "clean_catalog_df",
        "clean_history_df",
        "clean_monthly_ledger_df",
        "get_monthly_points_total",
    }

    selected_nodes: list[ast.stmt] = []
    for node in module.body:
        if isinstance(node, ast.Assign):
            target_names = {target.id for target in node.targets if isinstance(target, ast.Name)}
            if target_names & assign_names:
                selected_nodes.append(node)
        elif isinstance(node, ast.FunctionDef) and node.name in function_names:
            selected_nodes.append(node)

    isolated_module = ast.Module(body=selected_nodes, type_ignores=[])
    code = compile(isolated_module, filename=str(APP_PATH), mode="exec")
    env: dict[str, Any] = {
        "pd": pd,
        "datetime": datetime,
        "timedelta": timedelta,
        "ZoneInfo": ZoneInfo,
    }
    exec(code, env)
    return env


def test_member_template(env: dict[str, Any]):
    build_members_template = env["build_members_template"]
    child_users = env["CHILD_USERS"]
    default_members = env["DEFAULT_MEMBERS"]

    existing = pd.DataFrame(
        [
            {"Name": "אמיר", "Points": 12},
            {"Name": "מורית", "Points": 7},
            {"Name": "אורח", "Points": 3},
        ]
    )
    result = build_members_template(existing)

    names = result["Name"].tolist()
    assert_true(all(name in names for name in default_members), "default members are missing from template")
    assert_true(all(name in default_members for name in child_users), "child users must remain a subset of members")
    assert_true(int(result.loc[result["Name"] == "אמיר", "Points"].iloc[0]) == 12, "existing member points should be preserved")
    assert_true("אורח" in names, "existing non-default members should not be dropped")


def test_catalog_sorting(env: dict[str, Any]):
    clean_catalog_df = env["clean_catalog_df"]
    df = pd.DataFrame(
        [
            {"Title": "bbb", "Points": 20},
            {"Title": "aaa", "Points": 20},
            {"Title": "ccc", "Points": 5},
            {"Title": "drop", "Points": 0},
        ]
    )
    result = clean_catalog_df(df, "Points")
    pairs = list(result[["Title", "Points"]].itertuples(index=False, name=None))
    assert_true(pairs == [("ccc", 5), ("aaa", 20), ("bbb", 20)], "catalogs must sort by amount then title")


def test_history_cleanup(env: dict[str, Any]):
    clean_history_df = env["clean_history_df"]
    now = datetime.now()
    older = now - timedelta(days=2)
    df = pd.DataFrame(
        [
            {"Date": "", "Time": "", "User": "גוני", "Action": "ביצוע משהו", "Points": 10, "Timestamp": now.strftime("%Y-%m-%d %H:%M:%S")},
            {"Date": "", "Time": "", "User": "נווה", "Action": "ביצוע אחר", "Points": 5, "Timestamp": older.strftime("%Y-%m-%d %H:%M:%S")},
        ]
    )
    result = clean_history_df(df)
    assert_true(result.iloc[0]["User"] == "גוני", "history should sort newest first")
    assert_true(result.iloc[1]["User"] == "נווה", "history should retain older rows within retention")
    assert_true(result.iloc[0]["Date"] != "", "history should backfill date")
    assert_true(result.iloc[0]["Time"] != "", "history should backfill time")


def test_monthly_goal_logic(env: dict[str, Any]):
    get_monthly_points_total = env["get_monthly_points_total"]
    local_timezone = env["LOCAL_TIMEZONE"]
    now = datetime.now(local_timezone).replace(microsecond=0)
    previous_month = (now.replace(day=1) - timedelta(days=1)).replace(hour=12, minute=0, second=0, microsecond=0)

    ledger_df = pd.DataFrame(
        [
            {"Month": now.strftime("%Y-%m"), "Date": "", "Time": "", "User": "גוני", "Action": "ביצוע מטלה", "Points": 20, "Timestamp": now.strftime("%Y-%m-%d %H:%M:%S")},
            {"Month": now.strftime("%Y-%m"), "Date": "", "Time": "", "User": "גוני", "Action": "ביצוע התנהגות", "Points": 15, "Timestamp": now.strftime("%Y-%m-%d %H:%M:%S")},
            {"Month": now.strftime("%Y-%m"), "Date": "", "Time": "", "User": "גוני", "Action": "ביטול: ביצוע מטלה", "Points": -20, "Timestamp": now.strftime("%Y-%m-%d %H:%M:%S")},
            {"Month": now.strftime("%Y-%m"), "Date": "", "Time": "", "User": "גוני", "Action": "מימוש פרס", "Points": -50, "Timestamp": now.strftime("%Y-%m-%d %H:%M:%S")},
            {"Month": previous_month.strftime("%Y-%m"), "Date": "", "Time": "", "User": "גוני", "Action": "ביצוע ישן", "Points": 100, "Timestamp": previous_month.strftime("%Y-%m-%d %H:%M:%S")},
        ]
    )
    env["get_monthly_ledger_data"] = lambda: ledger_df.copy()
    total = get_monthly_points_total()
    assert_true(total == 15, f"monthly goal should count earned points minus undo and exclude prizes, got {total}")


def test_source_has_expected_sections():
    source = APP_PATH.read_text(encoding="utf-8")
    required_tokens = [
        "BEHAVIOR_WORKSHEET",
        "EDUCATION_WORKSHEET",
        "MONTHLY_LEDGER_WORKSHEET",
        "render_history_tab",
        "show_success_popup",
    ]
    for token in required_tokens:
        assert_true(token in source, f"missing expected app section: {token}")


def load_local_gsheets_config() -> dict[str, Any]:
    text = SECRETS_PATH.read_text(encoding="utf-8")
    config: dict[str, Any] = {}
    in_section = False
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("["):
            in_section = line == "[connections.gsheets]"
            continue
        if not in_section or "=" not in line:
            continue
        key, value = line.split("=", 1)
        config[key.strip()] = ast.literal_eval(value.strip())
    assert_true("spreadsheet" in config, "missing spreadsheet in .streamlit/secrets.toml")
    return config


def get_gspread_handles():
    config = load_local_gsheets_config()
    spreadsheet_url = config.pop("spreadsheet")
    client = service_account_from_dict(config)
    spreadsheet = client.open_by_url(spreadsheet_url)
    return spreadsheet, spreadsheet_url


def run_live_read_check():
    spreadsheet, spreadsheet_url = get_gspread_handles()
    print(f"[QA] Live read spreadsheet: {spreadsheet_url}")
    required_tabs = ["Members", "Chores", "Behavior", "Education", "Prizes", "History", "MonthlyLedger"]
    for tab in required_tabs:
        worksheet = spreadsheet.worksheet(tab)
        _ = get_as_dataframe(worksheet, evaluate_formulas=True)
    print("[QA] Live read connection: OK")


def run_live_write_check():
    spreadsheet, spreadsheet_url = get_gspread_handles()
    print(f"[QA] Live write spreadsheet: {spreadsheet_url}")
    payload = pd.DataFrame(
        [
            {
                "CheckedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "Status": "OK",
                "Note": "predeploy smoke test",
            }
        ]
    )
    try:
        worksheet = spreadsheet.worksheet(QA_WORKSHEET)
    except Exception:
        worksheet = spreadsheet.add_worksheet(title=QA_WORKSHEET, rows=20, cols=4)
    worksheet.clear()
    set_with_dataframe(worksheet, payload)
    written_back = get_as_dataframe(worksheet, evaluate_formulas=True).dropna(how="all")
    assert_true(not written_back.empty, "QA write worksheet is empty after write")
    print("[QA] Live write smoke test: OK")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--live-read", action="store_true", help="Verify live Google Sheets read access")
    parser.add_argument("--live-write", action="store_true", help="Verify live Google Sheets write access using QA_Check worksheet")
    args = parser.parse_args()

    env = load_symbols()
    run_step("Python compile", compile_app)
    run_step("Member template rules", lambda: test_member_template(env))
    run_step("Catalog sorting", lambda: test_catalog_sorting(env))
    run_step("History cleanup", lambda: test_history_cleanup(env))
    run_step("Monthly goal logic", lambda: test_monthly_goal_logic(env))
    run_step("Expected app sections", test_source_has_expected_sections)
    if args.live_read:
        run_step("Live Google Sheets read", run_live_read_check)
    if args.live_write:
        run_step("Live Google Sheets write", run_live_write_check)
    print("[QA] All checks passed.")


if __name__ == "__main__":
    main()
