param([string]$InstallSource = '', [switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Repository = 'brxj2001/biuuka-partner'
$Headers = @{ 'User-Agent'='Biuuka-source-installer'; 'Accept'='application/vnd.github+json' }
if ($env:GITHUB_TOKEN) { $Headers['Authorization'] = 'Bearer '+$env:GITHUB_TOKEN }
$Stage = Join-Path ([IO.Path]::GetTempPath()) ('biuuka-github-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $Stage | Out-Null
function Download($Url, $File) {
    & curl.exe --fail --location --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 300 --retry 2 --output $File $Url
    if ($LASTEXITCODE -ne 0) { throw 'Download failed. Existing installation was not changed.' }
}
try {
    $Commit = (Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/commits/main" -Headers $Headers).sha
    if ($Commit -notmatch '^[a-f0-9]{40}$') { throw 'Invalid GitHub commit.' }
    Write-Host ('Installing verified GitHub source commit: ' + $Commit)
    $Tree = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/git/trees/${Commit}?recursive=1" -Headers $Headers
    if ($Tree.truncated) { throw 'GitHub source tree is incomplete.' }
    $Expected = @{}
    foreach ($Entry in $Tree.tree) {
        if ($Entry.type -eq 'tree') { continue }
        if ($Entry.type -ne 'blob' -or $Entry.mode -notin @('100644','100755') -or $Entry.sha -notmatch '^[a-f0-9]{40}$') { throw 'Source contains unsupported links or Git entries.' }
        $Name = [string]$Entry.path
        if ([IO.Path]::IsPathRooted($Name) -or $Name -match '(^|/)\.\.(/|$)|[\\:]' -or $Expected.ContainsKey($Name)) { throw 'Unsafe source path.' }
        $Expected[$Name] = $Entry.sha
    }
    if (!$Expected.Count -or $Expected.Count -gt 3000) { throw 'Unexpected source tree size.' }
    $Zip = Join-Path $Stage 'source.zip'
    Download "https://codeload.github.com/$Repository/zip/$Commit" $Zip
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $Archive = [IO.Compression.ZipFile]::OpenRead($Zip)
    $Prefix = "biuuka-partner-$Commit/"
    try {
        foreach ($Entry in $Archive.Entries) {
            if (!$Entry.FullName.StartsWith($Prefix,[StringComparison]::Ordinal) -or $Entry.FullName -match '(^|/)\.\.(/|$)|[\\:]') { throw 'Unsafe archive entry.' }
            if ($Entry.Length -gt 32MB) { throw 'Unexpected source file size.' }
        }
    } finally { $Archive.Dispose() }
    Expand-Archive -LiteralPath $Zip -DestinationPath $Stage
    $Source = Join-Path $Stage "biuuka-partner-$Commit"
    $Actual = @(Get-ChildItem -LiteralPath $Source -File -Recurse -Force)
    if ($Actual.Count -ne $Expected.Count) { throw 'Source file count mismatch.' }
    $Sha1 = [Security.Cryptography.SHA1]::Create()
    try {
        foreach ($File in $Actual) {
            if ($File.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Source links are not permitted.' }
            $Name = $File.FullName.Substring($Source.Length+1).Replace('\','/')
            if (!$Expected.ContainsKey($Name)) { throw 'Unlisted source file.' }
            $Bytes = [IO.File]::ReadAllBytes($File.FullName)
            $Header = [Text.Encoding]::UTF8.GetBytes(('blob '+$Bytes.Length+[char]0))
            $Payload = New-Object byte[] ($Header.Length+$Bytes.Length)
            [Array]::Copy($Header,0,$Payload,0,$Header.Length)
            [Array]::Copy($Bytes,0,$Payload,$Header.Length,$Bytes.Length)
            $Digest = ([BitConverter]::ToString($Sha1.ComputeHash($Payload))).Replace('-','').ToLowerInvariant()
            if ($Digest -ne $Expected[$Name]) { throw ('Git source checksum mismatch: '+$Name) }
        }
    } finally { $Sha1.Dispose() }
    $Arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $Platform = switch ($Arch.ToUpperInvariant()) { 'AMD64' {'win32-x64'} 'ARM64' {'win32-arm64'} default {throw 'Unsupported Windows architecture.'} }
    $Sources = Get-Content -Raw -LiteralPath (Join-Path $Source 'sources.json') | ConvertFrom-Json
    $Node = $Sources.$Platform.node
    if ($Node.algorithm -ne 'sha256' -or $Node.digest -notmatch '^[a-f0-9]{64}$' -or ([Uri]$Node.url).Host -ne 'nodejs.org' -or ([Uri]$Node.url).Scheme -ne 'https') { throw 'Invalid pinned Node source.' }
    $NodeExe = Join-Path $Stage 'node.exe'
    Download $Node.url $NodeExe
    if ((Get-FileHash -LiteralPath $NodeExe -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Node.digest) { throw 'Node checksum mismatch.' }
    $Output = Join-Path $Stage 'package'
    & $NodeExe (Join-Path $Source 'package.mjs') --output $Output
    if ($LASTEXITCODE -ne 0) { throw 'Local package build failed.' }
    if ($VerifyOnly) {
        $Manifest = Get-Content -Raw -LiteralPath (Join-Path $Output 'latest.json') | ConvertFrom-Json
        foreach ($Name in @('install.cmd','install.sh','biuuka.zip','uninstall.ps1')) {
            $Digest = (Get-FileHash -LiteralPath (Join-Path $Output $Name) -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($Manifest.files.$Name.sha256 -ne $Digest) { throw ('Generated package checksum mismatch: '+$Name) }
        }
        Write-Host ('BIUUKA_VERIFY_OK commit='+$Commit+' platform='+$Platform+' version='+$Manifest.version+' installed=false')
        return
    }
    & (Join-Path $Output 'install.cmd') $InstallSource
    if ($LASTEXITCODE -ne 0) { throw 'Biuuka installation failed.' }
} finally {
    Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue
}
