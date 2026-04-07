import streamlit as st
import pandas as pd
from streamlit_gsheets import GSheetsConnection

# --- הגדרות דף ---
st.set_page_config(page_title="הבית המשותף שלנו", page_icon="🏠", layout="centered")

# --- הגדרות קבועות (ניתן לערוך בקלות) ---
ADMIN_PASSWORD = "1234"
FAMILY_GOAL = 1000

TASKS = [
    ("טיול ארוך לכלב", 25),
    ("טיול קצר לכלב", 10),
    ("החלפת מצעים", 10),
    ("שאיבת רצפה", 30),
    ("שאיבת שטיח", 15),
    ("משימה לימודית יומית (שיעורים/תרגול)", 20),
    ("משימה לימודית מורחבת (מבחן/עבודה)", 40),
    ("קריאת ספר (30 דקות)", 15)
]

REWARDS = [
    ("גלידה בכלבו", 50),
    ("תוספת זמן מסך (30 דק')", 40),
    ("תוספת זמן מסך (שעה)", 80),
    ("מנוחה בבית בזמן צהרון", 150)
]

# --- חיבור לנתונים ---
conn = st.connection("gsheets", type=GSheetsConnection)

def get_data():
    # קריאת הנתונים וניקוי שורות ריקות אם יש
    data = conn.read(ttl="0s")
    return data.dropna(subset=['Name'])

df = get_data()

# --- פונקציות עיצוב (Pandas Styling) ---
def style_points(val):
    """צובע ניקוד נמוך מאוד באדום"""
    color = 'red' if val < 20 else 'black'
    return f'color: {color}; font-weight: bold'

# --- ממשק משתמש ראשי ---
st.title("🏠 הבית המשותף שלנו")
st.markdown("### מערכת לחיזוק חיובי וערבות הדדית")

# הצגת מד התקדמות משפחתי
total_points = df['Points'].sum()
progress = min(total_points / FAMILY_GOAL, 1.0)
st.write(f"#### 🎯 יעד משפחתי: {total_points} / {FAMILY_GOAL}")
st.progress(progress)
if progress >= 1.0:
    st.success("🎉 הגענו ליעד המשפחתי! זמן להחליט על הפרס המשותף!")

st.divider()

# הצגת טבלת הניקוד המעוצבת
st.write("### מצב הנקודות הנוכחי")
styled_df = df.style.map(style_points, subset=['Points'])
st.dataframe(styled_df, use_container_width=True)

st.divider()

# --- אזור ניהול (Sidebar) ---
st.sidebar.title("🔐 אזור הורים")
password = st.sidebar.text_input("הכנס סיסמה לעדכון", type="password")

if password == ADMIN_PASSWORD:
    st.sidebar.success("מצב עריכה פעיל")
    
    action_type = st.radio("מה ברצונך לעשות?", ["דיווח על אירוע/מטלה", "מימוש פרס"])

    if action_type == "דיווח על אירוע/מטלה":
        with st.form("action_form"):
            user = st.selectbox("מי הילד?", df['Name'].tolist())
            category = st.selectbox("קטגוריה", ["ניהול כעס", "ביצוע מטלה / למידה"])
            
            earned_points = 0
            details = ""

            if category == "ניהול כעס":
                level = st.select_slider("עוצמת ההתקף שהיה", options=["קטן", "בינוני", "גדול"])
                bonus = st.checkbox("שימוש בשיטת פריקה חיובית (בונוס +10)")
                points_map = {"קטן": 10, "בינוני": 20, "גדול": 40}
                earned_points = points_map[level] + (10 if bonus else 0)
                details = f"התגברות על כעס {level}"

            else: # מטלה או למידה
                task_choice = st.selectbox("בחר משימה", TASKS, format_func=lambda x: f"{x[0]} ({x[1]} נק')")
                earned_points = task_choice[1]
                details = task_choice[0]

            if st.form_submit_button("אישור ועדכון נקודות"):
                idx = df[df['Name'] == user].index[0]
                df.at[idx, 'Points'] += earned_points
                conn.update(data=df)
                st.balloons()
                st.success(f"כל הכבוד {user}! נוספו {earned_points} נקודות.")
                st.rerun()

    elif action_type == "מימוש פרס":
        with st.form("reward_form"):
            user = st.selectbox("מי המממש?", df['Name'].tolist())
            current_p = df.loc[df['Name'] == user, 'Points'].values[0]
            
            # יצירת רשימת פרסים חכמה עם אינדיקציה ויזואלית
            reward_labels = []
            for name, cost in REWARDS:
                if current_p >= cost:
                    reward_labels.append(f"✅ {name} ({cost} נק')")
                else:
                    reward_labels.append(f"❌ {name} ({cost} נק') - חסר {cost - current_p}")
            
            selected_label = st.selectbox("בחר פרס", reward_labels)
            
            if st.form_submit_button("אשר מימוש פרס"):
                # חילוץ העלות מהטקסט הנבחר
                selected_name = selected_label.split(" (")[0].replace("✅ ", "").replace("❌ ", "")
                cost = next(c for n, c in REWARDS if n == selected_name)
                
                if current_p >= cost:
                    idx = df[df['Name'] == user].index[0]
                    df.at[idx, 'Points'] -= cost
                    conn.update(data=df)
                    st.success(f"תהנה! {selected_name} מומש. ירדו {cost} נקודות.")
                    st.rerun()
                else:
                    st.error("אין מספיק נקודות לפעולה זו!")
else:
    st.sidebar.info("הכנס סיסמה כדי לעדכן נקודות או לממש פרסים.")
    st.warning("מצב צפייה בלבד: לא ניתן לבצע שינויים.")