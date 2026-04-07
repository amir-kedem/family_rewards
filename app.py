import streamlit as st
import pandas as pd
from streamlit_gsheets import GSheetsConnection

# --- הגדרות דף ---
st.set_page_config(page_title="הבית המשותף שלנו", page_icon="🏠", layout="centered")

# משיכת הקישור מה-Secrets
SHEET_URL = st.secrets["connections"]["gsheets"]["spreadsheet"]
ADMIN_PASSWORD = "1234"
FAMILY_GOAL = 1000

# --- אתחול Session State ---
if 'authenticated' not in st.session_state:
    st.session_state.authenticated = False
if 'last_action' not in st.session_state:
    st.session_state.last_action = None

# --- חיבור לנתונים ---
conn = st.connection("gsheets", type=GSheetsConnection)

def get_data():
    df = conn.read(spreadsheet=SHEET_URL, ttl="0s").dropna(subset=['Name'])
    # המרה למספרים שלמים וניקוי נתונים
    df['Points'] = pd.to_numeric(df['Points'], errors='coerce').fillna(0).astype(int)
    return df

df = get_data()

def style_points(val):
    try:
        # כל ניקוד יוצג בירוק כהה ובכתב מודגש (Bold)
        return 'color: #28a745; font-weight: 900; font-size: 20px;'
    except:
        return 'font-weight: bold;'

# --- ממשק ראשי ---
st.title("🏠 הבית המשותף שלנו")

# מד התקדמות משפחתי
total_points = int(df['Points'].sum())
col_title, col_val = st.columns([3, 1])
with col_title:
    st.write(f"#### 🎯 יעד משפחתי: {total_points} / {FAMILY_GOAL}")
with col_val:
    if st.button("🔄 רענן נתונים"):
        st.rerun()

st.progress(min(total_points / FAMILY_GOAL, 1.0))

# --- 1. כותרת ממורכזת ---
st.markdown("<h3 style='text-align: center;'>מצב הנקודות הנוכחי</h3>", unsafe_allow_html=True)

# --- 2. הזרקת CSS פשוט ומדויק (ללא הסתרת עמודות ב-CSS) ---
st.markdown(
    """
    <style>
    /* עיצוב כללי לכותרות */
    th {
        text-align: center !important;
        background-color: rgba(128, 128, 128, 0.1) !important;
        color: inherit !important;
        padding: 10px !important;
    }
    
    /* עמודה 1 (שם) - יישור לימין */
    td:nth-child(1) {
        text-align: center !important;
        width: 60%;
    }
    
    /* עמודה 2 (נקודות) - יישור למרכז */
    td:nth-child(2) {
        text-align: right !important;
        padding-right: 20px
        width: 40%;
    }

    table {
        width: 100% !important;
        font-size: 18px;
        border-collapse: collapse;
    }
    </style>
    """,
    unsafe_allow_html=True
)

# --- 3. הכנת הנתונים (שם ואז נקודות) ---
# אנחנו מוודאים שהסדר הוא בדיוק זה: עמודה ראשונה שם, שנייה נקודות
df_display = df[['Points', 'Name']].copy()
df_display.columns = ["נקודות", "שם"]

# --- 4. הצגת הטבלה עם העלמת אינדקס מובנית ---
# ה-hide(axis='index') דואג שהמספרים (0,1,2,3) לא ייווצרו בכלל
st.table(
    df_display.style
    .map(style_points, subset=['נקודות'])
    .hide(axis='index')
)

st.divider()

# --- אזור ניהול ועדכון (במסך הראשי) ---
if not st.session_state.authenticated:
    st.subheader("🔐 כניסת הורים לעדכון")
    col1, col2 = st.columns([2, 1])
    with col1:
        pw_input = st.text_input("סיסמה", type="password", label_visibility="collapsed", placeholder="הכנס סיסמה...")
    with col2:
        # תמיכה גם בכפתור וגם ב-Enter
        if st.button("כניסה למערכת", use_container_width=True) or (pw_input == ADMIN_PASSWORD and pw_input != ""):
            if pw_input == ADMIN_PASSWORD:
                st.session_state.authenticated = True
                st.rerun()
            elif pw_input != "":
                st.error("סיסמה שגויה")
