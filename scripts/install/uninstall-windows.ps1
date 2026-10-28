param([switch]$ValidateOnly, [string]$CleanupTask)
$ErrorActionPreference = 'Stop'
# This script is copied outside the installation before services/processes are stopped.
function Assert-CleanupPath($Root, $ProtectedPaths) {
    $Full = [IO.Path]::GetFullPath($Root).TrimEnd([IO.Path]::DirectorySeparatorChar)
    $Cursor = $Full
    while ($Cursor) {
        if (Test-Path -LiteralPath $Cursor) {
            $Item = Get-Item -LiteralPath $Cursor -Force
            if ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked cleanup directory is not safe to remove.' }
        }
        $Parent = [IO.Path]::GetDirectoryName($Cursor)
        if ($Parent -eq $Cursor) { break }; $Cursor = $Parent
    }
    foreach ($Protected in $ProtectedPaths) {
        $P = [IO.Path]::GetFullPath($Protected).TrimEnd([IO.Path]::DirectorySeparatorChar)
        # Resolve a configured Codex junction before checking overlap.
        $Cursor = $P; $Tail = @()
        while ($Cursor) {
            if (Test-Path -LiteralPath $Cursor) {
                $Item = Get-Item -LiteralPath $Cursor -Force
                if ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                    # Fail closed rather than guessing the target of a junction or symbolic link.
                    throw 'Codex data uses a link; automatic cleanup requires manual path review.'
                }
            }
            $Parent = [IO.Path]::GetDirectoryName($Cursor)
            if ($Parent -eq $Cursor) { break }; $Cursor = $Parent
        }
        $Sep = [IO.Path]::DirectorySeparatorChar
        if ($P.Equals($Full,[StringComparison]::OrdinalIgnoreCase) -or $P.StartsWith($Full+$Sep,[StringComparison]::OrdinalIgnoreCase) -or $Full.StartsWith($P+$Sep,[StringComparison]::OrdinalIgnoreCase)) { throw 'Codex data overlaps Biuuka cleanup. Nothing was deleted.' }
    }
}
function Remove-OwnedTree($Root) {
    if (!(Test-Path -LiteralPath $Root)) { return }
    $Item = Get-Item -LiteralPath $Root -Force
    if ($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
        if ($Item.PSIsContainer) { [IO.Directory]::Delete($Item.FullName) } else { [IO.File]::Delete($Item.FullName) }
        return
    }
    if (!$Item.PSIsContainer) { $Item.IsReadOnly=$false; [IO.File]::Delete($Item.FullName); return }
    foreach ($Child in Get-ChildItem -LiteralPath $Root -Force) { Remove-OwnedTree $Child.FullName }
    [IO.Directory]::Delete($Root)
}
$Sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if ($CleanupTask) {
    if ($CleanupTask -notmatch ('^Biuuka-Cleanup-' + [regex]::Escape($Sid) + '-[a-f0-9]{32}$')) { throw 'Invalid cleanup task.' }
    # Removing the registration does not stop this already-running task.
    Unregister-ScheduledTask -TaskName $CleanupTask -Confirm:$false
}
$Program = Join-Path $env:ProgramFiles 'Biuuka'
$State = Join-Path $env:USERPROFILE '.biuuka'
$CleanupContext = '__BIUUKA_CLEANUP_CONTEXT__'
if ($CleanupContext -eq '__BIUUKA_' + 'CLEANUP_CONTEXT__') {
$Owner = Get-Content -LiteralPath (Join-Path $Program 'service-owner.json') -Raw | ConvertFrom-Json
if ($Owner.sid -ne $Sid) { throw 'Installation belongs to another user.' }
$Config = Get-Content -LiteralPath (Join-Path $State 'config.json') -Raw | ConvertFrom-Json
} else {
    $Saved = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($CleanupContext)) | ConvertFrom-Json
    if ($Saved.sid -ne $Sid) { throw 'Cleanup belongs to another user.' }
    $Config = @{ codexHome=$Saved.codexHome }
}
$Roots = @($State, $Program, (Join-Path $env:LOCALAPPDATA 'Biuuka'))
$ProtectedPaths = @((Join-Path $env:USERPROFILE '.codex'), $Config.codexHome)
if ($env:CODEX_HOME) { $ProtectedPaths += $env:CODEX_HOME }
foreach ($Root in $Roots) { Assert-CleanupPath $Root $ProtectedPaths }
if ($ValidateOnly) { exit 0 }
$Principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if ($CleanupContext -eq '__BIUUKA_' + 'CLEANUP_CONTEXT__') {
    $Encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@{sid=$Sid;codexHome=$Config.codexHome} | ConvertTo-Json -Compress)))
    $Text = [IO.File]::ReadAllText($PSCommandPath).Replace('__BIUUKA_' + 'CLEANUP_CONTEXT__',$Encoded)
    [IO.File]::WriteAllText($PSCommandPath,$Text,(New-Object Text.UTF8Encoding($true)))
}
if (!$Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $Shell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '"'
    Start-Process -FilePath $Shell -ArgumentList $Arguments -Verb RunAs | Out-Null
    exit 0
}
$Service = Get-CimInstance Win32_Service -Filter "Name='Biuuka'"
if ($Service -and $Service.PathName.Trim('"') -ne (Join-Path $Program 'service.exe')) { throw 'Service belongs to another installation.' }
Start-Sleep -Seconds 2
foreach ($Task in @(('Biuuka-Tray-'+$Sid), ('Biuuka-Helper-'+$Sid))) {
    $Entry = Get-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue
    if ($Entry) { Stop-ScheduledTask -TaskName $Task -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $Task -Confirm:$false }
}
if ($Service) {
    Stop-Service Biuuka
    (Get-Service Biuuka).WaitForStatus('Stopped',[TimeSpan]::FromSeconds(30))
    & sc.exe delete Biuuka | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Service removal failed; cleanup file retained.' }
}
# Include manually started trays, but never match or terminate a shared codex.exe/node.exe by name.
$Launchers = @()
foreach ($Root in @($Program,(Join-Path $State 'app'),(Join-Path $State 'base'))) {
    foreach ($File in @('launcher.mjs','cli.mjs','supervisor.mjs','tray-windows.ps1','run.ps1')) { $Launchers += [regex]::Escape((Join-Path $Root $File)) }
}
$Pattern = '(?:^|["\s])(?:' + ($Launchers -join '|') + ')(?:["\s]|$)'
foreach ($Process in Get-CimInstance Win32_Process) {
    if ($Process.ProcessId -eq $PID) { continue }
    if ($Process.ExecutablePath -eq (Join-Path $Program 'service.exe') -or ($Process.Name -in @('node.exe','powershell.exe') -and $Process.CommandLine -match $Pattern)) {
        & "$env:SystemRoot\System32\taskkill.exe" /PID $Process.ProcessId /T /F 2>$null | Out-Null
    }
}
$UserPath = [Environment]::GetEnvironmentVariable('Path','User')
[Environment]::SetEnvironmentVariable('Path',((@($UserPath -split ';') | Where-Object { $_.TrimEnd('\') -ine $Program.TrimEnd('\') }) -join ';'),'User')
# Program binaries may remain locked briefly after the process tree exits.
for ($Attempt=0; $Attempt -lt 30; $Attempt++) {
    try { foreach ($Root in $Roots) { Assert-CleanupPath $Root $ProtectedPaths; Remove-OwnedTree $Root }; break }
    catch { if ($Attempt -eq 29) { throw }; Start-Sleep -Seconds 1 }
}
foreach ($Root in $Roots) { if (Test-Path -LiteralPath $Root) { throw 'Cleanup incomplete; cleanup file retained.' } }
Remove-Item -LiteralPath $PSCommandPath -Force
