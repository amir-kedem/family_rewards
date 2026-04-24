from __future__ import annotations

import sys
import os
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

import flet as ft

from point_system.config import ConfigError, load_config
from point_system.constants import (
    ADMIN_LABEL,
    BEHAVIOR_WORKSHEET,
    CHILD_USERS,
    CHORES_WORKSHEET,
    DEFAULT_CHORES,
    DEFAULT_PRIZES,
    EDUCATION_WORKSHEET,
    EMPTY_TASKS,
    FAMILY_GOAL,
    PRIZES_WORKSHEET,
    get_catalog_config,
)
from point_system.service import ActionValidationError, create_service
from point_system.sheets import SheetAccessError

if os.getenv("PORT"):
    os.environ["FLET_SERVER_PORT"] = os.environ["PORT"]
os.environ.setdefault("FLET_FORCE_WEB_SERVER", "true")

DATA_CACHE_TTL_SECONDS = 20
APP_BUILD = "family-rewards-flet-ux-history-2026-04-21"
FAILED_ACTION_MESSAGE = "\u05e4\u05e2\u05d5\u05dc\u05d4 \u05e0\u05db\u05e9\u05dc\u05d4"

print(f"Starting {APP_BUILD}")


def money_or_points(value: int, suffix: str = "נק'") -> str:
    return f"{int(value)} {suffix}"


