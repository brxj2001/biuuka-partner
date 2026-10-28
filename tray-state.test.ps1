$ErrorActionPreference='Stop'
# Exercise the actual panel reconciliation function without a Windows GUI or user data.
$Tokens=$null;$Errors=$null
$Ast=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'tray-windows.ps1'),[ref]$Tokens,[ref]$Errors)
if($Errors.Count){throw 'Tray parse failed'}
$Function=$Ast.Find({param($N) $N -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $N.Name -eq 'Refresh-Panel'},$true)
Invoke-Expression $Function.Extent.Text
class TrayFixtureControl {
 [string]$Text;[string]$Tag;[string]$ForeColor;[string]$AccessibleName;[string]$AccessibleDescription
 [bool]$Checked;[bool]$Enabled;[bool]$Visible=$true;[int]$Paints=0;[object[]]$Controls
 [void]Invalidate(){$this.Paints++}
 [void]Update(){$this.Paints++}
 [void]SetToolTip([object]$Control,[string]$Text){}
}
foreach($Name in @('Status','Tray','Shop','Tips','EngineTitle','EngineHint','Engine','Auto','Notify','Updates','Panel')){Set-Variable $Name ([TrayFixtureControl]::new())}
$Shop.Controls=@([TrayFixtureControl]::new());$Mint='mint';$Muted='muted';$Jobs=[Collections.ArrayList]::new()
$StatusFile=Join-Path ([IO.Path]::GetTempPath()) ('biuuka-tray-state-'+[guid]::NewGuid()+'.json')
$Snapshot=@{online=$true;enabled=$true;autoUpdate=$false;notifications=$true;merchantName='Fixture'}
function Save-Fixture {$Snapshot|ConvertTo-Json|Set-Content -LiteralPath $StatusFile -Encoding UTF8}
try {
 Save-Fixture;Refresh-Panel
 if($Auto.Checked -or !$Auto.Enabled){throw 'Initial state incorrect'}
 $OriginalHeader=$Status.Text
 $script:Pending=@{Field='autoUpdate';Value=$true;Until=[DateTime]::UtcNow.AddSeconds(15)}
 $null=$Jobs.Add('in-flight');Refresh-Panel
 if(!$Auto.Checked -or $Auto.Enabled -or $Status.Text -ne $OriginalHeader){throw 'Pending switch must update immediately without replacing connection header'}
 $Jobs.Clear();Refresh-Panel
 if(!$Auto.Checked -or !$script:Pending){throw 'Stale snapshot reverted pending switch'}
 $Snapshot.autoUpdate=$true;Save-Fixture;Refresh-Panel
 if(!$Auto.Checked -or !$Auto.Enabled -or $script:Pending -or $Auto.Tag -ne 'auto-off'){throw 'Acknowledgement did not enable next action'}
 $script:Pending=@{Field='autoUpdate';Value=$false;Until=[DateTime]::UtcNow.AddSeconds(-1)};Refresh-Panel
 if(!$Auto.Checked -or $script:Pending -or !$script:ActionError){throw 'Timeout must restore persisted state and explain failure'}
 $script:ActionError=$null;$Snapshot.enabled=$false;Save-Fixture;Refresh-Panel
 if($Engine.Checked -or $Engine.Tag -ne 'start' -or $EngineTitle.Text -ne '服务已关闭'){throw 'External state change not reconciled while panel open'}
 if($Panel.Paints -lt 6){throw 'Visible panel not repainted'}
 Write-Host '6 tray state reconciliation checks passed (headless; native rendering requires Windows).'
} finally {Remove-Item -LiteralPath $StatusFile -Force -ErrorAction SilentlyContinue}
