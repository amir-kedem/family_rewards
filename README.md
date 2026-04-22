## Family Rewards

A gamified task and reward system designed to drive behavior and accountability in family environments.

![Family Rewards Screenshot](https://raw.githubusercontent.com/amir-kedem/family_rewards/main/assets/Screenshot.png)

[View Project](https://github.com/amir-kedem/family_rewards)

## Platform

The app now targets Flet dynamic web as the active UI. Streamlit was useful for the trial run because it made the first Google Sheets workflow quick to build and validate, but it is not the right path for continued use. The need for a more app-like, controllable interface was the incentive to transition to Flet.

The current production path is:

- `app_flet.py` for the Flet web app.
- `src/point_system/` for shared data cleaning, Google Sheets access, and point-system service logic.
- Google Sheets worksheets for persistent data: `Members`, `Chores`, `Behavior`, `Education`, `Prizes`, `History`, and `MonthlyLedger`.
- `MIGRATION_TODO.md` as the working checklist for continuing the migration and tracking remaining cleanup.

## Run Flet Web

```powershell
.\scripts\run_flet_web.ps1
```

Use a custom port if needed:

```powershell
.\scripts\run_flet_web.ps1 -Port 8001
```

## Change Process

Continue changes from `MIGRATION_TODO.md`:

1. Pick the next unchecked migration item.
2. Move shared behavior into `src/point_system/` when it belongs to the backend/service layer.
3. Keep UI behavior in `app_flet.py`.
4. Run the QA script after each meaningful backend or workflow change:

```powershell
.\venv\Scripts\python.exe scripts\predeploy_check.py
```

For a live Google Sheets workflow check that does not touch the real production tabs, run:

```powershell
.\venv\Scripts\python.exe scripts\predeploy_check.py --live-action-qa
```

That live QA command writes only to isolated QA worksheets: `QA_Members`, `QA_History`, and `QA_MonthlyLedger`.

## Deploy Flet To A Web Server

Use the Flet app as a dynamic web app. Python runs on the server and Google service account secrets stay server-side.

Required environment variables:

```text
POINT_SYSTEM_SPREADSHEET=https://docs.google.com/spreadsheets/d/...
POINT_SYSTEM_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
POINT_SYSTEM_ADMIN_PASSWORD=change-this-password
FLET_FORCE_WEB_SERVER=true
FLET_SERVER_IP=0.0.0.0
FLET_SERVER_PORT=8000
```

Many hosts provide `PORT` instead of `FLET_SERVER_PORT`; `app_flet.py` maps `PORT` automatically when present.

Production start command:

```bash
python app_flet.py
```

Docker deployment:

```bash
docker build -t family-rewards-flet .
docker run --rm -p 8000:8000 \
  -e POINT_SYSTEM_SPREADSHEET="https://docs.google.com/spreadsheets/d/..." \
  -e POINT_SYSTEM_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}' \
  -e POINT_SYSTEM_ADMIN_PASSWORD="change-this-password" \
  family-rewards-flet
```

Before publishing, share the Google Sheet with the service account email as Editor.
