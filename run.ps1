param([switch]$Tray)
$ErrorActionPreference = 'Stop'
$Child = $null
try {
    $Owner = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot 'service-owner.json') | ConvertFrom-Json
    $Sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    if ($Sid -eq 'S-1-5-18' -or $Sid -ne $Owner.sid) { throw 'Incorrect helper user.' }
    if (!$Tray -and (Get-Service Biuuka).Status -notin @('Running','StartPending')) { exit 0 }
    $State = Join-Path $env:USERPROFILE '.biuuka'
    $Config = Get-Content -Raw -Encoding UTF8 (Join-Path $State 'config.json') | ConvertFrom-Json
    $env:CODEX_HOME = $Config.codexHome
    $env:BIUUKA_STATE = $State
    $Entry = if ($Tray) { 'launcher.mjs' } else { 'supervisor.mjs' }
    $Arguments = '"' + (Join-Path $PSScriptRoot $Entry) + '"'
    if ($Tray) { $Arguments += ' tray-run' }
    $Child = Start-Process -FilePath $Config.node -ArgumentList $Arguments -WorkingDirectory $State -WindowStyle Hidden -PassThru
    while (!$Child.HasExited) {
        if (!$Tray -and (Get-Service Biuuka).Status -notin @('Running','StartPending')) { break }
        Start-Sleep -Milliseconds 500; $Child.Refresh()
    }
    if ($Child.HasExited -and $Child.ExitCode -ne 0) { exit 1 }
} catch {
    # No provider messages, environment contents or account objects in logs.
    exit 1
} finally {
    if ($Child -and !$Child.HasExited) { & "$env:SystemRoot\System32\taskkill.exe" /PID $Child.Id /T /F | Out-Null }
}
