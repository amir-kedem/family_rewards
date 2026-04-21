from __future__ import annotations

from zoneinfo import ZoneInfo

import pandas as pd

ADMIN_LABEL = "הורה"
CHILD_USERS = ["גוני", "נווה"]
DEFAULT_MEMBERS = ["גוני", "נווה", "מורית", "אמיר"]
LOGIN_OPTIONS = [*CHILD_USERS, ADMIN_LABEL]
FAMILY_GOAL = 10000
HISTORY_RETENTION_DAYS = 8
LOCAL_TIMEZONE = ZoneInfo("Asia/Jerusalem")

MEMBERS_WORKSHEET = "Members"
CHORES_WORKSHEET = "Chores"
BEHAVIOR_WORKSHEET = "Behavior"
EDUCATION_WORKSHEET = "Education"
PRIZES_WORKSHEET = "Prizes"
HISTORY_WORKSHEET = "History"
MONTHLY_LEDGER_WORKSHEET = "MonthlyLedger"

DEFAULT_CHORES = pd.DataFrame(
    [
        {"Title": "טיול ארוך לכלב", "Points": 25},
        {"Title": "טיול קצר לכלב", "Points": 10},
        {"Title": "החלפת מצעים", "Points": 10},
        {"Title": "שאיבת רצפה", "Points": 30},
        {"Title": "משימה לימודית יומית", "Points": 20},
        {"Title": "משימה לימודית מורחבת", "Points": 40},
        {"Title": "קריאת ספר (30 דק')", "Points": 15},
    ]
)

DEFAULT_PRIZES = pd.DataFrame(
    [
        {"Title": "גלידה בכלבו", "Price": 50},
        {"Title": "תוספת זמן מסך (30 דק')", "Price": 40},
        {"Title": "תוספת זמן מסך (שעה)", "Price": 80},
        {"Title": "מנוחה בבית במקום צהרון", "Price": 150},
    ]
)

EMPTY_TASKS = pd.DataFrame(columns=["Title", "Points"])
EMPTY_HISTORY = pd.DataFrame(columns=["Date", "Time", "User", "Action", "Points", "PreviousPoints", "CurrentPoints", "Timestamp"])
EMPTY_MONTHLY_LEDGER = pd.DataFrame(columns=["Month", "Date", "Time", "User", "Action", "Points", "Timestamp"])


def get_catalog_config(kind: str) -> dict:
    if kind == "chores":
        return {
            "worksheet": CHORES_WORKSHEET,
            "value_column": "Points",
            "value_label": "נקודות",
            "title_label": "שם המטלה",
            "defaults": DEFAULT_CHORES,
            "dialog_title": "הוספת מטלה",
            "empty_message": "אין מטלות זמינות כרגע.",
            "tab_label": "🧹 מטלות",
            "child_label": "🧹 מטלות",
            "action_prefix": "ביצוע",
        }
    if kind == "behavior":
        return {
            "worksheet": BEHAVIOR_WORKSHEET,
            "value_column": "Points",
            "value_label": "נקודות",
            "title_label": "שם ההתנהגות",
            "defaults": EMPTY_TASKS,
            "dialog_title": "הוספת התנהגות חיובית",
            "empty_message": "אין משימות התנהגות זמינות כרגע.",
            "tab_label": "🌟 התנהגות חיובית",
            "child_label": "🌟 התנהגות חיובית",
            "action_prefix": "ביצוע",
        }
    if kind == "education":
        return {
            "worksheet": EDUCATION_WORKSHEET,
            "value_column": "Points",
            "value_label": "נקודות",
            "title_label": "שם המשימה",
            "defaults": EMPTY_TASKS,
            "dialog_title": "הוספת משימה לימודית",
            "empty_message": "אין משימות לימוד זמינות כרגע.",
            "tab_label": "📚 משימות לימוד",
            "child_label": "📚 משימות לימוד",
            "action_prefix": "ביצוע",
        }
    return {
        "worksheet": PRIZES_WORKSHEET,
        "value_column": "Price",
        "value_label": "מחיר",
        "title_label": "שם הפרס",
        "defaults": DEFAULT_PRIZES,
        "dialog_title": "הוספת פרס",
        "empty_message": "אין פרסים זמינים כרגע.",
        "tab_label": "🎁 מימוש פרס",
    }
