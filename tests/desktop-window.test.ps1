$ErrorActionPreference='Stop'
Add-Type -Path (Join-Path $PSScriptRoot '../chatgpt/desktop-window.cs')
if($env:OS -ne 'Windows_NT'){Write-Host 'Desktop native helper compiled; Win32 execution requires Windows.';return}
Add-Type -AssemblyName System.Windows.Forms
$form=New-Object Windows.Forms.Form
$form.Text='Biuuka isolated window fixture'
try {
 $form.Show();[Windows.Forms.Application]::DoEvents()
 if([BiuukaDesktopWindow]::Present(0,$form.Handle) -ne 'pending'){throw 'Foreign window accepted'}
 if([BiuukaDesktopWindow]::Find([uint32]$PID) -eq [IntPtr]::Zero){throw 'Fixture window not discovered'}
 $form.WindowState=[Windows.Forms.FormWindowState]::Minimized
 [Windows.Forms.Application]::DoEvents()
 $result='pending';$watch=[Diagnostics.Stopwatch]::StartNew()
 while($watch.ElapsedMilliseconds -lt 2000){$result=[BiuukaDesktopWindow]::Present([uint32]$PID,$form.Handle);[Windows.Forms.Application]::DoEvents();if($result -ne 'pending'){break};Start-Sleep -Milliseconds 20}
 if($result -notin @('foreground','background') -or !$form.Visible -or $form.WindowState -eq 'Minimized'){throw 'Own minimized fixture not restored'}
 Write-Host ('Native window discovery/ownership/restoration passed; activation='+$result)
}finally{$form.Close();$form.Dispose()}
$scriptFile=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../chatgpt/desktop-switch.ps1'))
$process=New-Object Diagnostics.Process
$process.StartInfo=New-Object Diagnostics.ProcessStartInfo
$process.StartInfo.FileName=Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$process.StartInfo.Arguments='-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$scriptFile+'" -Action session'
$process.StartInfo.UseShellExecute=$false;$process.StartInfo.CreateNoWindow=$true
$process.StartInfo.RedirectStandardInput=$true;$process.StartInfo.RedirectStandardOutput=$true;$process.StartInfo.RedirectStandardError=$true
try {
 $null=$process.Start();$output=$process.StandardOutput.ReadToEndAsync();$diagnostics=$process.StandardError.ReadToEndAsync()
 $process.StandardInput.WriteLine('{"id":1,"action":"arbitrary"}')
 $process.StandardInput.WriteLine('{"id":2,"action":"stop","descriptor":{"exe":"not-a-client.exe"}}')
 $process.StandardInput.Close()
 if(!$process.WaitForExit(20000)){throw 'Native controller did not exit on EOF'}
 if($process.ExitCode -ne 0){throw 'Native controller failed'}
 $responses=@($output.Result.Trim() -split "`n" | ForEach-Object {$_ | ConvertFrom-Json})
 if($responses.Count -ne 2 -or $responses[0].id -ne 1 -or $responses[1].id -ne 2 -or $responses[1].error -ne 'desktop_identity_unconfirmed'){throw 'Persistent protocol failed'}
 Write-Host 'Persistent PowerShell protocol, fixed action restrictions and EOF cleanup passed.'
}finally{if(!$process.HasExited){$process.Kill();$process.WaitForExit()};$process.Dispose()}
