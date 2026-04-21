param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$flet = Join-Path $root "venv\Scripts\flet.exe"

if (-not (Test-Path $flet)) {
    throw "Flet executable not found at $flet. Run: .\venv\Scripts\python.exe -m pip install -r requirements.txt"
}

& $flet run --web --port $Port (Join-Path $root "app_flet.py")
