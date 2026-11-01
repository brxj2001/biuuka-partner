$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$session=(Get-Process -Id $PID).SessionId
$partial=$false
$rows=@(Get-CimInstance Win32_Process -Filter ("SessionId = " + $session) -Property ProcessId,ParentProcessId,Name,ExecutablePath | ForEach-Object {
 $p=$_;$kind=$null
 if($p.Name -match '^(ChatGPT|Codex|codex-[a-z0-9_-]+)\.exe$') {
  $owner=Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid
  if($owner.ReturnValue -ne 0){$partial=$true}
  elseif($owner.Sid -eq $sid){
   if(-not $p.ExecutablePath){$partial=$true}
   elseif($p.Name -ieq 'ChatGPT.exe'){
    if(Test-Path -LiteralPath (Join-Path ([IO.Path]::GetDirectoryName($p.ExecutablePath)) 'resources/codex.exe') -PathType Leaf){$kind='codex-desktop'}else{$kind='chatgpt'}
   }elseif(Test-Path -LiteralPath (Join-Path ([IO.Path]::GetDirectoryName($p.ExecutablePath)) 'resources/app.asar') -PathType Leaf){$kind='codex-desktop'}else{$kind='codex-cli'}
  }
 }
 [pscustomobject]@{pid=[int]$p.ProcessId;parent=[int]$p.ParentProcessId;kind=$kind}
})
[Console]::WriteLine((ConvertTo-Json -InputObject @{rows=$rows;partial=$partial} -Depth 4 -Compress))
