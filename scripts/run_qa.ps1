param(
    [switch]$LiveRead,
    [switch]$LiveWrite
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root "venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
    throw "Python virtualenv not found at $python"
}

$args = @((Join-Path $PSScriptRoot "predeploy_check.py"))
if ($LiveRead) {
    $args += "--live-read"
}
if ($LiveWrite) {
    $args += "--live-write"
}

& $python @args
