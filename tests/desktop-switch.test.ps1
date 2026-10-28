$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../chatgpt/desktop-switch.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors | Out-String)}
# Execute the production selection functions with isolated files and process snapshots.
foreach($fn in $ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst]},$true)){Invoke-Expression $fn.Extent.Text}
$root=Join-Path ([IO.Path]::GetTempPath()) ('biuuka-desktop-'+[guid]::NewGuid().ToString('N'))
$prior=$env:APPDATA;$count=0
function Proc($exe,$name='ChatGPT.exe',$Arguments='',$sid=1){[pscustomobject]@{Name=$name;ExecutablePath=$exe;CommandLine=('"'+$exe+'" '+$Arguments);SessionId=$sid}}
function Reject($work,$code){try{& $work}catch{if($_.Exception.Message -eq $code){return};throw};throw 'Expected rejection'}
try{
 $gui=Join-Path $root 'desktop/ChatGPT.exe';$other=Join-Path $root 'other/ChatGPT.exe';$chat=Join-Path $root 'chat/ChatGPT.exe'
 foreach($dir in @('desktop/resources','other/resources','chat')){New-Item -ItemType Directory -Path (Join-Path $root $dir) -Force | Out-Null}
 foreach($file in @($gui,$other,$chat,(Join-Path $root 'desktop/resources/codex.exe'),(Join-Path $root 'other/resources/codex.exe'))){[IO.File]::WriteAllText($file,'fixture')}
 $cli=Join-Path $root 'desktop/resources/codex.exe';$biuuka=Join-Path $root 'biuuka/codex.exe'
 $background=@((Proc $cli 'codex.exe' 'app-server'),(Proc $biuuka 'codex.exe' 'app-server'))
 $selected=Select-CodexDesktop (@((Proc $gui),(Proc $gui 'ChatGPT.exe' '--type=renderer'))+$background) @() 1
 if($selected.exe -ne $gui -or !$selected.running){throw 'GUI plus app-servers misidentified'};$count++
 $selected=Select-CodexDesktop $background @($gui,$cli,$chat) 1
 if($selected.exe -ne $gui -or $selected.running){throw 'Installed GUI fallback failed'};$count++
 if($null -ne (Select-CodexDesktop $background @($cli,$chat) 1)){throw 'CLI or chat-only app selected'};$count++
 $selected=Select-CodexDesktop @((Proc $gui),(Proc $chat),(Proc $other 'ChatGPT.exe' '' 2)) @($other) 1
 if($selected.exe -ne $gui){throw 'Other chat app/session/installed package caused ambiguity'};$count++
 Reject {Select-CodexDesktop @((Proc $gui),(Proc $other)) @() 1} 'desktop_ambiguous';$count++
 Reject {Select-CodexDesktop @() @($gui,$other) 1} 'desktop_ambiguous';$count++
 Reject {Select-CodexDesktop @((Proc $gui 'ChatGPT.exe' '--user-data-dir="C:\custom"')) @() 1} 'desktop_identity_unconfirmed';$count++
 $unreadable=Proc $gui;$unreadable.CommandLine=$null
 Reject {Select-CodexDesktop @($unreadable) @() 1} 'desktop_identity_unconfirmed';$count++
 $env:APPDATA='C:\Users\fixture\AppData\Roaming'
 foreach($suffix in @('Codex','Codex\web\Codex')){Assert-DefaultProfile ('"gui" --type=renderer --user-data-dir="'+$env:APPDATA+'\'+$suffix+'"');$count++}
 foreach($Arguments in @('--user-data-dir', '--user-data-dir="C:\Users\fixture\AppData\Roaming\Codex" --user-data-dir','--user-data-dir="C:\custom"','--codex-home="C:\custom"','--profile-directory=custom','--user-data-dir="C:\Users\fixture\AppData\Roaming\Codex" --user-data-dir="C:\custom"')){Reject {Assert-DefaultProfile ('"gui" '+$Arguments)} 'desktop_identity_unconfirmed';$count++}

 # Regression: Crashpad repeats the switch as a monitor-self argument. Only
 # the direct option selects this process's user-data directory.
 $default=$env:APPDATA+'\Codex\web\Codex'
 foreach($line in @(
  ('"gui" --type=crashpad-handler --monitor-self-argument=--user-data-dir='+$default+' --user-data-dir='+$default),
  ('"gui" --type=crashpad-handler --monitor-self-argument="--user-data-dir='+$default+'" --user-data-dir="'+$default+'"'),
  ('"gui" --type=crashpad-handler "--monitor-self-argument=--user-data-dir='+$default+'" "--user-data-dir='+$default+'"'),
  ('"gui" --type=crashpad-handler --monitor-self-argument=--user-data-dir=C:\other --user-data-dir='+$default),
  ('"gui" --type=renderer --user-data-dir "'+$default+'"'),
  ('"gui" --type=crashpad-handler --monitor-self-argument=--user-data-dir='+$default)
 )){Assert-DefaultProfile $line;$count++}
 foreach($line in @(
  ('"gui" --monitor-self-argument=--user-data-dir='+$default+' --user-data-dir=C:\other'),
  ('"gui" "--user-data-dir='+$default+'" "--user-data-dir='+$default+'"'),
  ('"gui" --user-data-dir="'+$default+'" --user-data-dir='),
  ('"gui" "--codex-home=C:\other"'),
  ('"gui" --user-data-dir="'+$default)
 )){Reject {Assert-DefaultProfile $line} 'desktop_identity_unconfirmed';$count++}
 $env:APPDATA='C:\Users\fixture space\AppData\Roaming';$default=$env:APPDATA+'\Codex\web\Codex'
 Assert-DefaultProfile ('"C:\Program Files\gui.exe" "--monitor-self-argument=--user-data-dir='+$default+'" --user-data-dir="'+$default+'"');$count++
 $parsed=@(Split-DesktopArguments '"C:\Program Files\gui.exe" --note="some \"quoted\" text" "" "C:\trailing\\"')
 if($parsed.Count -ne 4 -or $parsed[0] -ne 'C:\Program Files\gui.exe' -or $parsed[1] -ne '--note=some "quoted" text' -or $parsed[2] -ne '' -or $parsed[3] -ne 'C:\trailing\'){throw 'Windows argument quoting changed'};$count++

 function Entry($Id,$Parent,$Exe,$Session=1,$Created='2026-01-01T00:00:00Z',$Arguments=''){
  [pscustomobject]@{ProcessId=$Id;ParentProcessId=$Parent;ExecutablePath=$Exe;SessionId=$Session;CreationDate=[datetime]$Created;Name=[IO.Path]::GetFileName($Exe);CommandLine=('"'+$Exe+'" '+$Arguments)}
 }
 $main=Entry 100 1 $gui
 $helper=Entry 101 100 $gui 1 '2026-01-01T00:00:01Z' '--type=crashpad-handler'
 $server=Entry 102 100 $cli 1 '2026-01-01T00:00:02Z' 'app-server'
 $unrelated=Entry 103 100 (Join-Path $root 'browser.exe')
 $outside=Entry 104 1 $cli
 $otherSession=Entry 105 100 $gui 2
 $snapshot=@($main,$helper,$server,$unrelated,$outside,$otherSession)
 $owned=@(Select-DesktopOwned $snapshot $gui 1)
 if(($owned.ProcessId -join ',') -ne '100,101,102'){throw 'Termination scope includes unrelated process'};$count++
 $reused=Entry 100 1 $gui 1 '2026-01-01T00:01:00Z'
 if(@(Get-DesktopRemaining $owned @($reused)).Count){throw 'Reused PID considered owned'};$count++
 $late=Entry 106 101 $cli 1 '2026-01-01T00:00:03Z' 'app-server'
 $expanded=@(Select-DesktopOwned @($helper,$server,$late) $gui 1 $owned)
 if($late.ProcessId -notin $expanded.ProcessId){throw 'Late owned child not captured'};$count++
 if(@(Select-DesktopOwned @($reused) $gui 1 $owned).Count){throw 'New unrelated GUI root adopted'};$count++
 if(@(Select-DesktopOwned @($main) $gui 1 @()).Count){throw 'Empty captured set adopted later root'};$count++
 $custom=Entry 107 1 $gui 1 '2026-01-01T00:00:00Z' '--user-data-dir=C:\custom'
 Reject {Select-DesktopOwned @($main,$custom) $gui 1} 'desktop_identity_unconfirmed';$count++

 # Temporary loss of executable visibility must not masquerade as exit.
 $hidden=Entry 100 1 $gui;$hidden.ExecutablePath=$null
 if(@(Get-DesktopRemaining @($main) @($hidden)).Count -ne 1){throw 'Unreadable process treated as exited'};$count++
 # Registration uses the manifest ID of the exact executable, not a guessed alias.
 function Get-AppxPackageManifest {param($Package,$ErrorAction) $script:manifestFixture}
 $script:manifestFixture=[pscustomobject]@{Package=[pscustomobject]@{Applications=[pscustomobject]@{Application=@([pscustomobject]@{Executable='ChatGPT.exe';Id='ActualDesktop'})}}}
 $package=[pscustomobject]@{InstallLocation=[IO.Path]::GetDirectoryName($gui);PackageFamilyName='OpenAI.Codex_fixture'}
 if((Find-DesktopPackage $gui @($package)) -ne 'OpenAI.Codex_fixture!ActualDesktop'){throw 'Manifest activation ID lost'};$count++
 if($null -ne (Find-DesktopPackage $other @($package))){throw 'Unrelated package selected'};$count++
 Reject {Find-DesktopPackage $gui @($package,$package)} 'desktop_ambiguous';$count++
 Reject {Find-DesktopPackage 'C:\Program Files\WindowsApps\missing\ChatGPT.exe' @()} 'desktop_identity_unconfirmed';$count++
 Remove-Item Function:Get-AppxPackageManifest
 $now=[datetime]::UtcNow;$started=Entry 200 1 $gui 1 $now
 $startedHelper=Entry 201 200 $gui 1 $now '--type=renderer'
 if(@(Select-DesktopStarted @($main,$startedHelper) $gui 1 @($main) $now.AddSeconds(-1)).Count){throw 'Old root/helper considered new launch'};$count++
 if(@(Select-DesktopStarted @($started) $gui 1 @($main) $now.AddSeconds(-1)).Count -ne 1){throw 'New default root not confirmed'};$count++
 $started.CommandLine+=' --user-data-dir=C:\custom'
 Reject {Select-DesktopStarted @($started) $gui 1 @() $now.AddSeconds(-1)} 'desktop_identity_unconfirmed';$count++
 $started.CommandLine='"'+$gui+'"'
 # Exercise dispatch once and stable-main confirmation without launching a GUI.
 function Get-AppxPackage {param($ErrorAction) @()}
 function Start-Sleep {param($Milliseconds)}
 $script:launchCount=0;$script:live=@()
 function Get-CimInstance {param($ClassName) $script:live}
 function Invoke-DesktopLaunch {param($Exe,$AppId) $script:launchCount++;$script:live=@($started)}
 Start-DesktopRuntime $gui 1 2000
 if($script:launchCount -ne 1){throw 'Launch dispatched more than once'};$count++
 Reject {Start-DesktopRuntime $gui 1 20} 'desktop_start_failed'
 if($script:launchCount -ne 1){throw 'Residual GUI caused duplicate launch'};$count++
 $script:live=@()
 function Invoke-DesktopLaunch {param($Exe,$AppId) $script:launchCount++;$script:live=@($startedHelper)}
 Reject {Start-DesktopRuntime $gui 1 20} 'desktop_start_failed'
 if($script:launchCount -ne 2){throw 'Uncertain launch retried'};$count++
 Remove-Item Function:Get-AppxPackage,Function:Start-Sleep,Function:Get-CimInstance,Function:Invoke-DesktopLaunch
 # Run the actual stop loop against snapshots, without controlling real processes.
 $script:live=@($main,$helper,$server,$unrelated,$otherSession)
 $script:events=New-Object 'System.Collections.Generic.List[string]'
 function Get-CimInstance {param($ClassName) $script:live}
 function Start-Sleep {param($Milliseconds)}
 function Invoke-DesktopExit($Item,[bool]$Force){
  $script:events.Add(([string]$Force)+':'+$Item.ProcessId)
  if($Force){$script:live=@($script:live | Where-Object {$_.ProcessId -ne $Item.ProcessId})}
 }
 Stop-DesktopRuntime $gui 1 0 500
 if(($script:events -join ',') -ne 'False:100,False:101,False:102,True:100,True:101,True:102'){throw 'Graceful/force ordering failed'}
 if(($script:live.ProcessId -join ',') -ne '103,105'){throw 'Unrelated processes changed'};$count++
 $script:live=@($main,$helper,$server);$script:events.Clear()
 function Invoke-DesktopExit($Item,[bool]$Force){
  if($Force){throw 'Force used after successful graceful shutdown'}
  $script:events.Add('graceful');$script:live=@()
 }
 Stop-DesktopRuntime $gui 1 0 500;$count++
 $script:live=@($main,$helper,$server)
 function Invoke-DesktopExit($Item,[bool]$Force){}
 Reject {Stop-DesktopRuntime $gui 1 0 20} 'desktop_stop_failed';$count++
 # An unowned orphan using the same bundled runtime blocks the auth write but
 # must never be killed merely because its executable matches.
 $script:live=@($outside)
 function Invoke-DesktopExit($Item,[bool]$Force){throw 'Unowned process was targeted'}
 Reject {Stop-DesktopRuntime $gui 1 0 20} 'desktop_stop_failed';$count++
 Remove-Item Function:Get-CimInstance,Function:Start-Sleep,Function:Invoke-DesktopExit
 # Test the production native-handle guard with a fake Process object.
 $fn=$ast.FindAll({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Invoke-DesktopExit'},$true)[0]
 Invoke-Expression $fn.Extent.Text
 $script:killCount=0;$script:disposeCount=0
 $script:processFixture=[pscustomobject]@{Handle=1;StartTime=$main.CreationDate;SessionId=1;MainModule=[pscustomobject]@{FileName=$gui};MainWindowHandle=0;HasExited=$false}
 $script:processFixture | Add-Member ScriptMethod Kill {$script:killCount++}
 $script:processFixture | Add-Member ScriptMethod Dispose {$script:disposeCount++}
 function Get-Process {param($Id,$ErrorAction) $script:processFixture}
 Invoke-DesktopExit $main $true
 if($script:killCount -ne 1 -or $script:disposeCount -ne 1){throw 'Native action was not disposed'};$count++
 $script:processFixture.StartTime=$reused.CreationDate
 Invoke-DesktopExit $main $true
 if($script:killCount -ne 1){throw 'Recycled PID terminated'};$count++
 $script:processFixture.StartTime=$main.CreationDate;$script:processFixture.MainModule.FileName=$other
 Invoke-DesktopExit $main $true
 if($script:killCount -ne 1){throw 'Changed executable terminated'};$count++
 Remove-Item Function:Get-Process
}finally{$env:APPDATA=$prior;Remove-Item -LiteralPath $root -Recurse -Force}
Write-Host "$count desktop selection and profile checks passed (isolated fixtures, no real processes controlled)."