else:
    # מצב אדמין פעיל
    col_header, col_logout = st.columns([4, 1])
    with col_header:
        st.subheader("⚙️ לוח בקרה להורים")
    with col_logout:
        if st.button("יציאה", help="ניתוק מצב עריכה"):
            st.session_state.authenticated = False
            st.rerun()

    # מנגנון Undo
    if st.session_state.last_action:
        last_user, last_points, last_type = st.session_state.last_action
        with st.warning(f"פעולה אחרונה: {last_type} ל-{last_user} ({last_points} נק')"):
            if st.button("⏮️ בטל פעולה אחרונה (Undo)"):
                idx = df[df['Name'] == last_user].index[0]
                df.at[idx, 'Points'] -= last_points
                conn.update(spreadsheet=SHEET_URL, data=df)
                st.session_state.last_action = None
                st.success("הפעולה בוטלה!")
                st.rerun()

    # בחירת פעולה בטאבים
    tab1, tab2, tab3 = st.tabs(["⚡ התגברות על כעס", "🧹 מטלה / למידה", "🎁 מימוש פרס"])
    members_list = df['Name'].tolist()

    # --- טאב 1: כעס ---
    with tab1:
        user = st.radio("מי הגיבור?", members_list, key="anger_user", horizontal=True)
        level = st.select_slider("עוצמת ההתקף שהיה", options=["קטן", "בינוני", "גדול"], key="anger_level")
        bonus = st.checkbox("שימוש בשיטת פריקה (אסלה/כרית/פוף) +10 בונוס")
        
        if st.button("אישור וקבלת נקודות ✅", key="btn_anger"):
            points_map = {"קטן": 10, "בינוני": 20, "גדול": 40}
            earned = points_map[level] + (10 if bonus else 0)
            idx = df[df['Name'] == user].index[0]
            df.at[idx, 'Points'] += earned
            conn.update(spreadsheet=SHEET_URL, data=df)
            st.session_state.last_action = (user, earned, "הוספת נקודות (כעס)")
            st.balloons()
            st.rerun()

    # --- טאב 2: מטלות ---
    with tab2:
        user_t = st.radio("מי ביצע?", members_list, key="task_user", horizontal=True)
        task = st.selectbox("בחר מטלה", [
            ("טיול ארוך לכלב", 25), ("טיול קצר לכלב", 10), ("החלפת מצעים", 10),
            ("שאיבת רצפה", 30), ("משימה לימודית יומית", 20),
            ("משימה לימודית מורחבת", 40), ("קריאת ספר (30 דק')", 15)
        ], format_func=lambda x: f"{x[0]} ({int(x[1])} נק')")
        
        if st.button("אישור ביצוע מטלה 🧹", key="btn_task"):
            earned = int(task[1])
            idx = df[df['Name'] == user_t].index[0]
            df.at[idx, 'Points'] += earned
            conn.update(spreadsheet=SHEET_URL, data=df)
            st.session_state.last_action = (user_t, earned, f"ביצוע {task[0]}")
            st.rerun()

    # --- טאב 3: פרסים ---
    with tab3:
        user_r = st.radio("מי מממש?", members_list, key="reward_user", horizontal=True)
        reward = st.selectbox("בחר פרס", [
            ("גלידה בכלבו", 50), ("תוספת זמן מסך (30 דק')", 40),
            ("תוספת זמן מסך (שעה)", 80), ("מנוחה בבית במקום צהרון", 150)
        ], format_func=lambda x: f"{x[0]} ({int(x[1])} נק')")
        
        current_points = int(df.loc[df['Name'] == user_r, 'Points'].values[0])
        can_afford = current_points >= reward[1]
        
        if not can_afford:
            st.error(f"חסרות ל-{user_r} עוד {int(reward[1] - current_points)} נקודות לפרס זה.")
        
        if st.button(f"אשר מימוש: {reward[0]}", disabled=not can_afford, type="primary"):
            cost = int(reward[1])
            idx = df[df['Name'] == user_r].index[0]
            df.at[idx, 'Points'] -= cost
            conn.update(spreadsheet=SHEET_URL, data=df)
            st.session_state.last_action = (user_r, -cost, f"מימוש {reward[0]}")
            st.success("תהנו!")
            st.rerun()