param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root "venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    throw "Python virtualenv not found at $python"
}

$env:FLET_FORCE_WEB_SERVER = "true"
$env:FLET_SERVER_IP = "127.0.0.1"
$env:FLET_SERVER_PORT = "$Port"

& $python (Join-Path $root "app_flet.py")