def main(page: ft.Page):
    page.title = "הבית המשותף שלנו"
    page.scroll = ft.ScrollMode.AUTO
    page.theme_mode = ft.ThemeMode.LIGHT
    page.padding = 18
    page.rtl = True

    state = {
        "role": None,
        "active_user": None,
        "last_action": None,
        "selected_users": {},
        "selected_tasks": {},
        "selected_tabs": {},
        "message": None,
        "busy": False,
        "success_dialog": None,
        "catalog_forms": {},
        "catalog_form_values": {},
        "pending_catalog_delete": {},
    }
    data: dict[str, object] = {}
    data_cache: dict[str, object] = {"loaded_at": None}

    try:
        config = load_config(ROOT)
        service = create_service(ROOT)
    except (ConfigError, SheetAccessError) as exc:
        render_startup_error(page, exc)
        return

    def show_message(message: str) -> None:
        state["message"] = message
        snack_bar = ft.SnackBar(ft.Text(message), open=True)
        page.overlay.append(snack_bar)
        page.update()

    def show_success_dialog(message: str = "פעולה בוצעה") -> None:
        state["success_dialog"] = message
        rerender()

    def close_success_dialog(_: ft.ControlEvent | None = None) -> None:
        state["success_dialog"] = None
        rerender()

    def refresh_data(force: bool = False) -> bool:
        loaded_at = data_cache.get("loaded_at")
        if not force and isinstance(loaded_at, datetime):
            if datetime.now() - loaded_at < timedelta(seconds=DATA_CACHE_TTL_SECONDS):
                return True

        try:
            members_df, members_target = service.get_members_data()
            data["members_df"] = members_df
            data["members_target"] = members_target
            data["chores_df"] = service.get_or_create_catalog(CHORES_WORKSHEET, "Points", DEFAULT_CHORES)
            data["behavior_df"] = service.get_or_create_catalog(BEHAVIOR_WORKSHEET, "Points", EMPTY_TASKS)
            data["education_df"] = service.get_or_create_catalog(EDUCATION_WORKSHEET, "Points", EMPTY_TASKS)
            data["prizes_df"] = service.get_or_create_catalog(PRIZES_WORKSHEET, "Price", DEFAULT_PRIZES)
            data["monthly_points"] = service.get_monthly_points_total()
            data_cache["loaded_at"] = datetime.now()
            return True
        except SheetAccessError as exc:
            render_sheet_error(page, exc, config.service_account_email, config.spreadsheet)
            return False

    def rerender(force_refresh: bool = False) -> None:
        if not refresh_data(force=force_refresh):
            return

        page.controls.clear()
        page.add(
            ft.Column(
                controls=[
                    render_top_bar(),
                    render_success_notice(),
                    render_goal(),
                    render_members_table(data["members_df"]),
                    ft.Divider(),
                    render_body(),
                ],
                spacing=18,
                expand=True,
            )
        )
        page.update()

    page.on_resize = lambda _: rerender()

    def set_selected_user(kind: str, user_name: str) -> None:
        state["selected_users"][kind] = user_name
        rerender()

    def selected_user(kind: str) -> str:
        members = data["members_df"]["Name"].tolist()
        stored = state["selected_users"].get(kind)
        if stored in members:
            return stored
        fallback = state["active_user"] if state["active_user"] in members else members[0]
        state["selected_users"][kind] = fallback
        return fallback

    def set_selected_task(kind: str, task_title: str) -> None:
        state["selected_tasks"][kind] = task_title
        rerender()

    def selected_task(kind: str, tasks_df: pd.DataFrame) -> str:
        task_titles = tasks_df["Title"].astype(str).tolist()
        stored = state["selected_tasks"].get(kind)
        if stored in task_titles:
            return stored
        fallback = task_titles[0]
        state["selected_tasks"][kind] = fallback
        return fallback

    def is_narrow_layout() -> bool:
        page_width = page.width or 960
        return page_width < 760

    def render_tab_switcher(tab_key: str, tabs: list[tuple[str, callable]]) -> ft.Control:
        selected = int(state["selected_tabs"].get(tab_key, 0))
        selected = min(max(selected, 0), len(tabs) - 1)
        state["selected_tabs"][tab_key] = selected

        def set_tab(index: int) -> None:
            state["selected_tabs"][tab_key] = index
            rerender()

        if is_narrow_layout():
            tab_selector = ft.Dropdown(
                label="בחירת מסך",
                value=str(selected),
                options=[
                    ft.DropdownOption(key=str(index), text=label)
                    for index, (label, _) in enumerate(tabs)
                ],
                dense=True,
                filled=True,
                expand=True,
                on_select=lambda event: set_tab(int(event.control.value or 0)),
            )
            tabs_control: ft.Control = tab_selector
        else:
            buttons: list[ft.Control] = []
            for index, (label, _) in enumerate(tabs):
                button_cls = ft.ElevatedButton if index == selected else ft.OutlinedButton
                buttons.append(button_cls(label, on_click=lambda _, idx=index: set_tab(idx)))
            tabs_control = ft.Row(buttons, wrap=True, spacing=8, run_spacing=8)

        selected_content = tabs[selected][1]()
        return ft.Column(
            [
                tabs_control,
                ft.Container(content=selected_content, padding=ft.padding.only(top=12)),
            ],
            spacing=8,
        )

    def login_child(user_name: str) -> None:
        if user_name not in data["members_df"]["Name"].tolist():
            show_message(f"המשתמש {user_name} לא נמצא בגיליון Members.")
            return
        state["role"] = "child"
        state["active_user"] = user_name
        rerender()

    def login_admin(password_field: ft.TextField) -> None:
        if password_field.value == config.admin_password:
            state["role"] = "admin"
            state["active_user"] = None
            rerender()
            return
        show_message("סיסמה שגויה")

    def logout(_: ft.ControlEvent | None = None) -> None:
        state["role"] = None
        state["active_user"] = None
        state["last_action"] = None
        state["selected_users"] = {}
        state["selected_tasks"] = {}
        rerender()

    def update_points(user_name: str, points: int, action_label: str, remember: bool = True) -> None:
        if state["busy"]:
            return

        members_snapshot = data["members_df"].copy()
        members_target = data["members_target"]
        state["busy"] = True
        state["message"] = "מעדכן נתונים..."
        rerender()

        def worker() -> None:
            try:
                last_action = service.update_member_points(
                    members_snapshot,
                    members_target,
                    user_name,
                    points,
                    action_label,
                )
                state["last_action"] = last_action if remember else None
                state["message"] = "פעולה עודכנה"
                state["busy"] = False
                rerender(force_refresh=True)
                show_success_dialog("פעולה בוצעה")
            except ActionValidationError:
                state["last_action"] = None
                state["message"] = FAILED_ACTION_MESSAGE
                state["busy"] = False
                rerender(force_refresh=True)
                show_success_dialog(FAILED_ACTION_MESSAGE)
            except SheetAccessError as exc:
                state["busy"] = False
                render_sheet_error(page, exc, config.service_account_email, config.spreadsheet)
            except Exception as exc:
                state["busy"] = False
                state["message"] = f"שגיאה בעדכון: {exc}"
                rerender()

        page.run_thread(worker)

    def undo_last(_: ft.ControlEvent | None = None) -> None:
        if not state["last_action"]:
            return
        last_user, last_points, last_action = state["last_action"]
        update_points(last_user, -last_points, f"ביטול: {last_action}", remember=False)

    def save_catalog(kind: str, catalog_df: pd.DataFrame, title: str, value: str, row_index: int | None = None) -> None:
        config_for_kind = get_catalog_config(kind)
        clean_title = title.strip()
        try:
            clean_value = int(value)
        except ValueError:
            show_message("יש להזין מספר תקין.")
            return
        if not clean_title:
            show_message("יש למלא שם.")
            return
        if clean_value <= 0:
            show_message("הערך חייב להיות גדול מאפס.")
            return

        duplicate_df = catalog_df.drop(index=row_index, errors="ignore") if row_index is not None else catalog_df
        if clean_title in duplicate_df["Title"].tolist():
            show_message("כבר קיים פריט בשם הזה.")
            return

        if row_index is None:
            updated = pd.concat(
                [
                    catalog_df,
                    pd.DataFrame([{"Title": clean_title, config_for_kind["value_column"]: clean_value}]),
                ],
                ignore_index=True,
            )
        else:
            updated = catalog_df.copy()
            if 0 <= row_index < len(updated):
                updated.at[row_index, "Title"] = clean_title
                updated.at[row_index, config_for_kind["value_column"]] = clean_value

        try:
            state["busy"] = True
            state["message"] = "שומר נתונים..."
            state["catalog_forms"].pop(kind, None)
            rerender()

            def worker() -> None:
                try:
                    service.save_catalog(config_for_kind["worksheet"], config_for_kind["value_column"], updated)
                    state["message"] = "פעולה עודכנה"
                    state["busy"] = False
                    rerender(force_refresh=True)
                    show_success_dialog("פעולה בוצעה")
                except SheetAccessError as exc:
                    state["busy"] = False
                    render_sheet_error(page, exc, config.service_account_email, config.spreadsheet)
                except Exception as exc:
                    state["busy"] = False
                    state["message"] = f"שגיאה בשמירה: {exc}"
                    rerender()

            page.run_thread(worker)
        except Exception as exc:
            state["busy"] = False
            state["message"] = f"שגיאה בשמירה: {exc}"
            rerender()

    def open_catalog_form(kind: str, row_index: int | None = None) -> None:
        state["catalog_forms"][kind] = {"row_index": row_index}
        catalog_df = {
            "chores": data.get("chores_df"),
            "behavior": data.get("behavior_df"),
            "education": data.get("education_df"),
            "prizes": data.get("prizes_df"),
        }.get(kind)
        config_for_kind = get_catalog_config(kind)
        if row_index is not None and catalog_df is not None and 0 <= row_index < len(catalog_df):
            existing = catalog_df.iloc[row_index]
            state["catalog_form_values"][kind] = {
                "title": str(existing["Title"]),
                "value": str(int(existing[config_for_kind["value_column"]])),
            }
        else:
            state["catalog_form_values"][kind] = {"title": "", "value": ""}
        rerender()

    def close_catalog_form(kind: str) -> None:
        state["catalog_forms"].pop(kind, None)
        state["catalog_form_values"].pop(kind, None)
        rerender()

    def render_catalog_form(kind: str, catalog_df: pd.DataFrame) -> ft.Control:
        config_for_kind = get_catalog_config(kind)
        form_state = state["catalog_forms"].get(kind, {})
        row_index = form_state.get("row_index")
        existing = catalog_df.iloc[row_index] if row_index is not None and 0 <= row_index < len(catalog_df) else None
        form_values = state["catalog_form_values"].setdefault(
            kind,
            {
                "title": "" if existing is None else str(existing["Title"]),
                "value": "" if existing is None else str(int(existing[config_for_kind["value_column"]])),
            },
        )

        def update_title(event: ft.ControlEvent) -> None:
            form_values["title"] = event.control.value or ""

        def update_value(event: ft.ControlEvent) -> None:
            form_values["value"] = event.control.value or ""

        title_field = ft.TextField(
            label=config_for_kind["title_label"],
            value=form_values.get("title", ""),
            on_change=update_title,
            width=320,
        )
        value_field = ft.TextField(
            label=config_for_kind["value_label"],
            keyboard_type=ft.KeyboardType.NUMBER,
            value=form_values.get("value", ""),
            on_change=update_value,
            width=130,
        )

        def submit(_: ft.ControlEvent | None = None) -> None:
            state["catalog_forms"].pop(kind, None)
            state["catalog_form_values"].pop(kind, None)
            save_catalog(
                kind,
                catalog_df,
                form_values.get("title", ""),
                form_values.get("value", ""),
                row_index,
            )

        return ft.Container(
            content=ft.Column(
                [
                    ft.Text(config_for_kind["dialog_title"] if row_index is None else "עדכון פריט", weight=ft.FontWeight.BOLD),
                    ft.Row([title_field, value_field], wrap=True, spacing=10),
                    ft.Row(
                        [
                            ft.OutlinedButton("ביטול", on_click=lambda _: close_catalog_form(kind)),
                            ft.ElevatedButton("שמירה", disabled=bool(state["busy"]), on_click=submit),
                        ],
                        spacing=8,
                    ),
                ],
                spacing=10,
            ),
            padding=12,
            bgcolor=ft.Colors.GREY_100,
            border_radius=8,
        )

    def delete_catalog_item(kind: str, catalog_df: pd.DataFrame, row_index: int) -> None:
        config_for_kind = get_catalog_config(kind)
        updated = catalog_df.drop(index=row_index).reset_index(drop=True)
        state["pending_catalog_delete"].pop(kind, None)
        state["busy"] = True
        state["message"] = "מוחק נתונים..."
        rerender()

        def worker() -> None:
            try:
                service.save_catalog(config_for_kind["worksheet"], config_for_kind["value_column"], updated)
                state["message"] = "פעולה עודכנה"
                state["busy"] = False
                rerender(force_refresh=True)
                show_success_dialog("פעולה בוצעה")
            except SheetAccessError as exc:
                state["busy"] = False
                render_sheet_error(page, exc, config.service_account_email, config.spreadsheet)
            except Exception as exc:
                state["busy"] = False
                state["message"] = f"שגיאה במחיקה: {exc}"
                rerender()

        page.run_thread(worker)

    def request_delete_catalog_item(kind: str, row_index: int) -> None:
        state["pending_catalog_delete"][kind] = row_index
        rerender()

    def cancel_delete_catalog_item(kind: str) -> None:
        state["pending_catalog_delete"].pop(kind, None)
        rerender()

    def clear_history(_: ft.ControlEvent | None = None) -> None:
        if state["busy"]:
            return
        state["busy"] = True
        state["message"] = "מנקה היסטוריה..."
        rerender()

        def worker() -> None:
            try:
                service.clear_history()
                state["message"] = "ההיסטוריה נמחקה"
                state["busy"] = False
                rerender(force_refresh=True)
                show_success_dialog("ההיסטוריה נמחקה")
            except SheetAccessError as exc:
                state["busy"] = False
                render_sheet_error(page, exc, config.service_account_email, config.spreadsheet)
            except Exception as exc:
                state["busy"] = False
                state["message"] = f"שגיאה בניקוי היסטוריה: {exc}"
                rerender()

        page.run_thread(worker)

    def load_starter_template(_: ft.ControlEvent | None = None) -> None:
        if state["busy"]:
            return
        members_snapshot = data["members_df"].copy()
        state["busy"] = True
        state["message"] = "טוען תבנית התחלה..."
        rerender()

        def worker() -> None:
            try:
                service.load_starter_template(members_snapshot)
                state["message"] = "תבנית ההתחלה נטענה"
                state["busy"] = False
                rerender(force_refresh=True)
                show_success_dialog("תבנית ההתחלה נטענה")
            except SheetAccessError as exc:
                state["busy"] = False
                render_sheet_error(page, exc, config.service_account_email, config.spreadsheet)
            except Exception as exc:
                state["busy"] = False
                state["message"] = f"שגיאה בטעינת תבנית: {exc}"
                rerender()

        page.run_thread(worker)

    def render_top_bar() -> ft.Control:
        controls: list[ft.Control] = [
            ft.Text("🏠 הבית המשותף שלנו", size=26, weight=ft.FontWeight.BOLD),
        ]
        if state["role"]:
            subtitle = "לוח בקרה להורה" if state["role"] == "admin" else f"שלום {state['active_user']}"
            controls.append(ft.Text(subtitle, size=16, color=ft.Colors.GREY_700))
        if state["message"]:
            controls.append(ft.Text(str(state["message"]), size=14, color=ft.Colors.BLUE_700))
        if state["busy"]:
            controls.append(ft.ProgressBar(width=260))
        actions: list[ft.Control] = [
            ft.IconButton(ft.Icons.REFRESH, tooltip="רענן נתונים", on_click=lambda _: rerender(force_refresh=True)),
            ft.OutlinedButton("יציאה", visible=bool(state["role"]), on_click=logout),
        ]
        return ft.Column(
            controls=[
                ft.Column(controls, spacing=2),
                ft.Row(actions, wrap=True, spacing=8, run_spacing=8),
            ],
            spacing=10,
        )

    def render_goal() -> ft.Control:
        monthly_points = int(data["monthly_points"])
        progress = min(monthly_points / FAMILY_GOAL, 1.0)
        return ft.Column(
            [
                ft.Row(
                    [
                        ft.Text("יעד חודשי", size=18, weight=ft.FontWeight.BOLD),
                        ft.Text(f"{monthly_points} / {FAMILY_GOAL}", size=18),
                    ],
                    alignment=ft.MainAxisAlignment.SPACE_BETWEEN,
                ),
                ft.ProgressBar(value=progress, height=10),
            ],
            spacing=8,
        )

    def render_members_table(members_df: pd.DataFrame) -> ft.Control:
        rows = [
            ft.DataRow(
                cells=[
                    ft.DataCell(ft.Text(str(row["Name"]), weight=ft.FontWeight.BOLD)),
                    ft.DataCell(ft.Text(str(int(row["Points"])), size=18)),
                ]
            )
            for _, row in members_df.iterrows()
        ]
        return ft.DataTable(
            columns=[ft.DataColumn(ft.Text("שם")), ft.DataColumn(ft.Text("נקודות"))],
            rows=rows,
            heading_row_color=ft.Colors.with_opacity(0.08, ft.Colors.GREY),
        )

    def render_body() -> ft.Control:
        if state["role"] is None:
            return render_login()
        if state["role"] == "admin":
            return render_admin_tabs()
        return render_child_tabs()

    def render_success_notice() -> ft.Control:
        if not state["success_dialog"]:
            return ft.Container()
        is_failure = state["success_dialog"] == FAILED_ACTION_MESSAGE
        return ft.Container(
            content=ft.Row(
                [
                    ft.Text(
                        str(state["success_dialog"]),
                        size=18,
                        weight=ft.FontWeight.BOLD,
                        color=ft.Colors.RED_900 if is_failure else None,
                        expand=True,
                    ),
                    ft.ElevatedButton("OK", on_click=close_success_dialog),
                ],
                spacing=10,
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
            ),
            padding=14,
            bgcolor=ft.Colors.RED_100 if is_failure else ft.Colors.GREEN_100,
            border_radius=8,
        )

    def render_login() -> ft.Control:
        password = ft.TextField(label="סיסמה", password=True, can_reveal_password=True, width=220)
        child_buttons = [
            ft.ElevatedButton(user, on_click=lambda _, child=user: login_child(child))
            for user in CHILD_USERS
        ]
        return ft.Column(
            [
                ft.Text("כניסה למערכת", size=20, weight=ft.FontWeight.BOLD),
                ft.Row(child_buttons, wrap=True),
                ft.Row(
                    [
                        password,
                        ft.ElevatedButton(ADMIN_LABEL, on_click=lambda _: login_admin(password)),
                    ],
                    wrap=True,
                    vertical_alignment=ft.CrossAxisAlignment.END,
                ),
            ],
            spacing=14,
        )

    def render_user_picker(kind: str) -> ft.Control:
        members = data["members_df"]["Name"].tolist()
        current = selected_user(kind)
        if is_narrow_layout():
            return ft.Dropdown(
                label="בחר משתמש",
                value=current,
                options=[ft.DropdownOption(key=user, text=user) for user in members],
                dense=True,
                filled=True,
                expand=True,
                on_select=lambda event: set_selected_user(kind, event.control.value or current),
            )
        return ft.Row(
            [
                ft.OutlinedButton(
                    user,
                    on_click=lambda _, selected=user: set_selected_user(kind, selected),
                    style=ft.ButtonStyle(
                        bgcolor=ft.Colors.BLUE_50 if user == current else None,
                    ),
                )
                for user in members
            ],
            wrap=True,
            spacing=8,
            run_spacing=8,
        )

    def render_task_panel(kind: str, tasks_df: pd.DataFrame, is_admin: bool) -> ft.Control:
        config_for_kind = get_catalog_config(kind)
        if tasks_df.empty:
            return ft.Text(config_for_kind["empty_message"], color=ft.Colors.GREY_700)

        if is_admin:
            user_name = selected_user(kind)
            picker = render_user_picker(kind)
            current_task = selected_task(kind, tasks_df)
            selected_rows = tasks_df[tasks_df["Title"].astype(str) == current_task]
            if selected_rows.empty:
                selected_rows = tasks_df.head(1)
            selected_row = selected_rows.iloc[0]
            selected_points = int(selected_row[config_for_kind["value_column"]])
            action_label = f"{config_for_kind['action_prefix']} {selected_row['Title']}"
            task_selector = ft.Dropdown(
                label=config_for_kind["tab_label"],
                value=current_task,
                options=[
                    ft.DropdownOption(
                        key=str(row["Title"]),
                        text=f"{row['Title']} ({money_or_points(int(row[config_for_kind['value_column']]))})",
                    )
                    for _, row in tasks_df.iterrows()
                ],
                dense=True,
                filled=True,
                expand=True,
                on_select=lambda event: set_selected_task(kind, event.control.value or current_task),
            )
            submit_button = ft.ElevatedButton(
                "אישור דיווח",
                disabled=bool(state["busy"]),
                on_click=lambda _, user=user_name, pts=selected_points, action=action_label: update_points(user, pts, action),
            )
            return ft.Column([picker, task_selector, submit_button], spacing=14)
        else:
            user_name = state["active_user"]
            picker = ft.Text(f"הדיווח יירשם עבור {user_name}", color=ft.Colors.GREY_700)

        buttons = []
        for _, row in tasks_df.iterrows():
            title = str(row["Title"])
            points = int(row[config_for_kind["value_column"]])
            action_label = f"{config_for_kind['action_prefix']} {title}"
            buttons.append(
                ft.ElevatedButton(
                    content=ft.Column(
                        [ft.Text(title, text_align=ft.TextAlign.CENTER), ft.Text(money_or_points(points), size=12)],
                        spacing=2,
                        horizontal_alignment=ft.CrossAxisAlignment.CENTER,
                    ),
                    width=150,
                    height=78,
                    disabled=bool(state["busy"]),
                    on_click=lambda _, user=user_name, pts=points, action=action_label: update_points(user, pts, action),
                )
            )

        return ft.Column([picker, ft.Row(buttons, wrap=True, spacing=10, run_spacing=10)], spacing=14)

    def render_undo_notice() -> ft.Control:
        if not state["last_action"]:
            return ft.Container()

        last_user, last_points, last_label = state["last_action"]
        summary = ft.Text(
            f"פעולה אחרונה: {last_label} ל-{last_user} ({last_points} נק')",
            expand=not is_narrow_layout(),
        )
        button = ft.OutlinedButton(
            "בטל פעולה אחרונה",
            disabled=bool(state["busy"]),
            on_click=undo_last,
        )
        content: ft.Control
        if is_narrow_layout():
            content = ft.Column([summary, button], spacing=10)
        else:
            content = ft.Row(
                [summary, button],
                spacing=10,
                wrap=True,
                vertical_alignment=ft.CrossAxisAlignment.CENTER,
            )
        return ft.Container(
            content=content,
            padding=12,
            bgcolor=ft.Colors.AMBER_50,
            border=ft.border.all(1, ft.Colors.AMBER_200),
            border_radius=10,
        )

    def render_prizes_panel() -> ft.Control:
        prizes_df = data["prizes_df"]
        if prizes_df.empty:
            return ft.Text("אין פרסים זמינים כרגע.", color=ft.Colors.GREY_700)

        user_name = selected_user("prizes")
        current_points = service.current_member_points(data["members_df"], user_name)
        controls = [render_user_picker("prizes"), ft.Text(f"יתרה נוכחית: {money_or_points(current_points)}")]

        prize_buttons = []
        for _, row in prizes_df.iterrows():
            title = str(row["Title"])
            price = int(row["Price"])
            disabled = current_points < price
            prize_buttons.append(
                ft.ElevatedButton(
                    content=ft.Column(
                        [ft.Text(title, text_align=ft.TextAlign.CENTER), ft.Text(money_or_points(price), size=12)],
                        spacing=2,
                        horizontal_alignment=ft.CrossAxisAlignment.CENTER,
                    ),
                    width=150,
                    height=78,
                    disabled=disabled or bool(state["busy"]),
                    on_click=lambda _, user=user_name, cost=price, prize=title: update_points(user, -cost, f"מימוש {prize}"),
                )
            )
        controls.append(ft.Row(prize_buttons, wrap=True, spacing=10, run_spacing=10))
        return ft.Column(controls, spacing=14)

    def render_catalog_panel(kind: str, catalog_df: pd.DataFrame) -> ft.Control:
        config_for_kind = get_catalog_config(kind)
        controls: list[ft.Control] = [
            ft.Row(
                [
                    ft.Text(config_for_kind["tab_label"], size=18, weight=ft.FontWeight.BOLD, expand=True),
                    ft.ElevatedButton("הוספה", disabled=bool(state["busy"]), on_click=lambda _: open_catalog_form(kind)),
                ]
            )
        ]

        if kind in state["catalog_forms"]:
            controls.append(render_catalog_form(kind, catalog_df))

        if catalog_df.empty:
            controls.append(ft.Text(config_for_kind["empty_message"], color=ft.Colors.GREY_700))
            return ft.Column(controls, spacing=12)

        catalog_rows: list[ft.Control] = [
            ft.Row(
                [
                    ft.Text("שם", weight=ft.FontWeight.BOLD, expand=True),
                    ft.Text(config_for_kind["value_label"], weight=ft.FontWeight.BOLD, width=80),
                    ft.Text("", width=80),
                    ft.Text("", width=130),
                ],
                spacing=8,
            )
        ]
        for index, row in catalog_df.reset_index(drop=True).iterrows():
            pending_delete = state["pending_catalog_delete"].get(kind) == index
            if pending_delete:
                delete_control = ft.Row(
                    [
                        ft.ElevatedButton("אשר", disabled=bool(state["busy"]), on_click=lambda _, i=index: delete_catalog_item(kind, catalog_df, i)),
                        ft.OutlinedButton("בטל", disabled=bool(state["busy"]), on_click=lambda _: cancel_delete_catalog_item(kind)),
                    ],
                    spacing=6,
                )
            else:
                delete_control = ft.OutlinedButton(
                    "מחיקה",
                    disabled=bool(state["busy"]),
                    on_click=lambda _, i=index: request_delete_catalog_item(kind, i),
                )
            catalog_rows.append(
                ft.Container(
                    content=ft.Row(
                        [
                            ft.Text(str(row["Title"]), expand=True),
                            ft.Text(str(int(row[config_for_kind["value_column"]])), width=80),
                            ft.OutlinedButton("עדכון", disabled=bool(state["busy"]), on_click=lambda _, i=index: open_catalog_form(kind, i)),
                            delete_control,
                        ],
                        spacing=8,
                        vertical_alignment=ft.CrossAxisAlignment.CENTER,
                    ),
                    padding=8,
                    border=ft.border.only(bottom=ft.BorderSide(1, ft.Colors.GREY_300)),
                )
            )
        controls.append(ft.Column(catalog_rows, spacing=0))
        return ft.Column(controls, spacing=12)

    def render_history_panel() -> ft.Control:
        try:
            history_df = service.get_history_data()
        except SheetAccessError as exc:
            render_sheet_error(page, exc, config.service_account_email, config.spreadsheet)
            return ft.Text("")
        if history_df.empty:
            table = ft.Text("אין פעולות מתועדות ב-8 הימים האחרונים.", color=ft.Colors.GREY_700)
        else:
            table_rows: list[ft.Control] = [
                ft.Row(
                    [
                        ft.Text("תאריך", weight=ft.FontWeight.BOLD, width=100),
                        ft.Text("שעה", weight=ft.FontWeight.BOLD, width=90),
                        ft.Text("משתמש", weight=ft.FontWeight.BOLD, width=100),
                        ft.Text("פעולה", weight=ft.FontWeight.BOLD, width=260),
                        ft.Text("שינוי", weight=ft.FontWeight.BOLD, width=80),
                        ft.Text("לפני", weight=ft.FontWeight.BOLD, width=80),
                        ft.Text("אחרי", weight=ft.FontWeight.BOLD, width=80),
                    ],
                    spacing=8,
                )
            ]

            def history_value(row: pd.Series, column: str) -> str:
                value = row.get(column, "")
                if pd.isna(value):
                    return ""
                if column in {"Points", "PreviousPoints", "CurrentPoints"}:
                    return str(int(value))
                return str(value)

            for _, row in history_df.head(50).iterrows():
                table_rows.append(
                    ft.Container(
                        content=ft.Row(
                            [
                                ft.Text(history_value(row, "Date"), width=100),
                                ft.Text(history_value(row, "Time"), width=90),
                                ft.Text(history_value(row, "User"), width=100),
                                ft.Text(history_value(row, "Action"), width=260),
                                ft.Text(history_value(row, "Points"), width=80),
                                ft.Text(history_value(row, "PreviousPoints"), width=80),
                                ft.Text(history_value(row, "CurrentPoints"), width=80),
                            ],
                            spacing=8,
                        ),
                        padding=6,
                        border=ft.border.only(bottom=ft.BorderSide(1, ft.Colors.GREY_300)),
                    )
                )

            table = ft.Row(
                [ft.Column(table_rows, spacing=0, width=860)],
                scroll=ft.ScrollMode.AUTO,
            )
        return ft.Column(
            [
                ft.Row(
                    [
                        ft.Text("היסטוריית פעולות", size=18, weight=ft.FontWeight.BOLD, expand=True),
                        ft.ElevatedButton("נקה היסטוריה", disabled=bool(state["busy"]), on_click=clear_history),
                    ]
                ),
                table,
            ],
            spacing=12,
        )

    def render_admin_tabs() -> ft.Control:
        return ft.Column(
            [
                render_undo_notice(),
                render_tab_switcher(
                    "admin",
                    [
                        ("מטלות", lambda: render_task_panel("chores", data["chores_df"], True)),
                        ("התנהגות", lambda: render_task_panel("behavior", data["behavior_df"], True)),
                        ("לימוד", lambda: render_task_panel("education", data["education_df"], True)),
                        ("פרסים", render_prizes_panel),
                        ("ניהול מטלות", lambda: render_catalog_panel("chores", data["chores_df"])),
                        ("ניהול התנהגות", lambda: render_catalog_panel("behavior", data["behavior_df"])),
                        ("ניהול לימוד", lambda: render_catalog_panel("education", data["education_df"])),
                        ("ניהול פרסים", lambda: render_catalog_panel("prizes", data["prizes_df"])),
                        ("תבנית התחלה", lambda: ft.ElevatedButton("טעינת תבנית התחלתית", disabled=bool(state["busy"]), on_click=load_starter_template)),
                        ("היסטוריה", render_history_panel),
                    ],
                ),
            ],
            spacing=12,
        )

    def render_child_tabs() -> ft.Control:
        if state["active_user"] not in data["members_df"]["Name"].tolist():
            return ft.Text(f"המשתמש {state['active_user']} לא נמצא בגיליון Members.", color=ft.Colors.RED)
        return render_tab_switcher(
            "child",
            [
                ("מטלות", lambda: render_task_panel("chores", data["chores_df"], False)),
                ("התנהגות", lambda: render_task_panel("behavior", data["behavior_df"], False)),
                ("לימוד", lambda: render_task_panel("education", data["education_df"], False)),
            ],
        )

    rerender()


