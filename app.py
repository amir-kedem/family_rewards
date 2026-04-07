import pandas as pd
import streamlit as st
from gspread.exceptions import APIError, WorksheetNotFound
from streamlit_gsheets import GSheetsConnection
from urllib.parse import urlparse

st.set_page_config(page_title="הבית המשותף שלנו", page_icon="🏠", layout="centered")

SHEET_URL = st.secrets["connections"]["gsheets"]["spreadsheet"]
SERVICE_ACCOUNT_EMAIL = st.secrets["connections"]["gsheets"].get("client_email", "")
ADMIN_PASSWORD = "220911"
ADMIN_LABEL = "הורה"
CHILD_USERS = ["גוני", "נווה"]
DEFAULT_MEMBERS = ["גוני", "נווה", "מורית", "אמיר"]
LOGIN_OPTIONS = [*CHILD_USERS, ADMIN_LABEL]
FAMILY_GOAL = 1000

MEMBERS_WORKSHEET = "Members"
CHORES_WORKSHEET = "Chores"
PRIZES_WORKSHEET = "Prizes"

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

conn = st.connection("gsheets", type=GSheetsConnection)


def init_session_state():
    defaults = {
        "role": None,
        "active_user": None,
        "selected_login": LOGIN_OPTIONS[0],
        "last_action": None,
        "pending_delete": None,
        "show_add_dialog": None,
        "admin_password_input": "",
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
    return catalog


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
        return conn.read(spreadsheet=SHEET_URL, worksheet=worksheet, ttl="0s")
    except APIError as exc:
        raise exc


def write_worksheet(worksheet: str | int, data: pd.DataFrame):
    try:
        conn.update(spreadsheet=SHEET_URL, worksheet=worksheet, data=data)
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
    except Exception:
        pass

    try:
        members = clean_members_df(read_worksheet(0))
        if not members.empty:
            return members, 0
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
    except Exception:
        create_worksheet(worksheet, defaults)
        return clean_catalog_df(defaults, value_column)


def save_catalog(worksheet: str, value_column: str, data: pd.DataFrame):
    cleaned = clean_catalog_df(data, value_column)
    write_worksheet(worksheet, cleaned)


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
        }
    return {
        "worksheet": PRIZES_WORKSHEET,
        "value_column": "Price",
        "value_label": "מחיר",
        "title_label": "שם הפרס",
        "defaults": DEFAULT_PRIZES,
        "dialog_title": "הוספת פרס",
        "empty_message": "אין פרסים זמינים כרגע.",
    }


def reset_login_state():
    st.session_state.role = None
    st.session_state.active_user = None
    st.session_state.admin_password_input = ""
    st.session_state.pending_delete = None
    st.session_state.show_add_dialog = None


def load_starter_template(members_df: pd.DataFrame):
    starter_members = build_members_template(members_df)

    upsert_named_worksheet(MEMBERS_WORKSHEET, starter_members)
    upsert_named_worksheet(CHORES_WORKSHEET, DEFAULT_CHORES)
    upsert_named_worksheet(PRIZES_WORKSHEET, DEFAULT_PRIZES)


def update_member_points(
    members_df: pd.DataFrame,
    members_target: str | int,
    member_name: str,
    delta: int,
    action_label: str,
):
    idx = members_df[members_df["Name"] == member_name].index[0]
    members_df.at[idx, "Points"] += delta
    write_worksheet(members_target, members_df)
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
            members_df.at[idx, "Points"] -= last_points
            write_worksheet(members_target, members_df)
            st.session_state.last_action = None
            st.success("הפעולה בוטלה.")
            st.rerun()


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
        st.rerun()


def render_chores_tab(
    members_df: pd.DataFrame,
    members_target: str | int,
    chores_df: pd.DataFrame,
    member_options: list[str],
    is_admin: bool,
):
    if chores_df.empty:
        st.info("אין מטלות זמינות כרגע. הוסף מטלות במסך הניהול של ההורה.")
        return

    if is_admin:
        selected_user = st.radio("מי ביצע?", member_options, key="task_user", horizontal=True)
    else:
        selected_user = st.session_state.active_user
        st.info(f"הדיווח יירשם עבור {selected_user}")

    task_options = list(chores_df.itertuples(index=False, name=None))
    task = st.selectbox(
        "בחר מטלה",
        task_options,
        key="task_choice",
        format_func=lambda item: f"{item[0]} ({int(item[1])} נק')",
    )

    if st.button("אישור ביצוע מטלה 🧹", key="btn_task"):
        earned = int(task[1])
        update_member_points(members_df, members_target, selected_user, earned, f"ביצוע {task[0]}")
        st.rerun()


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
        st.success("תהנו!")
        st.rerun()


