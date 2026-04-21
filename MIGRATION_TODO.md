# Streamlit to Flet migration TODO

Assumption: "StringLit" means Streamlit and "Felt" means Flet. If the target is a different platform named Felt, keep the backend extraction tasks and replace the Flet-specific run/build steps.

Current app summary:

- Entry point: `app.py`
- Current UI/runtime: Streamlit
- Current data source: Google Sheets through `streamlit_gsheets.GSheetsConnection`
- Current local secrets: `.streamlit/secrets.toml` (ignored by git)
- Current QA entry point: `scripts/run_qa.ps1`
- Worksheets in use: `Members`, `Chores`, `Behavior`, `Education`, `Prizes`, `History`, `MonthlyLedger`

## 1. Confirm migration target

- [x] Confirm target spelling and platform: Flet Python UI framework, not another "Felt" product.
- [ ] Confirm target web mode:
  - [x] Use Flet dynamic web for production because Python, Google credentials, and Google Sheets calls stay server-side.
  - [x] Do not use Flet static web for this app unless Google Sheets writes are moved behind a separate API. Static web exposes client-delivered Python and cannot safely hold service account secrets.
- [x] Confirm whether Streamlit must stay available during migration.
- [ ] Confirm supported users and devices: desktop browser, mobile browser, desktop app, or all.

## 2. Prepare dependency plan

- [x] Keep current Streamlit dependencies until the Flet version is accepted.
- [x] Add Flet dependencies in a separate migration branch.
- [x] Replace `st-gsheets-connection` usage with direct Google Sheets access in shared backend code.
- [x] Add explicit Google dependencies because the backend should not rely on transitive installs:
  - [x] `gspread`
  - [x] `gspread-dataframe`
  - [x] `google-auth`
- [x] Keep `pandas` because the existing cleaning and ledger logic is dataframe-based.
- [ ] Decide whether to maintain one `requirements.txt` or split:
  - [ ] `requirements-streamlit.txt`
  - [ ] `requirements-flet.txt`
  - [ ] `requirements-common.txt`