def render_startup_error(page: ft.Page, exc: Exception) -> None:
    page.controls.clear()
    page.add(
        ft.Column(
            [
                ft.Text("שגיאת הגדרה", size=22, weight=ft.FontWeight.BOLD, color=ft.Colors.RED),
                ft.Text(str(exc)),
                ft.Text("בדוק את .streamlit/secrets.toml או את משתני הסביבה של POINT_SYSTEM."),
            ],
            spacing=12,
        )
    )
    page.update()


def render_sheet_error(page: ft.Page, exc: SheetAccessError, service_account_email: str, spreadsheet: str) -> None:
    page.controls.clear()
    page.add(
        ft.Column(
            [
                ft.Text("שגיאת Google Sheets", size=22, weight=ft.FontWeight.BOLD, color=ft.Colors.RED),
                ft.Text(f"פעולה: {exc.action}"),
                ft.Text(f"HTTP status: {exc.status_code}"),
                ft.Text("ודא שהגיליון משותף עם חשבון השירות בהרשאת Editor."),
                ft.Text(f"Service account: {service_account_email or 'Missing'}"),
                ft.Text(f"Spreadsheet: {spreadsheet or 'Missing'}"),
            ],
            spacing=10,
        )
    )
    page.update()


if __name__ == "__main__":
    ft.run(main)