def render_catalog_manager(kind: str, catalog_df: pd.DataFrame):
    config = get_catalog_config(kind)
    st.subheader(f"רשימת {'מטלות' if kind == 'chores' else 'פרסים'}")

    if st.button(f"הוספת {'מטלה' if kind == 'chores' else 'פרס'}", key=f"open_add_{kind}", use_container_width=True):
        st.session_state.show_add_dialog = kind

    if catalog_df.empty:
        st.info(config["empty_message"])
        return

    for row_index, row in catalog_df.reset_index(drop=True).iterrows():
        col_title, col_value, col_delete = st.columns([4, 1, 1])
        with col_title:
            st.write(row["Title"])
        with col_value:
            st.write(f"{int(row[config['value_column']])}")
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
        st.success("תבנית ההתחלה נטענה לגוגל שיטס.")
        st.rerun()


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
        st.success("הפריט נוסף.")
        st.rerun()


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
            st.success("הפריט נמחק.")
            st.rerun()

    with col_cancel:
        if st.button("ביטול", key=f"cancel_delete_{kind}_{row_index}"):
            st.session_state.pending_delete = None
            st.rerun()


init_session_state()

members_df, members_target = get_members_data()
chores_df = get_or_create_catalog(CHORES_WORKSHEET, "Points", DEFAULT_CHORES)
prizes_df = get_or_create_catalog(PRIZES_WORKSHEET, "Price", DEFAULT_PRIZES)
members_list = members_df["Name"].tolist()

st.title("🏠 הבית המשותף שלנו")

total_points = int(members_df["Points"].sum())
col_title, col_val = st.columns([3, 1])
with col_title:
    st.write(f"#### 🎯 יעד משפחתי: {total_points} / {FAMILY_GOAL}")
with col_val:
    if st.button("🔄 רענן נתונים"):
        st.rerun()

st.progress(min(total_points / FAMILY_GOAL, 1.0))
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

    if is_admin:
        render_undo(members_df, members_target)
        action_tabs = st.tabs(
            [
                "⚡ התגברות על כעס",
                "🧹 מטלה / למידה",
                "🎁 מימוש פרס",
                "🛠️ ניהול מטלות",
                "🛍️ ניהול פרסים",
                "📥 תבנית התחלתית",
            ]
        )
        with action_tabs[0]:
            render_anger_tab(members_df, members_target, members_list, is_admin=True)
        with action_tabs[1]:
            render_chores_tab(members_df, members_target, chores_df, members_list, is_admin=True)
        with action_tabs[2]:
            render_prizes_tab(members_df, members_target, prizes_df, members_list)
        with action_tabs[3]:
            render_catalog_manager("chores", chores_df)
        with action_tabs[4]:
            render_catalog_manager("prizes", prizes_df)
        with action_tabs[5]:
            render_starter_template_tab(members_df)
    else:
        if st.session_state.active_user not in members_list:
            st.error(f"המשתמש {st.session_state.active_user} לא נמצא בגיליון Members.")
        else:
            action_tabs = st.tabs(["⚡ התגברות על כעס", "🧹 מטלה / למידה"])
            with action_tabs[0]:
                render_anger_tab(members_df, members_target, [st.session_state.active_user], is_admin=False)
            with action_tabs[1]:
                render_chores_tab(
                    members_df,
                    members_target,
                    chores_df,
                    [st.session_state.active_user],
                    is_admin=False,
                )

if st.session_state.show_add_dialog:
    add_item_dialog(st.session_state.show_add_dialog)

if st.session_state.pending_delete:
    confirm_delete_dialog(
        st.session_state.pending_delete["kind"],
        st.session_state.pending_delete["row_index"],
        st.session_state.pending_delete["title"],
    )