Suggested local install commands on Windows PowerShell:

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
pip install "flet[all]" gspread gspread-dataframe google-auth
```

## 3. Extract backend from Streamlit

- [x] Create `src/point_system/` or similar package.
- [ ] Move constants that are not UI-specific out of `app.py`:
  - [ ] Worksheet names
  - [ ] Default members
  - [ ] Default chores
  - [ ] Default prizes
  - [ ] Family goal
  - [ ] History retention days
  - [ ] Local timezone
- [ ] Move pure dataframe cleaning functions into backend module:
  - [ ] `clean_members_df`
  - [ ] `build_members_template`
  - [ ] `clean_catalog_df`
  - [ ] `clean_history_df`
  - [ ] `clean_monthly_ledger_df`
- [ ] Move business operations into a service module:
  - [ ] Read members
  - [ ] Read/create catalogs
  - [ ] Update member points
  - [ ] Append history entry
  - [ ] Append monthly ledger entry
  - [ ] Calculate monthly points total
  - [ ] Load starter template
  - [ ] Clear history
- [ ] Keep UI-only behaviors in platform files:
  - [ ] Login screen
  - [ ] Tabs/routes
  - [ ] Dialogs
  - [ ] Buttons and event handlers
  - [ ] Session/page state

Target shape:

```text
app.py                         # existing Streamlit UI, kept during transition
app_flet.py                    # new Flet UI entry point
src/point_system/config.py
src/point_system/defaults.py
src/point_system/sheets.py
src/point_system/service.py
src/point_system/cleaning.py
scripts/run_streamlit.ps1
scripts/run_flet_web.ps1
scripts/predeploy_check.py
```

## 4. Replace Streamlit-only backend dependencies

- [x] Remove backend dependency on `st.secrets`.
- [x] Add a config loader that can read:
  - [x] Current `.streamlit/secrets.toml` during transition
  - [x] Environment variables in production
  - [x] Optional service account JSON path for local development
- [x] Remove backend dependency on `st.connection`.
- [x] Implement `GoogleSheetsStore` with direct `gspread` operations:
  - [x] Open spreadsheet by URL
  - [x] Read worksheet into dataframe
  - [x] Create worksheet if missing
  - [x] Update worksheet from dataframe
  - [ ] Clear/update QA worksheet
- [ ] Replace `st.cache_data.clear()` with a backend cache abstraction or no cache first.
- [ ] Preserve current API error behavior but return typed errors to the UI instead of calling `st.stop()`.

## 5. Keep Streamlit working while backend moves

- [ ] Update `app.py` to call the shared backend service.
- [ ] Keep current Streamlit UI behavior unchanged.
- [ ] Keep current worksheet names and schemas unchanged.
- [ ] Run the existing QA script after each backend extraction step.
- [ ] Add regression checks before deleting old code paths.

Streamlit run command:

```powershell
.\venv\Scripts\Activate.ps1
streamlit run app.py
```

## 6. Build the first Flet web UI

- [x] Create `app_flet.py`.
- [x] Add `ft.run(main)` entry point.
- [ ] Build page state equivalent to current `st.session_state`:
  - [ ] `role`
  - [ ] `active_user`
  - [ ] `selected_login`
  - [ ] `last_action`
  - [ ] pending delete/edit/task states
- [ ] Build login view:
  - [ ] Child login
  - [ ] Admin password login
  - [ ] Logout
- [ ] Build common dashboard:
  - [ ] Monthly goal
  - [ ] Refresh action
  - [ ] Members points table
- [ ] Build admin views:
  - [ ] Chores action tab
  - [ ] Behavior action tab
  - [ ] Education action tab
  - [ ] Prize redemption tab
  - [ ] Catalog management
  - [ ] Starter template action
  - [ ] History table
- [ ] Build child views:
  - [ ] Chores buttons
  - [ ] Behavior buttons
  - [ ] Education buttons
  - [ ] Confirmation dialog before adding points
- [ ] Add dialogs/snackbars for:
  - [ ] Success message
  - [ ] Delete confirmation
  - [ ] Clear history confirmation
  - [ ] Edit/add item forms
  - [ ] Google Sheets errors

Flet local web run command:

```powershell
.\venv\Scripts\Activate.ps1
flet run --web --port 8000 app_flet.py
```

## 7. Web installation and deployment

- [x] Choose deployment mode: dynamic Flet web.
- [x] Configure production secrets outside git:
  - [x] Spreadsheet URL
  - [x] Google service account JSON fields or JSON file
  - [x] Admin password, moved out of code
- [ ] Confirm service account email has Editor permission on the spreadsheet.
- [x] Add production start command:

```powershell
python app_flet.py
```

- [x] For Linux/container hosting, expose the configured port and host.
- [ ] Add health or smoke check that reads all required worksheets.
- [ ] Run live read QA before deployment.
- [ ] Run live write QA against `QA_Check` before public release.
- [ ] Keep Streamlit deployment active until Flet has passed acceptance testing.

Do not use this production path unless backend secrets have been removed from browser-delivered code:

```powershell
flet build web app_flet.py
flet serve build\web
```

## 8. Platform switch plan

- [x] Keep both entry points temporarily:
  - [x] `streamlit run app.py`
  - [x] `flet run --web app_flet.py`
- [x] Add scripts for repeatable runs:
  - [x] `scripts/run_streamlit.ps1`
  - [x] `scripts/run_flet_web.ps1`
- [x] Add a README section showing both commands.
- [ ] Use the same shared backend modules for both platforms.
- [ ] Freeze worksheet schemas so both apps can read/write the same data.
- [ ] Pick one source of truth for secrets and document it.
- [ ] After Flet acceptance, remove or archive Streamlit-only code:
  - [ ] `streamlit` dependency
  - [ ] `st-gsheets-connection`
  - [ ] Streamlit-only secrets access
  - [ ] Streamlit-only UI entry point, if no longer needed

## 9. QA checklist

- [ ] Unit checks for dataframe cleaning.
- [ ] Unit checks for monthly goal logic.
- [ ] Unit checks for prize redemption and undo.
- [ ] Live read check against Google Sheets.
- [ ] Live write check against `QA_Check`.
- [ ] Manual Streamlit smoke test before UI parity work.
- [ ] Manual Flet smoke test after each major view.
- [ ] Browser checks:
  - [ ] Desktop width
  - [ ] Mobile width
  - [ ] Hebrew/right-to-left text display
  - [ ] Long task names
  - [ ] Empty catalogs
  - [ ] Missing worksheet creation
  - [ ] Google Sheets permission failure

Current QA commands:

```powershell
.\scripts\run_qa.ps1
.\scripts\run_qa.ps1 -LiveRead
.\scripts\run_qa.ps1 -LiveRead -LiveWrite
```

## 10. Acceptance criteria

- [ ] Streamlit and Flet can both read the same spreadsheet during transition.
- [ ] Flet can update points, history, and monthly ledger.
- [ ] Flet can create missing worksheets.
- [ ] Flet can manage chores, behavior tasks, education tasks, and prizes.
- [ ] Admin password is no longer hardcoded in source.
- [ ] Production secrets are not committed to git.
- [ ] QA script passes locally.
- [ ] Live read/write checks pass.
- [ ] User can shift between Streamlit and Flet with documented commands.
- [ ] Final deployment URL opens the Flet web app.

## Official docs checked

- Streamlit deployment concepts: https://docs.streamlit.io/deploy/concepts
- Streamlit secrets management: https://docs.streamlit.io/develop/concepts/connections/secrets-management
- Flet run web app: https://flet.dev/docs/getting-started/running-app/
- Flet dynamic web publishing: https://docs.flet.dev/publish/web/dynamic-website/
- Flet static web publishing: https://docs.flet.dev/publish/web/static-website/
- Flet build command: https://flet.dev/docs/cli/flet-build
