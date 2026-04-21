import pandas as pd
import streamlit as st
from gspread.exceptions import APIError, WorksheetNotFound
from streamlit_gsheets import GSheetsConnection
from datetime import datetime, timedelta
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

st.set_page_config(page_title="הבית המשותף שלנו", page_icon="🏠", layout="centered")

SHEET_URL = st.secrets["connections"]["gsheets"]["spreadsheet"]
SERVICE_ACCOUNT_EMAIL = st.secrets["connections"]["gsheets"].get("client_email", "")
ADMIN_PASSWORD = "220911"
ADMIN_LABEL = "הורה"
CHILD_USERS = ["גוני", "נווה"]
DEFAULT_MEMBERS = ["גוני", "נווה", "מורית", "אמיר"]
LOGIN_OPTIONS = [*CHILD_USERS, ADMIN_LABEL]
FAMILY_GOAL = 10000
READ_TTL = "60s"

MEMBERS_WORKSHEET = "Members"
CHORES_WORKSHEET = "Chores"
BEHAVIOR_WORKSHEET = "Behavior"
EDUCATION_WORKSHEET = "Education"
PRIZES_WORKSHEET = "Prizes"
HISTORY_WORKSHEET = "History"
MONTHLY_LEDGER_WORKSHEET = "MonthlyLedger"
HISTORY_RETENTION_DAYS = 8
LOCAL_TIMEZONE = ZoneInfo("Asia/Jerusalem")

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

conn = st.connection("gsheets", type=GSheetsConnection)


