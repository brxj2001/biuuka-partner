$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$session=(Get-Process -Id $PID).SessionId
$partial=$false
$files=@{}
$rows=@(Get-CimInstance Win32_Process -Filter ("SessionId = " + $session) -Property ProcessId,ParentProcessId,Name,ExecutablePath | ForEach-Object {
 $p=$_;$kind=$null;$label=$null
 $named=$p.Name -match '^(ChatGPT|Codex|codex-[a-z0-9_-]+)\.exe$'
 if($p.ExecutablePath){
  $exe=$p.ExecutablePath
  if(-not $files.ContainsKey($exe)){
   $identity=$null
   try{
    $v=[Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
    $candidate=$named -or $v.CompanyName -match 'OpenAI' -or $v.ProductName -match 'ChatGPT|Codex' -or $v.OriginalFilename -match '^(ChatGPT|Codex)\.exe$'
    if($candidate){
     $gui=$p.Name -ieq 'ChatGPT.exe' -or $v.OriginalFilename -ieq 'ChatGPT.exe' -or $v.ProductName -match 'ChatGPT' -or (Test-Path -LiteralPath (Join-Path ([IO.Path]::GetDirectoryName($exe)) 'resources/app.asar') -PathType Leaf)
     if($gui){
      $sig=Get-AuthenticodeSignature -LiteralPath $exe
      if($sig.Status -eq 'Valid' -and $sig.SignerCertificate.Subject -match '\bOpenAI\b'){$identity='chatgpt'}else{$partial=$true}
     }elseif($named){$identity='codex-cli'}
    }
   }catch{if($named){$partial=$true}}
   $files[$exe]=$identity
  }
  if($files[$exe]){
   $owner=Invoke-CimMethod -InputObject $p -MethodName GetOwnerSid
   if($owner.ReturnValue -ne 0){$partial=$true}
   elseif($owner.Sid -eq $sid){$kind=$files[$exe];$label=[IO.Path]::GetFileNameWithoutExtension($exe)}
  }
 }elseif($named){$partial=$true}
 [pscustomobject]@{pid=[int]$p.ProcessId;parent=[int]$p.ParentProcessId;kind=$kind;name=$label;exe=$(if($kind){$p.ExecutablePath}else{$null})}
})
[Console]::WriteLine((ConvertTo-Json -InputObject @{rows=$rows;partial=$partial} -Depth 4 -Compress))
