$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
# Query only the service's installing user, never enumerate other users.
$Packages=@(Get-AppxPackage -Name 'OpenAI.ChatGPT*' -ErrorAction Stop | Where-Object { $_.Name -match '^OpenAI\.ChatGPT(-Desktop)?$' } | ForEach-Object { @{name=$_.Name;version=$_.Version.ToString()} })
ConvertTo-Json -InputObject $Packages -Compress