def init_session_state():
    defaults = {
        "role": None,
        "active_user": None,
        "selected_login": LOGIN_OPTIONS[0],
        "last_action": None,
        "pending_delete": None,
        "pending_child_task": None,
        "pending_clear_history": False,
        "pending_edit": None,
        "show_add_dialog": None,
        "admin_password_input": "",
        "success_message": None,
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


def style_points(_):
    return "color: #28a745; font-weight: 900; font-size: 20px;"


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


def extract_sheet_id(sheet_url: str) -> str:
    try:
        parts = [part for part in urlparse(sheet_url).path.split("/") if part]
        if "d" in parts:
            idx = parts.index("d")
            if idx + 1 < len(parts):
                return parts[idx + 1]
    except Exception:
        pass
    return "Unavailable"


def render_sheet_diagnostics():
    with st.expander("Diagnostics", expanded=True):
        st.write("אם הגישה עדיין נכשלת, השווה את הערכים האלה בין המחשב המקומי ל-Streamlit Cloud.")
        st.write("Service account email")
        st.code(SERVICE_ACCOUNT_EMAIL or "Missing")
        st.write("Spreadsheet URL")
        st.code(SHEET_URL or "Missing")
        st.write("Spreadsheet ID")
        st.code(extract_sheet_id(SHEET_URL))


def stop_for_sheet_error(exc: APIError, action: str):
    status_code = getattr(getattr(exc, "response", None), "status_code", "Unknown")
    if status_code in (401, 403):
        st.error("אין גישה לקובץ Google Sheets שהוגדר לאפליקציה.")
        st.write("יש לשתף את הגיליון עם חשבון השירות של האפליקציה בהרשאת Editor.")
        if SERVICE_ACCOUNT_EMAIL:
            st.code(SERVICE_ACCOUNT_EMAIL)
        st.write("בנוסף, ודא שהערך `connections.gsheets.spreadsheet` ב-secrets מצביע על הקובץ הנכון.")
    else:
        st.error(f"שגיאת Google Sheets בזמן {action}.")
        st.write(f"HTTP status: {status_code}")
        st.exception(exc)
    render_sheet_diagnostics()
    st.stop()


def read_worksheet(worksheet: str | int) -> pd.DataFrame:
    try:
        return conn.read(spreadsheet=SHEET_URL, worksheet=worksheet, ttl=READ_TTL)
    except APIError as exc:
        raise exc


def clear_sheet_cache():
    st.cache_data.clear()


def write_worksheet(worksheet: str | int, data: pd.DataFrame):
    try:
        conn.update(spreadsheet=SHEET_URL, worksheet=worksheet, data=data)
        clear_sheet_cache()
    except APIError as exc:
        stop_for_sheet_error(exc, f"עדכון הגיליון {worksheet}")


def create_worksheet(worksheet: str, data: pd.DataFrame):
    try:
        spreadsheet = conn.client._open_spreadsheet(spreadsheet=SHEET_URL)
    except APIError as exc:
        stop_for_sheet_error(exc, "פתיחת הגיליון")
    try:
        spreadsheet.worksheet(worksheet)
    except WorksheetNotFound:
        rows = max(len(data) + 5, 20)
        cols = max(len(data.columns) + 2, 4)
        try:
            spreadsheet.add_worksheet(title=worksheet, rows=rows, cols=cols)
        except APIError as exc:
            stop_for_sheet_error(exc, f"יצירת הלשונית {worksheet}")
    write_worksheet(worksheet, data)


def upsert_named_worksheet(worksheet: str, data: pd.DataFrame):
    try:
        write_worksheet(worksheet, data)
    except Exception:
        create_worksheet(worksheet, data)


def get_members_data() -> tuple[pd.DataFrame, str | int]:
    try:
        members = clean_members_df(read_worksheet(MEMBERS_WORKSHEET))
        if not members.empty:
            return members, MEMBERS_WORKSHEET
    except APIError as exc:
        stop_for_sheet_error(exc, f"קריאת הגיליון {MEMBERS_WORKSHEET}")
    except WorksheetNotFound:
        pass
    except Exception:
        pass

    try:
        members = clean_members_df(read_worksheet(0))
        if not members.empty:
            return members, 0
    except APIError as exc:
        stop_for_sheet_error(exc, "קריאת הגיליון הראשי")
    except Exception:
        pass

    return build_members_template(), MEMBERS_WORKSHEET


def get_or_create_catalog(worksheet: str, value_column: str, defaults: pd.DataFrame) -> pd.DataFrame:
    try:
        catalog = clean_catalog_df(read_worksheet(worksheet), value_column)
        if catalog.empty:
            write_worksheet(worksheet, defaults)
            return clean_catalog_df(defaults, value_column)
        return catalog
    except APIError as exc:
        stop_for_sheet_error(exc, f"קריאת הגיליון {worksheet}")
    except WorksheetNotFound:
        create_worksheet(worksheet, defaults)
        return clean_catalog_df(defaults, value_column)


def save_catalog(worksheet: str, value_column: str, data: pd.DataFrame):
    cleaned = clean_catalog_df(data, value_column)
    write_worksheet(worksheet, cleaned)


def get_history_data() -> pd.DataFrame:
    try:
        return clean_history_df(read_worksheet(HISTORY_WORKSHEET))
    except APIError as exc:
        stop_for_sheet_error(exc, f"קריאת הגיליון {HISTORY_WORKSHEET}")
    except WorksheetNotFound:
        create_worksheet(HISTORY_WORKSHEET, EMPTY_HISTORY)
        return EMPTY_HISTORY.copy()


def get_monthly_ledger_data() -> pd.DataFrame:
    try:
        return clean_monthly_ledger_df(read_worksheet(MONTHLY_LEDGER_WORKSHEET))
    except APIError as exc:
        stop_for_sheet_error(exc, f"קריאת הגיליון {MONTHLY_LEDGER_WORKSHEET}")
    except WorksheetNotFound:
        create_worksheet(MONTHLY_LEDGER_WORKSHEET, EMPTY_MONTHLY_LEDGER)
        return EMPTY_MONTHLY_LEDGER.copy()


def append_history_entry(user_name: str, action_label: str, points_delta: int, previous_points: int | None = None, current_points: int | None = None):
    now = datetime.now(LOCAL_TIMEZONE)
    cutoff = pd.Timestamp(now - timedelta(days=HISTORY_RETENTION_DAYS)).tz_localize(None)
    history_df = get_history_data()

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
    write_worksheet(HISTORY_WORKSHEET, updated_history)


def append_monthly_ledger_entry(user_name: str, action_label: str, points_delta: int):
    now = datetime.now(LOCAL_TIMEZONE)
    ledger_df = get_monthly_ledger_data()
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
    write_worksheet(MONTHLY_LEDGER_WORKSHEET, updated_ledger)


def get_monthly_points_total() -> int:
    ledger_df = get_monthly_ledger_data()
    if ledger_df.empty:
        return 0

    current_month = datetime.now(LOCAL_TIMEZONE).strftime("%Y-%m")
    monthly_ledger = ledger_df[ledger_df["Month"].astype(str) == current_month].copy()
    monthly_ledger = monthly_ledger[~monthly_ledger["Action"].astype(str).str.contains("מימוש", na=False)]
    if monthly_ledger.empty:
        return 0
    return int(monthly_ledger["Points"].sum())


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


def reset_login_state():
    st.session_state.role = None
    st.session_state.active_user = None
    st.session_state.admin_password_input = ""
    st.session_state.pending_delete = None
    st.session_state.pending_child_task = None
    st.session_state.pending_clear_history = False
    st.session_state.pending_edit = None
    st.session_state.show_add_dialog = None
    st.session_state.success_message = None


def show_success_popup(message: str = "פעולה עודכנה"):
    st.session_state.success_message = message
    st.rerun()


def load_starter_template(members_df: pd.DataFrame):
    starter_members = build_members_template(members_df)

    upsert_named_worksheet(MEMBERS_WORKSHEET, starter_members)
    upsert_named_worksheet(CHORES_WORKSHEET, DEFAULT_CHORES)
    upsert_named_worksheet(BEHAVIOR_WORKSHEET, EMPTY_TASKS)
    upsert_named_worksheet(EDUCATION_WORKSHEET, EMPTY_TASKS)
    upsert_named_worksheet(PRIZES_WORKSHEET, DEFAULT_PRIZES)
    upsert_named_worksheet(HISTORY_WORKSHEET, EMPTY_HISTORY)
    upsert_named_worksheet(MONTHLY_LEDGER_WORKSHEET, EMPTY_MONTHLY_LEDGER)


def update_member_points(
    members_df: pd.DataFrame,
    members_target: str | int,
    member_name: str,
    delta: int,
    action_label: str,
):
    idx = members_df[members_df["Name"] == member_name].index[0]
    previous_points = int(members_df.at[idx, "Points"])
    members_df.at[idx, "Points"] += delta
    current_points = int(members_df.at[idx, "Points"])
    write_worksheet(members_target, members_df)
    append_history_entry(member_name, action_label, delta, previous_points, current_points)
    append_monthly_ledger_entry(member_name, action_label, delta)
    st.session_state.last_action = (member_name, delta, action_label)


def current_member_points(members_df: pd.DataFrame, member_name: str) -> int:
    return int(members_df.loc[members_df["Name"] == member_name, "Points"].iloc[0])


def render_login(members_df: pd.DataFrame):
    st.subheader("🔐 כניסה למערכת")
    selected_login = st.selectbox("בחר משתמש", LOGIN_OPTIONS, key="selected_login")

    if selected_login == ADMIN_LABEL:
        password = st.text_input("סיסמה", type="password", key="admin_password_input")
    else:
        password = ""
        st.session_state.admin_password_input = ""

    if st.button("כניסה", use_container_width=True):
        if selected_login == ADMIN_LABEL:
            if password == ADMIN_PASSWORD:
                st.session_state.role = "admin"
                st.session_state.active_user = None
                st.rerun()
            else:
                st.error("סיסמה שגויה")
            return

        if selected_login not in members_df["Name"].tolist():
            st.error(f"המשתמש {selected_login} לא נמצא בגיליון Members.")
            return

        st.session_state.role = "child"
        st.session_state.active_user = selected_login
        st.rerun()


def render_header():
    col_header, col_logout = st.columns([4, 1])
    with col_header:
        if st.session_state.role == "admin":
            st.subheader("⚙️ לוח בקרה להורה")
        else:
            st.subheader(f"👋 שלום {st.session_state.active_user}")
    with col_logout:
        if st.button("יציאה"):
            reset_login_state()
            st.rerun()


def render_undo(members_df: pd.DataFrame, members_target: str | int):
    if not st.session_state.last_action:
        return

    last_user, last_points, last_type = st.session_state.last_action
    with st.warning(f"פעולה אחרונה: {last_type} ל-{last_user} ({last_points} נק')"):
        if st.button("⏮️ בטל פעולה אחרונה", key="undo_last_action"):
            idx = members_df[members_df["Name"] == last_user].index[0]
            previous_points = int(members_df.at[idx, "Points"])
            members_df.at[idx, "Points"] -= last_points
            current_points = int(members_df.at[idx, "Points"])
            write_worksheet(members_target, members_df)
            append_history_entry(last_user, f"ביטול: {last_type}", -last_points, previous_points, current_points)
            append_monthly_ledger_entry(last_user, f"ביטול: {last_type}", -last_points)
            st.session_state.last_action = None
            show_success_popup("פעולה עודכנה")


def render_anger_tab(members_df: pd.DataFrame, members_target: str | int, member_options: list[str], is_admin: bool):
    if is_admin:
        selected_user = st.radio("מי הגיבור?", member_options, key="anger_user", horizontal=True)
    else:
        selected_user = st.session_state.active_user
        st.info(f"הדיווח יירשם עבור {selected_user}")

    level = st.select_slider("עוצמת ההתקף שהיה", options=["קטן", "בינוני", "גדול"], key="anger_level")
    bonus = st.checkbox("שימוש בשיטת פריקה (אסלה/כרית/פוף) +10 בונוס", key="anger_bonus")

    if st.button("אישור וקבלת נקודות ✅", key="btn_anger"):
        points_map = {"קטן": 10, "בינוני": 20, "גדול": 40}
        earned = points_map[level] + (10 if bonus else 0)
        update_member_points(members_df, members_target, selected_user, earned, "הוספת נקודות (כעס)")
        st.balloons()
        show_success_popup("פעולה עודכנה")


def get_child_task_layout(task_options: list[tuple[str, int]]) -> tuple[int, int]:
    longest_title = max((len(str(task[0])) for task in task_options), default=0)
    columns_count = 1 if longest_title >= 24 else 2
    button_height = 110 if longest_title >= 24 else 90
    return columns_count, button_height


def render_child_task_buttons(task_options: list[tuple[str, int]], selected_user: str, kind: str, action_prefix: str):
    columns_count, button_height = get_child_task_layout(task_options)
    st.markdown(
        f"""
        <style>
        div.stButton > button {{
            white-space: pre-wrap;
            min-height: {button_height}px;
        }}
        </style>
        """,
        unsafe_allow_html=True,
    )

    for start_idx in range(0, len(task_options), columns_count):
        columns = st.columns(columns_count)
        for col_idx in range(columns_count):
            option_idx = start_idx + col_idx
            if option_idx >= len(task_options):
                continue
            task_title, task_points = task_options[option_idx]
            label = f"{task_title}\n{int(task_points)} נק'"
            with columns[col_idx]:
                if st.button(label, key=f"child_task_btn_{kind}_{option_idx}", use_container_width=True):
                    st.session_state.pending_child_task = {
                        "user": selected_user,
                        "title": task_title,
                        "points": int(task_points),
                        "action_prefix": action_prefix,
                    }
                    st.rerun()


def render_task_tab(
    members_df: pd.DataFrame,
    members_target: str | int,
    tasks_df: pd.DataFrame,
    member_options: list[str],
    is_admin: bool,
    kind: str,
):
    config = get_catalog_config(kind)

    if tasks_df.empty:
        st.info(config["empty_message"])
        return

    if is_admin:
        selected_user = st.radio("מי ביצע?", member_options, key=f"task_user_{kind}", horizontal=True)
        task_options = list(tasks_df.itertuples(index=False, name=None))
        task = st.selectbox(
            "בחר מטלה",
            task_options,
            key=f"task_choice_{kind}",
            format_func=lambda item: f"{item[0]} ({int(item[1])} נק')",
        )

        if st.button("אישור ביצוע מטלה 🧹", key=f"btn_task_{kind}"):
            earned = int(task[1])
            update_member_points(
                members_df,
                members_target,
                selected_user,
                earned,
                f"{config['action_prefix']} {task[0]}",
            )
            show_success_popup("פעולה עודכנה")
    else:
        selected_user = st.session_state.active_user
        st.info(f"הדיווח יירשם עבור {selected_user}")
        task_options = list(tasks_df.itertuples(index=False, name=None))
        render_child_task_buttons(task_options, selected_user, kind, config["action_prefix"])


def render_prizes_tab(members_df: pd.DataFrame, members_target: str | int, prizes_df: pd.DataFrame, member_options: list[str]):
    if prizes_df.empty:
        st.info("אין פרסים זמינים כרגע. הוסף פרסים במסך הניהול של ההורה.")
        return

    selected_user = st.radio("מי מממש?", member_options, key="reward_user", horizontal=True)
    prize_options = list(prizes_df.itertuples(index=False, name=None))
    reward = st.selectbox(
        "בחר פרס",
        prize_options,
        key="reward_choice",
        format_func=lambda item: f"{item[0]} ({int(item[1])} נק')",
    )

    current_points = current_member_points(members_df, selected_user)
    can_afford = current_points >= int(reward[1])

    if not can_afford:
        st.error(f"חסרות ל-{selected_user} עוד {int(reward[1]) - current_points} נקודות לפרס זה.")

    if st.button(f"אשר מימוש: {reward[0]}", disabled=not can_afford, type="primary", key="btn_reward"):
        cost = int(reward[1])
        update_member_points(members_df, members_target, selected_user, -cost, f"מימוש {reward[0]}")
        show_success_popup("פעולה עודכנה")


def render_catalog_manager(kind: str, catalog_df: pd.DataFrame):
    config = get_catalog_config(kind)
    st.subheader(config["tab_label"])

    if st.button(f"הוספת {'מטלה' if kind == 'chores' else 'פרס'}", key=f"open_add_{kind}", use_container_width=True):
        st.session_state.show_add_dialog = kind

    if catalog_df.empty:
        st.info(config["empty_message"])
        return

    for row_index, row in catalog_df.reset_index(drop=True).iterrows():
        col_title, col_value, col_edit, col_delete = st.columns([4, 1, 1, 1])
        with col_title:
            st.write(row["Title"])
        with col_value:
            st.write(f"{int(row[config['value_column']])}")
        with col_edit:
            if st.button("✏️", key=f"edit_{kind}_{row_index}", help="עדכון"):
                st.session_state.pending_edit = {
                    "kind": kind,
                    "row_index": row_index,
                    "title": row["Title"],
                    "value": int(row[config["value_column"]]),
                }
        with col_delete:
            if st.button("🗑️", key=f"delete_{kind}_{row_index}", help="מחיקה"):
                st.session_state.pending_delete = {
                    "kind": kind,
                    "row_index": row_index,
                    "title": row["Title"],
                }


def render_starter_template_tab(members_df: pd.DataFrame):
    st.subheader("טעינה ראשונית ל-Google Sheets")
    st.write("הפעולה תיצור או תעדכן את הלשוניות `Members`, `Chores`, `Prizes` עם נתוני פתיחה.")
    st.write("`Members` ייטען מהחברים הקיימים, ו-`Chores` / `Prizes` ייטענו עם רשימות ברירת המחדל.")

    confirm = st.checkbox("אני מאשר לטעון את תבנית ההתחלה לגיליון", key="confirm_starter_template")
    if st.button("טעינת תבנית התחלתית", type="primary", disabled=not confirm, key="load_starter_template"):
        load_starter_template(members_df)
        show_success_popup("פעולה עודכנה")


def render_history_tab():
    st.subheader("היסטוריית פעולות")
    if st.button("נקה היסטוריה", type="primary", key="open_clear_history"):
        st.session_state.pending_clear_history = True
        st.rerun()

    history_df = get_history_data()

    if history_df.empty:
        st.info("אין פעולות מתועדות ב-8 הימים האחרונים.")
        return

    display_df = history_df[["Date", "Time", "User", "Action", "Points", "PreviousPoints", "CurrentPoints"]].copy()
    display_df.columns = ["תאריך", "שעה", "משתמש", "פעולה", "נקודות", "נקודות לפני", "נקודות אחרי"]
    st.dataframe(display_df, use_container_width=True, hide_index=True)


@st.dialog("הוספת פריט")
def add_item_dialog(kind: str):
    config = get_catalog_config(kind)
    st.write(config["dialog_title"])

    with st.form(f"add_form_{kind}"):
        title = st.text_input(config["title_label"])
        value = st.number_input(config["value_label"], min_value=1, step=1)
        ok = st.form_submit_button("OK", type="primary")
        cancel = st.form_submit_button("Cancel")

    if cancel:
        st.session_state.show_add_dialog = None
        st.rerun()

    if ok:
        clean_title = title.strip()
        if not clean_title:
            st.error("יש למלא שם.")
            return

        catalog_df = get_or_create_catalog(
            config["worksheet"],
            config["value_column"],
            config["defaults"],
        )

        if clean_title in catalog_df["Title"].tolist():
            st.error("כבר קיים פריט בשם הזה.")
            return

        updated_df = pd.concat(
            [
                catalog_df,
                pd.DataFrame([{ "Title": clean_title, config["value_column"]: int(value) }]),
            ],
            ignore_index=True,
        )
        save_catalog(config["worksheet"], config["value_column"], updated_df)
        st.session_state.show_add_dialog = None
        show_success_popup("פעולה עודכנה")


@st.dialog("עדכון פריט")
def edit_item_dialog(edit_data: dict):
    config = get_catalog_config(edit_data["kind"])
    st.write(f"עדכון: {config['dialog_title']}")

    with st.form(f"edit_form_{edit_data['kind']}"):
        title = st.text_input(config["title_label"], value=edit_data["title"])
        value = st.number_input(config["value_label"], min_value=1, step=1, value=int(edit_data["value"]))
        update = st.form_submit_button("Update", type="primary")
        cancel = st.form_submit_button("Cancel")

    if cancel:
        st.session_state.pending_edit = None
        st.rerun()

    if update:
        clean_title = title.strip()
        if not clean_title:
            st.error("יש למלא שם.")
            return

        catalog_df = get_or_create_catalog(
            config["worksheet"],
            config["value_column"],
            config["defaults"],
        )

        duplicate_df = catalog_df.drop(index=edit_data["row_index"], errors="ignore")
        if clean_title in duplicate_df["Title"].tolist():
            st.error("כבר קיים פריט בשם הזה.")
            return

        if 0 <= edit_data["row_index"] < len(catalog_df):
            catalog_df.at[edit_data["row_index"], "Title"] = clean_title
            catalog_df.at[edit_data["row_index"], config["value_column"]] = int(value)
            save_catalog(config["worksheet"], config["value_column"], catalog_df)
        st.session_state.pending_edit = None
        show_success_popup("פעולה עודכנה")


@st.dialog("אישור מחיקה")
def confirm_delete_dialog(kind: str, row_index: int, title: str):
    config = get_catalog_config(kind)
    st.write(f"האם למחוק את '{title}'?")
    col_confirm, col_cancel = st.columns(2)

    with col_confirm:
        if st.button("מחק", type="primary", key=f"confirm_delete_{kind}_{row_index}"):
            catalog_df = get_or_create_catalog(
                config["worksheet"],
                config["value_column"],
                config["defaults"],
            )
            if 0 <= row_index < len(catalog_df):
                updated_df = catalog_df.drop(index=row_index).reset_index(drop=True)
                save_catalog(config["worksheet"], config["value_column"], updated_df)
            st.session_state.pending_delete = None
            show_success_popup("פעולה עודכנה")

    with col_cancel:
        if st.button("ביטול", key=f"cancel_delete_{kind}_{row_index}"):
            st.session_state.pending_delete = None
            st.rerun()


@st.dialog("אישור מטלה")
def confirm_child_task_dialog(members_df: pd.DataFrame, members_target: str | int, task_data: dict):
    st.write(f"האם לאשר את המטלה '{task_data['title']}'?")
    st.write(f"{task_data['points']} נק' עבור {task_data['user']}")

    col_confirm, col_cancel = st.columns(2)
    with col_confirm:
        if st.button("אישור", type="primary", key="confirm_child_task"):
            update_member_points(
                members_df,
                members_target,
                task_data["user"],
                int(task_data["points"]),
                f"{task_data['action_prefix']} {task_data['title']}",
            )
            st.session_state.pending_child_task = None
            show_success_popup("פעולה עודכנה")

    with col_cancel:
        if st.button("ביטול", key="cancel_child_task"):
            st.session_state.pending_child_task = None
            st.rerun()


@st.dialog("אישור ניקוי היסטוריה")
def confirm_clear_history_dialog():
    st.write("האם למחוק את כל ההיסטוריה?")
    col_confirm, col_cancel = st.columns(2)

    with col_confirm:
        if st.button("מחק הכל", type="primary", key="confirm_clear_history"):
            write_worksheet(HISTORY_WORKSHEET, EMPTY_HISTORY.copy())
            st.session_state.pending_clear_history = False
            show_success_popup("פעולה עודכנה")

    with col_cancel:
        if st.button("ביטול", key="cancel_clear_history"):
            st.session_state.pending_clear_history = False
            st.rerun()


@st.dialog("עדכון")
def success_dialog(message: str):
    st.write(message)
    if st.button("OK", type="primary", key="close_success_dialog"):
        st.session_state.success_message = None
        st.rerun()


init_session_state()

members_df, members_target = get_members_data()
chores_df = get_or_create_catalog(CHORES_WORKSHEET, "Points", DEFAULT_CHORES)
behavior_df = get_or_create_catalog(BEHAVIOR_WORKSHEET, "Points", EMPTY_TASKS)
education_df = get_or_create_catalog(EDUCATION_WORKSHEET, "Points", EMPTY_TASKS)
prizes_df = get_or_create_catalog(PRIZES_WORKSHEET, "Price", DEFAULT_PRIZES)
members_list = members_df["Name"].tolist()

st.title("🏠 הבית המשותף שלנו")

monthly_points = get_monthly_points_total()
col_title, col_val = st.columns([3, 1])
with col_title:
    st.write(f"#### 🎯 יעד חודשי: {monthly_points} / {FAMILY_GOAL}")
with col_val:
    if st.button("🔄 רענן נתונים"):
        clear_sheet_cache()
        st.rerun()

st.progress(min(monthly_points / FAMILY_GOAL, 1.0))
st.markdown("<h3 style='text-align: center;'>מצב הנקודות הנוכחי</h3>", unsafe_allow_html=True)

st.markdown(
    """
    <style>
    th {
        text-align: center !important;
        background-color: rgba(128, 128, 128, 0.1) !important;
        color: inherit !important;
        padding: 10px !important;
    }

    td:nth-child(1) {
        text-align: center !important;
        width: 60%;
    }

    td:nth-child(2) {
        text-align: right !important;
        padding-right: 20px !important;
        width: 40%;
    }

    table {
        width: 100% !important;
        font-size: 18px;
        border-collapse: collapse;
    }
    </style>
    """,
    unsafe_allow_html=True,
)

df_display = members_df[["Points", "Name"]].copy()
df_display.columns = ["נקודות", "שם"]

st.table(df_display.style.map(style_points, subset=["נקודות"]).hide(axis="index"))
st.divider()

if st.session_state.role is None:
    render_login(members_df)
else:
    render_header()
    is_admin = st.session_state.role == "admin"
    render_undo(members_df, members_target)

    if is_admin:
        action_tabs = st.tabs(
            [
                "🧹 מטלות",
                "🌟 התנהגות חיובית",
                "📚 משימות לימוד",
                "🎁 מימוש פרס",
                "🛠️ ניהול מטלות",
                "🛠️ ניהול התנהגות",
                "🛠️ ניהול לימוד",
                "🛍️ ניהול פרסים",
                "📥 תבנית התחלתית",
                "🕘 היסטוריה",
            ]
        )
        with action_tabs[0]:
            render_task_tab(members_df, members_target, chores_df, members_list, is_admin=True, kind="chores")
        with action_tabs[1]:
            render_task_tab(members_df, members_target, behavior_df, members_list, is_admin=True, kind="behavior")
        with action_tabs[2]:
            render_task_tab(members_df, members_target, education_df, members_list, is_admin=True, kind="education")
        with action_tabs[3]:
            render_prizes_tab(members_df, members_target, prizes_df, members_list)
        with action_tabs[4]:
            render_catalog_manager("chores", chores_df)
        with action_tabs[5]:
            render_catalog_manager("behavior", behavior_df)
        with action_tabs[6]:
            render_catalog_manager("education", education_df)
        with action_tabs[7]:
            render_catalog_manager("prizes", prizes_df)
        with action_tabs[8]:
            render_starter_template_tab(members_df)
        with action_tabs[9]:
            render_history_tab()
    else:
        if st.session_state.active_user not in members_list:
            st.error(f"המשתמש {st.session_state.active_user} לא נמצא בגיליון Members.")
        else:
            action_tabs = st.tabs(["🧹 מטלות", "🌟 התנהגות חיובית", "📚 משימות לימוד"])
            with action_tabs[0]:
                render_task_tab(
                    members_df,
                    members_target,
                    chores_df,
                    [st.session_state.active_user],
                    is_admin=False,
                    kind="chores",
                )
            with action_tabs[1]:
                render_task_tab(
                    members_df,
                    members_target,
                    behavior_df,
                    [st.session_state.active_user],
                    is_admin=False,
                    kind="behavior",
                )
            with action_tabs[2]:
                render_task_tab(
                    members_df,
                    members_target,
                    education_df,
                    [st.session_state.active_user],
                    is_admin=False,
                    kind="education",
                )

if st.session_state.show_add_dialog:
    add_item_dialog(st.session_state.show_add_dialog)

if st.session_state.pending_edit:
    edit_item_dialog(st.session_state.pending_edit)

if st.session_state.pending_delete:
    confirm_delete_dialog(
        st.session_state.pending_delete["kind"],
        st.session_state.pending_delete["row_index"],
        st.session_state.pending_delete["title"],
    )

if st.session_state.pending_child_task:
    confirm_child_task_dialog(
        members_df,
        members_target,
        st.session_state.pending_child_task,
    )

if st.session_state.pending_clear_history:
    confirm_clear_history_dialog()

if st.session_state.success_message:
    success_dialog(st.session_state.success_message)
