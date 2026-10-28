param([ValidateSet('inspect','stop','start')][string]$Action,[string]$Descriptor)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$session=(Get-Process -Id $PID).SessionId
function Matches($exe) {
 @(Get-CimInstance Win32_Process | Where-Object { $_.SessionId -eq $session -and $_.ExecutablePath -and $_.ExecutablePath.Equals($exe,[StringComparison]::OrdinalIgnoreCase) })
}
function ValidateExe($exe) {
 if(-not [IO.Path]::IsPathRooted($exe) -or [IO.Path]::GetFileName($exe) -notin @('ChatGPT.exe','Codex.exe')){throw 'desktop_identity_unconfirmed'}
 $sig=Get-AuthenticodeSignature -LiteralPath $exe
 if($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch '(?i)\bOpenAI\b'){throw 'desktop_identity_unconfirmed'}
}
# Codex's Windows GUI is ChatGPT.exe; codex.exe is its CLI/app-server.
# Never count the bundled or Biuuka-owned app-server as another desktop.
function Test-CodexGui($exe) {
 if(-not $exe -or [IO.Path]::GetFileName($exe) -ine 'ChatGPT.exe'){return $false}
 $dir=[IO.Path]::GetDirectoryName($exe)
 # A ChatGPT chat-only installation does not own the .codex login.
 return (Test-Path -LiteralPath (Join-Path $dir 'resources/codex.exe') -PathType Leaf)
}
# Split Windows arguments before inspecting switches. Crashpad embeds switches
# in --monitor-self-argument=...; those are data, not this process's options.
function Split-DesktopArguments([string]$CommandLine) {
 $parts=New-Object 'System.Collections.Generic.List[string]'
 $word=New-Object Text.StringBuilder
 $quoted=$false;$started=$false;$i=0
 while($i -lt $CommandLine.Length){
  $c=$CommandLine[$i]
  if(($c -eq ' ' -or $c -eq "`t") -and -not $quoted){
   if($started){$parts.Add($word.ToString());$null=$word.Clear();$started=$false}
   $i++;continue
  }
  $started=$true
  if($c -eq '\'){
   $slashes=0
   while($i -lt $CommandLine.Length -and $CommandLine[$i] -eq '\'){$slashes++;$i++}
   if($i -lt $CommandLine.Length -and $CommandLine[$i] -eq '"'){
    $null=$word.Append(('\' * [int][Math]::Floor($slashes/2)))
    if($slashes % 2){$null=$word.Append('"');$i++;continue}
   }else{$null=$word.Append(('\' * $slashes));continue}
  }
  if($CommandLine[$i] -eq '"'){
   if($quoted -and $i+1 -lt $CommandLine.Length -and $CommandLine[$i+1] -eq '"'){$null=$word.Append('"');$i+=2;continue}
   $quoted=-not $quoted;$i++;continue
  }
  $null=$word.Append($CommandLine[$i]);$i++
 }
 if($quoted){throw 'desktop_identity_unconfirmed'}
 if($started){$parts.Add($word.ToString())}
 return $parts.ToArray()
}
function Assert-DefaultProfile([string]$CommandLine) {
 if(-not $CommandLine){throw 'desktop_identity_unconfirmed'}
 $arguments=@(Split-DesktopArguments $CommandLine);$directories=@()
 for($index=1;$index -lt $arguments.Count;$index++){
  $argument=$arguments[$index]
  if($argument -match '^--(?:profile-directory|codex-home)(?:=|$)'){throw 'desktop_identity_unconfirmed'}
  if($argument -ieq '--user-data-dir'){
   $index++
   if($index -ge $arguments.Count -or $arguments[$index].StartsWith('--')){throw 'desktop_identity_unconfirmed'}
   $directories+= $arguments[$index]
  }elseif($argument -match '^--user-data-dir=(.*)$'){$directories+= $Matches[1]}
 }
 if($directories.Count){
  if($directories.Count -ne 1 -or -not $directories[0] -or -not $env:APPDATA){throw 'desktop_identity_unconfirmed'}
  $value=$directories[0].Replace('/','\').TrimEnd('\')
  $base=$env:APPDATA.Replace('/','\').TrimEnd('\')+'\Codex'
  if($value -ine $base -and $value -ine ($base+'\web\Codex')){throw 'desktop_identity_unconfirmed'}
 }
}
function Select-CodexDesktop($Processes,$Installed,$SessionId) {
 $paths=@($Processes | Where-Object { $_.SessionId -eq $SessionId -and $_.Name -ieq 'ChatGPT.exe' -and $_.CommandLine -notmatch '(?i)--type(?:=|\s)' } | ForEach-Object {
  if(-not $_.ExecutablePath -or -not $_.CommandLine){throw 'desktop_identity_unconfirmed'}
  if(Test-CodexGui $_.ExecutablePath){
   Assert-DefaultProfile $_.CommandLine
   $_.ExecutablePath
  }
 } | Sort-Object -Unique)
 if($paths.Count -gt 1){throw 'desktop_ambiguous'}
 if($paths.Count -eq 1){return @{exe=$paths[0];running=$true}}
 $paths=@($Installed | Where-Object {Test-CodexGui $_} | Sort-Object -Unique)
 if($paths.Count -gt 1){throw 'desktop_ambiguous'}
 if($paths.Count -eq 1){return @{exe=$paths[0];running=$false}}
 return $null
}
# Capture ownership while parent links still exist. Only the target GUI and
# its bundled Codex runtime may be terminated; arbitrary spawned apps are excluded.
function Select-DesktopOwned($Tree,[string]$Exe,[int]$SessionId,$Previous=@()) {
 $treeInSession=@($Tree | Where-Object {$_.SessionId -eq $SessionId})
 $roots=@($treeInSession | Where-Object {$_.ExecutablePath -and $_.ExecutablePath -ieq $Exe})
 foreach($item in $roots){Assert-DefaultProfile $item.CommandLine}
 if($PSBoundParameters.ContainsKey('Previous')){
  $roots=@($treeInSession | Where-Object {$candidate=$_; @($Previous | Where-Object {$_.ProcessId -eq $candidate.ProcessId -and $_.CreationDate -eq $candidate.CreationDate -and $_.ExecutablePath -ieq $candidate.ExecutablePath}).Count})
 }
 $descendants=@($roots)
 do{
  $extra=@($treeInSession | Where-Object {$_.ParentProcessId -in @($descendants.ProcessId) -and $_.ProcessId -notin @($descendants.ProcessId)})
  $descendants+=$extra
 }while($extra.Count)
 $runtime=Join-Path ([IO.Path]::GetDirectoryName($Exe)) 'resources/codex.exe'
 $targets=@($descendants | Where-Object {$_.ExecutablePath -ieq $Exe -or $_.ExecutablePath -ieq $runtime})
 foreach($item in $descendants){if($item.Name -in @('ChatGPT.exe','codex.exe') -and -not $item.ExecutablePath){throw 'desktop_identity_unconfirmed'}}
 foreach($item in $targets){
  if(-not $item.CreationDate){throw 'desktop_identity_unconfirmed'}
  if($item.ExecutablePath -ieq $Exe){Assert-DefaultProfile $item.CommandLine}
 }
 return $targets
}
function Get-DesktopRemaining($Owned,$Snapshot) {
 @($Owned | Where-Object {$original=$_; @($Snapshot | Where-Object {$_.ProcessId -eq $original.ProcessId -and $_.CreationDate -eq $original.CreationDate -and $_.SessionId -eq $original.SessionId}).Count})
}
function Invoke-DesktopExit($Item,[bool]$Force) {
 $process=Get-Process -Id $Item.ProcessId -ErrorAction SilentlyContinue
 if(-not $process){return}
 try{
  # Pin a native handle before checking identity so a recycled PID cannot be killed.
  $null=$process.Handle
  $actual=$process.StartTime.ToUniversalTime().Ticks
  $expected=([datetime]$Item.CreationDate).ToUniversalTime().Ticks
  if(($actual-($actual % 10000)) -ne ($expected-($expected % 10000)) -or $process.SessionId -ne $Item.SessionId -or $process.MainModule.FileName -ine $Item.ExecutablePath){return}
  if($Force){$process.Kill()}elseif($process.MainWindowHandle -ne 0){$null=$process.CloseMainWindow()}
 }catch{if(-not $process.HasExited){throw 'desktop_stop_failed'}}finally{$process.Dispose()}
}
function Stop-DesktopRuntime([string]$Exe,[int]$SessionId,[int]$GraceMs=5000,[int]$TimeoutMs=20000) {
 $watch=[Diagnostics.Stopwatch]::StartNew()
 $snapshot=@(Get-CimInstance Win32_Process)
 $owned=@(Select-DesktopOwned $snapshot $Exe $SessionId)
 foreach($item in $owned){Invoke-DesktopExit $item $false}
 while($true){
  $snapshot=@(Get-CimInstance Win32_Process)
  # Include children created during graceful shutdown, but not unrelated new roots.
  $extra=@(Select-DesktopOwned $snapshot $Exe $SessionId $owned | Where-Object {$candidate=$_; -not @($owned | Where-Object {$_.ProcessId -eq $candidate.ProcessId -and $_.CreationDate -eq $candidate.CreationDate}).Count})
  $owned+=$extra
  $remaining=@(Get-DesktopRemaining $owned $snapshot)
  $guiRemaining=@($snapshot | Where-Object {$_.SessionId -eq $SessionId -and $_.ExecutablePath -ieq $Exe})
  $runtime=Join-Path ([IO.Path]::GetDirectoryName($Exe)) 'resources/codex.exe'
  $runtimeRemaining=@($snapshot | Where-Object {$_.SessionId -eq $SessionId -and $_.ExecutablePath -ieq $runtime})
  if(-not $remaining.Count -and -not $guiRemaining.Count -and -not $runtimeRemaining.Count){return}
  if($watch.ElapsedMilliseconds -ge $TimeoutMs){throw 'desktop_stop_failed'}
  if($watch.ElapsedMilliseconds -ge $GraceMs){
   # Kill only pinned, revalidated identities. No taskkill /IM or recursive /T.
   foreach($item in $remaining){Invoke-DesktopExit $item $true}
  }
  Start-Sleep -Milliseconds 250
 }
}
# Resolve the actual manifest Application Id; never guess !App or fall back to
# a second activation after dispatch. Only the current user's registration counts.
function Find-DesktopPackage([string]$Exe,$Packages) {
 $found=@()
 foreach($package in $Packages){
  if(-not $package.InstallLocation){continue}
  $root=[IO.Path]::GetFullPath($package.InstallLocation).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
  if(-not $Exe.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){continue}
  $manifest=Get-AppxPackageManifest -Package $package -ErrorAction Stop
  foreach($app in $manifest.Package.Applications.Application){
   if(-not $app.Executable -or [IO.Path]::IsPathRooted($app.Executable)){continue}
   $candidate=[IO.Path]::GetFullPath((Join-Path $root $app.Executable))
   if($candidate.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -and $candidate -ieq $Exe -and $app.Id -and $package.PackageFamilyName){
    $found+=([string]$package.PackageFamilyName+'!'+[string]$app.Id)
   }
  }
 }
 if($found.Count -gt 1){throw 'desktop_ambiguous'}
 if($found.Count -eq 1){return $found[0]}
 if($Exe -match '(?i)[\\/]WindowsApps[\\/]'){throw 'desktop_identity_unconfirmed'}
 return $null
}
function Invoke-DesktopLaunch([string]$Exe,[string]$AppId) {
 if($AppId){
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("2e941141-7f97-4756-ba1d-9decde894a3d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IBiuukaActivationManager {
 [PreserveSig] int ActivateApplication([MarshalAs(UnmanagedType.LPWStr)] string id, [MarshalAs(UnmanagedType.LPWStr)] string arguments, uint options, out uint processId);
}
public static class BiuukaActivation {
 public static uint Start(string id) {
  object manager=Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")));
  try { uint pid; int result=((IBiuukaActivationManager)manager).ActivateApplication(id,null,2,out pid); Marshal.ThrowExceptionForHR(result); return pid; }
  finally { Marshal.FinalReleaseComObject(manager); }
 }
}
'@
  $null=[BiuukaActivation]::Start($AppId)
 }else{
  $launched=Start-Process -FilePath $Exe -PassThru
  if($launched){$launched.Dispose()}
 }
}
function Select-DesktopStarted($Snapshot,[string]$Exe,[int]$SessionId,$Before,[datetime]$NotBefore) {
 @($Snapshot | Where-Object {
  $candidate=$_
  if($_.SessionId -ne $SessionId -or $_.ExecutablePath -ine $Exe -or -not $_.CreationDate -or $_.CreationDate -lt $NotBefore){return $false}
  if(@($Before | Where-Object {$_.ProcessId -eq $candidate.ProcessId -and $_.CreationDate -eq $candidate.CreationDate}).Count){return $false}
  Assert-DefaultProfile $_.CommandLine
  $arguments=@(Split-DesktopArguments $_.CommandLine)
  return -not @($arguments | Select-Object -Skip 1 | Where-Object {$_ -match '^--type(?:=|$)'}).Count
 })
}
function Start-DesktopRuntime([string]$Exe,[int]$SessionId,[int]$TimeoutMs=15000) {
 $before=@(Get-CimInstance Win32_Process)
 # A residual GUI is not a successful restart. Leave it alone and report failure.
 if(@($before | Where-Object {$_.SessionId -eq $SessionId -and $_.ExecutablePath -ieq $Exe}).Count){throw 'desktop_start_failed'}
 $appId=Find-DesktopPackage $Exe @(Get-AppxPackage -ErrorAction Stop)
 $notBefore=[DateTime]::UtcNow.AddSeconds(-1)
 $watch=[Diagnostics.Stopwatch]::StartNew();$stable=$null;$stableSince=0
 Invoke-DesktopLaunch $Exe $appId
 while($watch.ElapsedMilliseconds -lt $TimeoutMs){
  $candidates=@(Select-DesktopStarted @(Get-CimInstance Win32_Process) $Exe $SessionId $before $notBefore)
  if($candidates.Count -gt 1){throw 'desktop_ambiguous'}
  if($candidates.Count -eq 1){
   $candidate=$candidates[0]
   if($stable -and $stable.ProcessId -eq $candidate.ProcessId -and $stable.CreationDate -eq $candidate.CreationDate){
    if($watch.ElapsedMilliseconds-$stableSince -ge 1000){return}
   }else{$stable=$candidate;$stableSince=$watch.ElapsedMilliseconds}
  }else{$stable=$null}
  Start-Sleep -Milliseconds 250
 }
 throw 'desktop_start_failed'
}
if($Action -eq 'inspect') {
 $processes=@(Get-CimInstance Win32_Process)
 # Prefer the running GUI. Only enumerate installed packages when none is running.
 $selected=Select-CodexDesktop $processes @() $session
 if(-not $selected){
  $installed=@(Get-AppxPackage | Where-Object { $_.Name -match '^OpenAI\.(ChatGPT|ChatGPT-Desktop|Codex)$' } | ForEach-Object {
   $dir=$_.InstallLocation;$manifest=Get-AppxPackageManifest $_
   foreach($app in $manifest.Package.Applications.Application){
    if($app.Executable -match '(?i)(^|[\\/])ChatGPT\.exe$'){Join-Path $dir $app.Executable}
   }
  })
  $selected=Select-CodexDesktop $processes $installed $session
 }
 if(-not $selected){'null';exit}
 ValidateExe $selected.exe
 $selected | ConvertTo-Json -Compress;exit
}
$d=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($Descriptor)) | ConvertFrom-Json
$exe=$d.exe;ValidateExe $exe
if(-not (Test-CodexGui $exe)){throw 'desktop_identity_unconfirmed'}
if($Action -eq 'stop') {
 Stop-DesktopRuntime $exe $session
} else {
 Start-DesktopRuntime $exe $session
}
'{}'
