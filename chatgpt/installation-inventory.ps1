$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$roots=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$partial=$false
try{Get-AppxPackage | Where-Object {$_.Name -match 'OpenAI|ChatGPT|Codex' -or $_.Publisher -match 'OpenAI'} | ForEach-Object {if($_.InstallLocation){$null=$roots.Add($_.InstallLocation)}}}catch{$partial=$true}
foreach($registry in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')){
 try{Get-ItemProperty $registry -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -match 'ChatGPT|Codex' -or $_.Publisher -match 'OpenAI'} | ForEach-Object {if($_.InstallLocation){$null=$roots.Add($_.InstallLocation)}}}catch{$partial=$true}
}
foreach($base in @($env:LOCALAPPDATA,$env:ProgramFiles,${env:ProgramFiles(x86)})){
 if($base){foreach($name in @('ChatGPT','Codex','Programs\ChatGPT','Programs\Codex')){$null=$roots.Add((Join-Path $base $name))}}
}
$seen=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$items=New-Object 'System.Collections.Generic.List[object]'
foreach($root in @($roots | Select-Object -First 64)){
 foreach($dir in @($root,(Join-Path $root 'app'))){
  if(-not (Test-Path -LiteralPath $dir -PathType Container)){continue}
  try{foreach($f in @(Get-ChildItem -LiteralPath $dir -Filter '*.exe' -File | Select-Object -First 32)){
   if(-not $seen.Add($f.FullName)){continue}
   $v=$f.VersionInfo
   $main=$f.Name -ieq 'ChatGPT.exe' -or $v.OriginalFilename -ieq 'ChatGPT.exe' -or (($f.Name -ieq 'Codex.exe' -or $v.OriginalFilename -ieq 'Codex.exe') -and (Test-Path -LiteralPath (Join-Path $dir 'resources/app.asar') -PathType Leaf))
   if(-not $main){continue}
   $sig=Get-AuthenticodeSignature -LiteralPath $f.FullName
   if($sig.Status -eq 'Valid' -and $sig.SignerCertificate.Subject -match '\bOpenAI\b'){$items.Add([pscustomobject]@{path=$f.FullName;name=$f.BaseName;version=$v.ProductVersion})}
  }}catch{$partial=$true}
 }
}
[Console]::WriteLine((ConvertTo-Json -InputObject @{items=@($items.ToArray());partial=$partial} -Depth 4 -Compress))
