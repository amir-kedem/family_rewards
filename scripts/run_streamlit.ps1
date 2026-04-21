$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$streamlit = Join-Path $root "venv\Scripts\streamlit.exe"

if (-not (Test-Path $streamlit)) {
    throw "Streamlit executable not found at $streamlit. Run: .\venv\Scripts\python.exe -m pip install -r requirements.txt"
}

& $streamlit run (Join-Path $root "app.py")
