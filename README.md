## Family Rewards

A gamified task and reward system designed to drive behavior and accountability in family environments.

![Family Rewards Screenshot](https://raw.githubusercontent.com/amir-kedem/family_rewards/main/assets/Screenshot.png)

[View Project](https://github.com/amir-kedem/family_rewards)

## Platform Shift

The app is moving from Streamlit to Flet dynamic web. During the transition, both entry points can use the same Google Sheets workbook and worksheet schema.

## Run Streamlit

```powershell
.\scripts\run_streamlit.ps1
```

## Run Flet Web

```powershell
.\scripts\run_flet_web.ps1
```

Use a custom port if needed:

```powershell
.\scripts\run_flet_web.ps1 -Port 8001
```

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
