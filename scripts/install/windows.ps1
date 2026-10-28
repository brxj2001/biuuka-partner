param(
    [ValidateSet('install','start','stop','restart','uninstall','install-service')][string]$Action = 'install',
    [switch]$Elevated,
    [string]$OwnerSid,
    [string]$ExpectedManifest
)
$ErrorActionPreference = 'Stop'
$Program = Join-Path $env:ProgramFiles 'Biuuka'
$State = Join-Path $env:USERPROFILE '.biuuka'
$Shell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$Sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$Utf8 = New-Object Text.UTF8Encoding($false)
function Read-Json($File) { Get-Content -Raw -Encoding UTF8 -LiteralPath $File | ConvertFrom-Json }
function Write-Json($File, $Value) { [IO.File]::WriteAllText($File, ($Value | ConvertTo-Json -Depth 8), $Utf8) }
function Verify($Folder, $Digest) {
    if ((Get-FileHash -LiteralPath (Join-Path $Folder 'manifest.json')).Hash -ne $Digest) { throw 'Manifest changed.' }
    foreach ($File in (Read-Json (Join-Path $Folder 'manifest.json'))) {
        if ([IO.Path]::IsPathRooted($File.path) -or $File.path -match '(^|[\\/])\.\.([\\/]|$)') { throw 'Invalid package path.' }
        $Full = Join-Path $Folder $File.path
        if ((Get-Item -LiteralPath $Full).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Package links are not permitted.' }
        if ((Get-FileHash -LiteralPath $Full).Hash -ne $File.sha256) { throw 'Package checksum mismatch.' }
    }
}
function Get-Dependency($Source, $Target) {
    New-Item -ItemType Directory -Force (Join-Path $State 'cache') | Out-Null
    foreach ($Folder in @($env:BIUUKA_OFFLINE_DIR, (Join-Path $State 'cache'))) {
        if (!$Folder) { continue }
        $Cached = Join-Path $Folder $Source.cacheFile
        if ((Test-Path -LiteralPath $Cached) -and (Get-FileHash -LiteralPath $Cached).Hash.ToLowerInvariant() -eq $Source.digest) {
            Copy-Item -LiteralPath $Cached -Destination $Target -Force
            Write-Json (Join-Path $State 'node-source.json') @{ source='local-cache'; verified=$true }
            Write-Host 'Verified Node.js local cache.'; return
        }
    }
    if ($env:BIUUKA_OFFLINE_ONLY -eq '1') { throw 'Offline Node.js cache missing or checksum mismatch.' }
    foreach ($Url in @($Source.mirrors) + @($Source.url)) {
        Write-Host ('Downloading Node.js from ' + ([Uri]$Url).Host + ' ...')
        & curl.exe --fail --location --progress-bar --show-error --connect-timeout 8 --max-time 300 --speed-limit 1024 --speed-time 20 --output $Target $Url
        if ($LASTEXITCODE -eq 0 -and (Get-FileHash -LiteralPath $Target).Hash.ToLowerInvariant() -eq $Source.digest) {
            Copy-Item -LiteralPath $Target -Destination (Join-Path (Join-Path $State 'cache') $Source.cacheFile) -Force
            Write-Json (Join-Path $State 'node-source.json') @{ source=([Uri]$Url).Host; verified=$true }; return
        }
        Write-Host 'Source unavailable or checksum mismatch; trying the next source.'
    }
    Remove-Item -LiteralPath $Target -Force -ErrorAction SilentlyContinue
    throw 'All Node.js sources failed. Use a prepared offline package or check network access.'
}
function Stop-Biuuka {
    $Service = Get-Service Biuuka -ErrorAction SilentlyContinue
    if ($Service -and $Service.Status -ne 'Stopped') { Stop-Service Biuuka; $Service.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30)) }
    if ($TaskName) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
    $Deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        $Busy = @(Get-CimInstance Win32_Process -Filter "Name='service.exe'" | Where-Object { $_.ExecutablePath -eq (Join-Path $Program 'service.exe') -and $_.CommandLine -notmatch '(?:^|\s)--tray(?:\s|$)' })
        if (!$Busy.Count) { return }; Start-Sleep -Milliseconds 300
    } while ([DateTime]::UtcNow -lt $Deadline)
    throw 'Service executable is still in use.'
}
try {
    if ($Sid -eq 'S-1-5-18') { throw 'Run from your signed-in Windows account.' }
    if (!$Elevated) {
        if ($Action -eq 'install') {
            Write-Host '[1/6] Biuuka files unpacked. Checking Windows and CPU architecture...'
            Write-Host 'Dependencies are prepared before the service is installed. Existing service stays running during preparation.'
            $Arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
            if ($Arch -notin @('AMD64','ARM64')) { throw 'Biuuka requires x64 or ARM64 Windows.' }
            if ([Environment]::OSVersion.Version.Build -lt 19041) { throw 'Biuuka requires Windows 10 build 19041 or newer (ARM64: Windows 11).' }
            if ($Arch -eq 'ARM64' -and [Environment]::OSVersion.Version.Build -lt 22000) { throw 'ARM64 requires Windows 11.' }
            if (!(Get-Command tar.exe -ErrorAction SilentlyContinue)) { throw 'Windows tar.exe is required. Update Windows first.' }
            $NativeArch = if ($Arch -eq 'ARM64') { 'arm64' } else { 'x64' }
            if (!(Get-Command curl.exe -ErrorAction SilentlyContinue)) { throw 'Windows curl.exe is required. Update Windows first.' }
            Write-Host "[2/6] Checking Node.js 24+ ($NativeArch)..."
            $Node = $null
            foreach ($Possible in @((Join-Path $Program 'runtime\node.exe'), (Get-Command node.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source))) {
                if ($Possible -and (Test-Path -LiteralPath $Possible)) {
                    $Info = & $Possible -p "process.versions.node.split('.')[0] + ':' + process.arch" 2>$null
                    if ($LASTEXITCODE -eq 0 -and $Info -match ('^(2[4-9]|[3-9][0-9]):' + $NativeArch + '$')) { $Node = $Possible; break }
                }
            }
            if (!$Node) {
                Write-Host "Installing verified Node.js for $NativeArch..."
                $Source = (Read-Json (Join-Path $PSScriptRoot 'sources.json')).("win32-$NativeArch").node
                New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot 'runtime') | Out-Null
                $Node = Join-Path $PSScriptRoot 'runtime\node.exe'
                [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                Get-Dependency $Source $Node
            }
            if ($Node -eq (Join-Path $Program 'runtime\node.exe')) { New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot 'runtime') | Out-Null; Copy-Item -LiteralPath $Node -Destination (Join-Path $PSScriptRoot 'runtime\node.exe'); $Node = Join-Path $PSScriptRoot 'runtime\node.exe' }
            Write-Host '[2/6] Node.js ready. Checking Codex dependency...'
            & $Node (Join-Path $PSScriptRoot 'setup.mjs') prepare $Program
            if ($LASTEXITCODE -ne 0) { throw 'Environment preparation failed.' }
            Write-Host '[5/6] Preparing verified service files and requesting administrator approval...'
            $Files = @(Get-ChildItem -LiteralPath $PSScriptRoot -Recurse -File | Where-Object { $_.Name -ne 'manifest.json' } | ForEach-Object { @{ path = $_.FullName.Substring($PSScriptRoot.Length + 1); sha256 = (Get-FileHash -LiteralPath $_.FullName).Hash } })
            Write-Json (Join-Path $PSScriptRoot 'manifest.json') $Files
            $ExpectedManifest = (Get-FileHash (Join-Path $PSScriptRoot 'manifest.json')).Hash
        }
        $Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $PSCommandPath + '" -Action ' + $Action + ' -Elevated -OwnerSid ' + $Sid
        if ($ExpectedManifest) { $Arguments += ' -ExpectedManifest ' + $ExpectedManifest }
        # Keep the elevated UI in CMD; PowerShell is only the built-in service helper.
        $AdminCmd = Join-Path $env:TEMP ('biuuka-admin-' + [guid]::NewGuid().ToString('N') + '.cmd')
        $AdminText = '@echo off' + "`r`nsetlocal DisableDelayedExpansion`r`n" + 'title Biuuka - service installation' + "`r`n" + 'echo Biuuka: administrator service operation. Please wait...' + "`r`n" + '"' + $Shell.Replace('%','%%') + '" ' + $Arguments.Replace('%','%%') + "`r`nexit /b %errorlevel%`r`n"
        [IO.File]::WriteAllText($AdminCmd, $AdminText, [Text.Encoding]::Default)
        Write-Host 'Approve Windows UAC. Service progress will appear in the administrator CMD window.'
        $Child = Start-Process $env:ComSpec -ArgumentList ('/d /s /c ""' + $AdminCmd + '""') -Verb RunAs -PassThru
        $ChildHandle = $Child.Handle # Retain the process handle so ExitCode remains available after exit.
        $Elapsed = 0
        while (!$Child.WaitForExit(10000)) { $Elapsed += 10; Write-Host "Service operation in administrator CMD is still running ($Elapsed seconds)." }
        $Child.Refresh()
        Remove-Item -LiteralPath $AdminCmd -Force -ErrorAction SilentlyContinue
        if ($Child.ExitCode -ne 0) { throw 'Service operation failed; see the administrator window.' }
        if ($Action -eq 'install') {
            Write-Host '[6/6] Service is online. Checking local endpoint and account status...'
            $Config = Read-Json (Join-Path $State 'config.json')
            & $Config.node (Join-Path $Program 'cli.mjs') doctor
            Write-Host 'Installed. Open a NEW CMD window: biuuka status / biuuka login / biuuka open'
            Write-Host 'If account verification failed, run biuuka login. No chat was sent during installation.'
            & $Config.node (Join-Path $Program 'cli.mjs') open
        }
        exit 0
    }
    if (!([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator rights are required.' }
    if ($OwnerSid -ne $Sid) { throw 'Approve UAC with the same signed-in account.' }
    $TaskName = 'Biuuka-Helper-' + $Sid
    $TrayTask = 'Biuuka-Tray-' + $Sid
    $Existing = Get-CimInstance Win32_Service -Filter "Name='Biuuka'"
    if ($Existing) {
        if ($Existing.PathName.Trim('"') -ne (Join-Path $Program 'service.exe') -or (Read-Json (Join-Path $Program 'service-owner.json')).sid -ne $Sid) { throw 'Biuuka name belongs to another installation or user.' }
    }
    if ($Action -eq 'install') {
        Write-Host '[5/6] Administrator approved. Verifying installation manifest...'
        Verify $PSScriptRoot $ExpectedManifest
        $Candidate = $Program + '.candidate'; $Backup = $Program + '.replacing'
        if ((Test-Path $Candidate) -or (Test-Path $Backup)) { throw 'Interrupted upgrade directory exists. Inspect it before retrying.' }
        New-Item -ItemType Directory $Candidate | Out-Null
        & icacls.exe $Candidate /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' "*${Sid}:(OI)(CI)RX" | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Cannot protect installation files.' }
        $HadOld = Test-Path $Program; $Switched = $false; $OldConfig = $null
        New-Item -ItemType Directory -Force $State | Out-Null
        & icacls.exe $State /inheritance:r /grant:r "*${Sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Cannot protect local state.' }
        if (Test-Path (Join-Path $State 'config.json')) { $OldConfig = [IO.File]::ReadAllText((Join-Path $State 'config.json')) }
        try {
            Write-Host '[5/6] Copying verified files to the protected service directory...'
            foreach ($File in (Read-Json (Join-Path $PSScriptRoot 'manifest.json'))) {
                $Destination = Join-Path $Candidate $File.path
                New-Item -ItemType Directory -Force (Split-Path $Destination) | Out-Null
                Copy-Item -LiteralPath (Join-Path $PSScriptRoot $File.path) -Destination $Destination
            }
            Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Destination $Candidate
            Verify $Candidate $ExpectedManifest
            Write-Host '[5/6] Compiling the Windows service host...'
            $Code = [IO.File]::ReadAllText((Join-Path $Candidate 'Service.cs')).Replace('__TASK__', $TaskName)
            Add-Type -TypeDefinition $Code -ReferencedAssemblies System.ServiceProcess.dll,System.dll -OutputAssembly (Join-Path $Candidate 'service.exe') -OutputType WindowsApplication
            Write-Json (Join-Path $Candidate 'service-owner.json') @{ sid = $Sid; taskName = $TaskName }
            Write-Host '[5/6] Service host ready. Switching installation and registering startup...'
            Stop-ScheduledTask -TaskName $TrayTask -ErrorAction SilentlyContinue
            Stop-Biuuka
            Remove-Item -LiteralPath (Join-Path $State 'app') -Recurse -Force -ErrorAction SilentlyContinue
            if ($HadOld) { Move-Item -LiteralPath $Program -Destination $Backup }
            Move-Item -LiteralPath $Candidate -Destination $Program; $Switched = $true
            Copy-Item -LiteralPath (Join-Path $Program 'install-config.json') -Destination (Join-Path $State 'config.json') -Force
            $Config = Read-Json (Join-Path $State 'config.json')
            New-Item -ItemType Directory -Force $Config.work | Out-Null
            $ActionObject = New-ScheduledTaskAction -Execute (Join-Path $Program 'service.exe') -Argument '--helper'
            $Principal = New-ScheduledTaskPrincipal -UserId $Sid -LogonType Interactive -RunLevel Limited
            $Trigger = New-ScheduledTaskTrigger -AtLogOn -User $Sid
            $Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
            Register-ScheduledTask -TaskName $TaskName -Action $ActionObject -Principal $Principal -Trigger $Trigger -Settings $Settings -Force | Out-Null
            if (!$Existing) { New-Service -Name Biuuka -DisplayName Biuuka -BinaryPathName ('"' + (Join-Path $Program 'service.exe') + '"') -StartupType Automatic | Out-Null }
            Set-Service Biuuka -StartupType Automatic; Enable-ScheduledTask $TaskName | Out-Null; Start-Service Biuuka
            Write-Host '[6/6] Waiting for localhost health check (up to 100 seconds)...'
            $Healthy = $false
            for ($i = 0; $i -lt 40; $i++) { if ($i % 5 -eq 0) { Write-Host ('Checking local service... attempt ' + ($i + 1) + '/40') }; Start-Sleep -Milliseconds 500; try { $Runtime = Read-Json (Join-Path $State 'runtime.json'); $Health = Invoke-RestMethod "http://127.0.0.1:$($Runtime.port)/health" -TimeoutSec 2; if ($Health.service -eq 'biuuka' -and $Health.version -eq $Config.version) { $Healthy = $true; break } } catch {} }
            if (!$Healthy) { throw 'Biuuka localhost health check failed.' }
            $Command = '@echo off' + "`r`n" + '"' + $Config.node + '" "' + (Join-Path $Program 'launcher.mjs') + '" %*' + "`r`nexit /b %errorlevel%`r`n"
            [IO.File]::WriteAllText((Join-Path $Program 'biuuka.cmd'), $Command, [Text.Encoding]::Default)
            $UserPath = [Environment]::GetEnvironmentVariable('Path','User')
            if (@($UserPath -split ';') -notcontains $Program) { [Environment]::SetEnvironmentVariable('Path', (([string]$UserPath).TrimEnd(';') + ';' + $Program), 'User') }
            Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class BiuukaEnvironment { [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, UIntPtr w, string l, uint f, uint t, out UIntPtr r); }'
            $Result = [UIntPtr]::Zero
            [BiuukaEnvironment]::SendMessageTimeout([IntPtr]65535, 26, [UIntPtr]::Zero, 'Environment', 2, 3000, [ref]$Result) | Out-Null
            # Retire only the known preview after the replacement is healthy.
            $Legacy = Get-CimInstance Win32_Service -Filter "Name='GPTGoCodexLocal'"
            $LegacyDir = Join-Path $env:ProgramFiles 'GPT-Go-Codex-Local'
            if ($Legacy -and $Legacy.PathName.Trim('"') -eq (Join-Path $LegacyDir 'service.exe') -and (Test-Path (Join-Path $LegacyDir 'service-owner.json'))) {
                $LegacyOwner = Read-Json (Join-Path $LegacyDir 'service-owner.json')
                if ($LegacyOwner.ownerSid -eq $Sid) {
                    try { Stop-Service GPTGoCodexLocal; Set-Service GPTGoCodexLocal -StartupType Disabled; Disable-ScheduledTask $LegacyOwner.taskName | Out-Null }
                    catch { Write-Host 'Biuuka is healthy, but the previous GPTGoCodexLocal service could not be retired automatically.' }
                }
            }
            $TrayAction = New-ScheduledTaskAction -Execute (Join-Path $Program 'service.exe') -Argument '--tray'
            $TraySettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
            Register-ScheduledTask -TaskName $TrayTask -Action $TrayAction -Principal $Principal -Trigger $Trigger -Settings $TraySettings -Force | Out-Null
            Start-ScheduledTask $TrayTask
            if (Test-Path $Backup) { Remove-Item -LiteralPath $Backup -Recurse -Force }
            Write-Host 'Biuuka service installed; localhost health verified.'
        } catch {
            Stop-ScheduledTask -TaskName $TrayTask -ErrorAction SilentlyContinue
            Stop-Biuuka
            if ($Switched) { Remove-Item -LiteralPath $Program -Recurse -Force }
            if (Test-Path $Backup) { Move-Item -LiteralPath $Backup -Destination $Program; if ($OldConfig) { [IO.File]::WriteAllText((Join-Path $State 'config.json'), $OldConfig, $Utf8) }; Start-Service Biuuka }
            elseif ($HadOld -and (Test-Path $Program)) { Start-Service Biuuka }
            elseif (!$HadOld) {
                Unregister-ScheduledTask $TaskName -Confirm:$false -ErrorAction SilentlyContinue
                & sc.exe delete Biuuka 2>$null | Out-Null
                Remove-Item -LiteralPath (Join-Path $State 'config.json') -Force -ErrorAction SilentlyContinue
            }
            throw
        } finally { if (Test-Path $Candidate) { Remove-Item -LiteralPath $Candidate -Recurse -Force } }
    } elseif ($Action -in @('start','restart','install-service')) {
        if (!$Existing) { throw 'Install Biuuka first.' }; if ($Action -eq 'restart') { Stop-Biuuka }
        Enable-ScheduledTask $TaskName | Out-Null; Set-Service Biuuka -StartupType Automatic
        if ((Get-Service Biuuka).Status -ne 'Running') { Start-Service Biuuka } else { Start-ScheduledTask $TaskName }
    } elseif ($Action -eq 'uninstall') {
        $Cleaner = Join-Path $PSScriptRoot 'uninstall-windows.ps1'
        & $Shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $Cleaner -ValidateOnly
        if ($LASTEXITCODE -ne 0) { throw 'Cleanup safety check failed; no files removed.' }
        $CleanupFile = Join-Path $env:TEMP ('biuuka-cleanup-' + [guid]::NewGuid().ToString('N') + '.ps1')
        $CleanupConfig = Read-Json (Join-Path $State 'config.json')
        $CleanupContext = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((@{sid=$Sid;codexHome=$CleanupConfig.codexHome} | ConvertTo-Json -Compress)))
        $CleanupText = [IO.File]::ReadAllText($Cleaner).Replace('__BIUUKA_CLEANUP_CONTEXT__',$CleanupContext)
        [IO.File]::WriteAllText($CleanupFile,$CleanupText,(New-Object Text.UTF8Encoding($true)))
        $CleanupArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $CleanupFile + '"'
        # An independent task avoids the service's process-tree shutdown killing its own cleaner.
        $CleanupTask = 'Biuuka-Cleanup-' + $Sid + '-' + [guid]::NewGuid().ToString('N')
        $CleanupAction = New-ScheduledTaskAction -Execute $Shell -Argument ($CleanupArgs + ' -CleanupTask ' + $CleanupTask)
        $CleanupPrincipal = New-ScheduledTaskPrincipal -UserId $Sid -LogonType Interactive -RunLevel Highest
        Register-ScheduledTask -TaskName $CleanupTask -Action $CleanupAction -Principal $CleanupPrincipal -Force | Out-Null
        try { Start-ScheduledTask -TaskName $CleanupTask } catch { Unregister-ScheduledTask -TaskName $CleanupTask -Confirm:$false; throw }
        Write-Host 'Full cleanup started. Biuuka tray, service, programs and local data will be removed; Codex data is excluded.'
    } elseif ($Action -eq 'stop') {
        Stop-Biuuka; Disable-ScheduledTask $TaskName | Out-Null; Set-Service Biuuka -StartupType Manual
    }
    exit 0
} catch {
    Write-Host ('Biuuka: ' + $_.Exception.Message) -ForegroundColor Red
    if ($Elevated) { Read-Host 'Press Enter to close' | Out-Null }
    exit 1
}
