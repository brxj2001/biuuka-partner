param([Parameter(Mandatory=$true)][string]$Node,[Parameter(Mandatory=$true)][string]$Launcher,[Parameter(Mandatory=$true)][string]$StatusFile,[string]$AppVersion='')
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing,Accessibility -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;
using System.Runtime.InteropServices;
public class BiuukaSwitch : Control {
 private bool selected;
 public bool Checked { get { return selected; } set { if(selected!=value){selected=value;Invalidate();} } }
 public BiuukaSwitch() { TabStop=true; AccessibleRole=AccessibleRole.CheckButton; SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer|ControlStyles.ResizeRedraw|ControlStyles.Selectable,true); }
 protected override void OnPaintBackground(PaintEventArgs e) { e.Graphics.Clear(BackColor); }
 protected override void OnKeyDown(KeyEventArgs e) { base.OnKeyDown(e); if(e.KeyCode==Keys.Space && Enabled){OnClick(EventArgs.Empty);e.Handled=true;e.SuppressKeyPress=true;} }
 protected override AccessibleObject CreateAccessibilityInstance() { return new SwitchAccessibility(this); }
 private class SwitchAccessibility : ControlAccessibleObject {
  private BiuukaSwitch owner;
  public SwitchAccessibility(BiuukaSwitch owner):base(owner){this.owner=owner;}
  public override AccessibleStates State {get{return base.State|(owner.Checked?AccessibleStates.Checked:AccessibleStates.None);}}
  public override string DefaultAction {get{return "Toggle";}}
  public override void DoDefaultAction(){if(owner.Enabled)owner.OnClick(EventArgs.Empty);}
 }
 protected override void OnPaint(PaintEventArgs e) {
  e.Graphics.SmoothingMode=SmoothingMode.AntiAlias;
  int h=Height-4,w=Width-4;
  using(var shape=new GraphicsPath()) {
   shape.AddArc(2,2,h,h,90,180); shape.AddArc(w-h+2,2,h,h,270,180); shape.CloseFigure();
   var fill=Enabled?(Checked?Color.FromArgb(157,202,180):Color.FromArgb(65,71,78)):SystemColors.ControlDark;
   using(var brush=new SolidBrush(fill)) e.Graphics.FillPath(brush,shape);
   using(var pen=new Pen(Checked?Color.FromArgb(190,228,209):Color.FromArgb(123,132,142))) e.Graphics.DrawPath(pen,shape);
   int d=h-8,x=Checked?Width-d-6:6;
   using(var brush=new SolidBrush(Color.White)) e.Graphics.FillEllipse(brush,x,6,d,d);
  }
  if(Focused && ShowFocusCues) ControlPaint.DrawFocusRectangle(e.Graphics,ClientRectangle);
 }
}
// Explicit grayscale antialiasing stays smooth on dark backgrounds even when
// system GDI font smoothing is disabled; no ClearType colour fringes.
public static class BiuukaText {
 public static void Draw(Graphics graphics,string text,Font font,Rectangle bounds,Color color,bool topLeft) {
  graphics.TextRenderingHint=System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
  using(var format=new StringFormat(StringFormat.GenericTypographic))
  using(var brush=new SolidBrush(color)) {
   format.Trimming=StringTrimming.EllipsisCharacter;
   format.FormatFlags|=StringFormatFlags.NoWrap;
   format.Alignment=topLeft?StringAlignment.Near:StringAlignment.Center;
   format.LineAlignment=topLeft?StringAlignment.Near:StringAlignment.Center;
   graphics.DrawString(text,font,brush,bounds,format);
  }
 }
}
public class BiuukaLabel : Label {
 protected override void OnPaint(PaintEventArgs e) {
  BiuukaText.Draw(e.Graphics,Text,Font,ClientRectangle,ForeColor,true);
 }
}
public class BiuukaButton : Control {
 public Color BorderColor {get;set;}
 public ContentAlignment TextAlign {get;set;}
 public BiuukaButton() { TabStop=true; AccessibleRole=AccessibleRole.PushButton; TextAlign=ContentAlignment.MiddleCenter; SetStyle(ControlStyles.UserPaint|ControlStyles.AllPaintingInWmPaint|ControlStyles.OptimizedDoubleBuffer|ControlStyles.ResizeRedraw|ControlStyles.Selectable,true); }
 public void PerformClick(){if(Enabled)OnClick(EventArgs.Empty);}
 protected override void OnKeyDown(KeyEventArgs e){base.OnKeyDown(e);if((e.KeyCode==Keys.Space||e.KeyCode==Keys.Enter)&&Enabled){PerformClick();e.Handled=true;e.SuppressKeyPress=true;}}
 protected override void OnEnabledChanged(EventArgs e){base.OnEnabledChanged(e);Invalidate();}
 protected override void OnPaintBackground(PaintEventArgs e) { e.Graphics.Clear(Parent==null?BackColor:Parent.BackColor); }
 protected override void OnPaint(PaintEventArgs e) {
  e.Graphics.SmoothingMode=SmoothingMode.AntiAlias;
  float r=16,w=Width-2,h=Height-2;
  using(var shape=new GraphicsPath()) {
   shape.AddArc(1,1,r,r,180,90);shape.AddArc(w-r,1,r,r,270,90);shape.AddArc(w-r,h-r,r,r,0,90);shape.AddArc(1,h-r,r,r,90,90);shape.CloseFigure();
   using(var brush=new SolidBrush(BackColor))e.Graphics.FillPath(brush,shape);
   using(var pen=new Pen(Focused && ShowFocusCues?ForeColor:BorderColor))e.Graphics.DrawPath(pen,shape);
  }
  var bounds=new Rectangle(Padding.Left,Padding.Top,Width-Padding.Horizontal,Height-Padding.Vertical);
  BiuukaText.Draw(e.Graphics,Text,Font,bounds,Enabled?ForeColor:SystemColors.GrayText,TextAlign==ContentAlignment.TopLeft);
 }
}
public static class BiuukaNative {
 [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll")] private static extern bool SetProcessDPIAware();
 public static void EnableDpi() { try { if(SetThreadDpiAwarenessContext(new IntPtr(-4))==IntPtr.Zero)SetProcessDPIAware(); } catch(EntryPointNotFoundException) { SetProcessDPIAware(); } }
 [DllImport("dwmapi.dll")] private static extern int DwmSetWindowAttribute(IntPtr window,int attribute,ref int value,int size);
 public static void SetCorners(IntPtr window,bool highContrast) {
  // Windows 11 compositor rounds smoothly. Earlier systems keep a clean
  // rectangular border instead of a hard, aliased GraphicsPath Region.
  int preference=highContrast?1:2;
  try { DwmSetWindowAttribute(window,33,ref preference,sizeof(int)); } catch(DllNotFoundException) {} catch(EntryPointNotFoundException) {}
 }
 [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr handle);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
}
'@
# Set DPI awareness before creating any window, preventing Windows bitmap scaling.
[BiuukaNative]::EnableDpi()
[Windows.Forms.Application]::EnableVisualStyles()

$Bg=[Drawing.Color]::FromArgb(27,33,37);$Surface=[Drawing.Color]::FromArgb(42,49,55)
$Ink=[Drawing.Color]::FromArgb(244,239,251);$Muted=[Drawing.Color]::FromArgb(175,188,191)
$Accent=[Drawing.Color]::FromArgb(199,173,238);$Mint=[Drawing.Color]::FromArgb(157,202,180)
if([Windows.Forms.SystemInformation]::HighContrast){$Bg=[Drawing.SystemColors]::Window;$Surface=[Drawing.SystemColors]::Control;$Ink=[Drawing.SystemColors]::WindowText;$Muted=$Ink;$Accent=[Drawing.SystemColors]::Highlight;$Mint=$Accent}
# Decode the original PNG directly; avoid PNG-compressed ICO -> GDI bitmap conversion.
# Detach from the file and decoder stream before keeping the image in the tray.
# GDI+ file-backed bitmaps otherwise prevent Windows from replacing the app directory.
$BrandBytes=[IO.File]::ReadAllBytes((Join-Path $PSScriptRoot 'brand.png'))
$BrandStream=New-Object IO.MemoryStream (,$BrandBytes)
$BrandDecoded=$null
try {
    $BrandDecoded=[Drawing.Image]::FromStream($BrandStream)
    $BrandBitmap=New-Object Drawing.Bitmap $BrandDecoded.Width,$BrandDecoded.Height
    $BrandGraphics=[Drawing.Graphics]::FromImage($BrandBitmap)
    try { $BrandGraphics.DrawImage($BrandDecoded,0,0,$BrandDecoded.Width,$BrandDecoded.Height) } finally { $BrandGraphics.Dispose() }
} finally { if($BrandDecoded){$BrandDecoded.Dispose()};$BrandStream.Dispose() }
$IconHandle=$BrandBitmap.GetHicon()
$Icon=[Drawing.Icon]::FromHandle($IconHandle).Clone()
[BiuukaNative]::DestroyIcon($IconHandle) | Out-Null
$Tray=New-Object Windows.Forms.NotifyIcon;$Tray.Icon=$Icon;$Tray.Text='Biuuka';$Tray.Visible=$true
$Panel=New-Object Windows.Forms.Form
$Panel.SuspendLayout()
$Panel.FormBorderStyle='None';$Panel.ShowInTaskbar=$false;$Panel.StartPosition='Manual';$Panel.TopMost=$true
$Panel.AutoScaleDimensions=New-Object Drawing.SizeF 96,96;$Panel.AutoScaleMode='Dpi'
$Panel.ClientSize=New-Object Drawing.Size 368,486;$Panel.BackColor=$Bg;$Panel.ForeColor=$Ink
$Panel.Font=New-Object Drawing.Font 'Microsoft YaHei UI',10;$Panel.KeyPreview=$true;$Panel.Text='Biuuka 托盘控制面板'
$Panel.Add_KeyDown({param($Sender,$Event) if($Event.KeyCode -eq 'Escape'){$Panel.Hide();$Event.Handled=$true}})
$Panel.Add_Deactivate({$Panel.Hide()})
$Panel.Add_HandleCreated({[BiuukaNative]::SetCorners($Panel.Handle,[Windows.Forms.SystemInformation]::HighContrast)})
function Add-Text([string]$Text,[int]$X,[int]$Y,[int]$Width,[int]$Height,[bool]$Sub=$false){
    $Label=New-Object BiuukaLabel;$Label.Text=$Text;$Label.Location=New-Object Drawing.Point $X,$Y;$Label.Size=New-Object Drawing.Size $Width,$Height
    $Label.AutoEllipsis=$true;$Label.UseMnemonic=$false;if($Sub){$Label.ForeColor=$Muted};$Panel.Controls.Add($Label);return $Label
}
function Add-Button([string]$Title,[string]$Action,[int]$X,[int]$Y,[int]$Width,[int]$Height){
    $Button=New-Object BiuukaButton;$Button.Text=$Title;$Button.Tag=$Action;$Button.AccessibleName=$Title
    $Button.Location=New-Object Drawing.Point $X,$Y;$Button.Size=New-Object Drawing.Size $Width,$Height
    $Button.BorderColor=[Drawing.Color]::FromArgb(89,94,110);$Button.BackColor=$Surface;$Button.ForeColor=$Ink;$Button.Cursor=[Windows.Forms.Cursors]::Hand
    $Button.Add_Click({param($Sender,$Event) Invoke-TrayAction $Sender.Tag});$Panel.Controls.Add($Button);return $Button
}
function Add-Toggle([string]$Title,[string]$Action,[int]$X,[int]$Y){
    $Switch=New-Object BiuukaSwitch;$Switch.Location=New-Object Drawing.Point $X,$Y;$Switch.Size=New-Object Drawing.Size 56,30
    $Switch.BackColor=$Bg;$Switch.AccessibleName=$Title;$Switch.Tag=$Action;$Switch.Cursor=[Windows.Forms.Cursors]::Hand
    $Switch.Add_Click({param($Sender,$Event) Invoke-TrayAction $Sender.Tag});$Panel.Controls.Add($Switch);return $Switch
}
$Jobs=New-Object Collections.ArrayList
$script:Pending=$null
$script:ActionError=$null
function Invoke-TrayAction([string]$Action){
    if($Action -eq 'hide'){$Panel.Hide();return}
    if($Action -eq 'quit'){[Windows.Forms.Application]::Exit();return}
    if($Jobs.Count -or $script:Pending){return}
    try{
        $Info=New-Object Diagnostics.ProcessStartInfo;$Info.FileName=$Node;$Info.Arguments='"'+$Launcher+'" tray-action '+$Action
        $Info.UseShellExecute=$false;$Info.CreateNoWindow=$true;$Process=[Diagnostics.Process]::Start($Info);$null=$Jobs.Add($Process)
        if($Action -in @('open','shop','updates')){$Panel.Hide()}else{
            $Field=if($Action -like 'auto-*'){'autoUpdate'}elseif($Action -like 'notify-*'){'notifications'}else{'enabled'}
            $Value=$Action -in @('auto-on','notify-on','start')
            $script:Pending=@{Field=$Field;Value=$Value;Until=[DateTime]::UtcNow.AddSeconds(15)}
            $script:ActionError=$null
            Refresh-Panel
        }
    }catch{$script:Pending=$null;$script:ActionError='设置未保存，请重试';Refresh-Panel}
}
function Add-Entry([string]$Title,[string]$Description,[string]$Action,[int]$X){
    $Button=Add-Button $Title $Action $X 96 152 80
    $Button.TextAlign='TopLeft';$Button.Padding=New-Object Windows.Forms.Padding 14,12,8,0
    $Button.Font=New-Object Drawing.Font 'Microsoft YaHei UI',10,([Drawing.FontStyle]::Bold)
    $Caption=New-Object BiuukaLabel;$Caption.Text=$Description;$Caption.AutoEllipsis=$true;$Caption.UseMnemonic=$false
    $Caption.Font=$Panel.Font;$Caption.ForeColor=$Muted;$Caption.BackColor=[Drawing.Color]::Transparent
    $Caption.Location=New-Object Drawing.Point 14,44;$Caption.Size=New-Object Drawing.Size 130,22
    $Caption.Add_Click({param($Sender,$Event) $Sender.Parent.PerformClick()});$Button.Controls.Add($Caption)
    $Button.AccessibleDescription=$Description;return $Button
}
$Logo=New-Object Windows.Forms.PictureBox;$Logo.Image=$BrandBitmap;$Logo.SizeMode='Zoom';$Logo.Location=New-Object Drawing.Point 24,24;$Logo.Size=New-Object Drawing.Size 40,40;$Panel.Controls.Add($Logo)
$Brand=Add-Text 'Biuuka' 78 24 88 28;$Brand.Font=New-Object Drawing.Font 'Microsoft YaHei UI',15,([Drawing.FontStyle]::Bold)
$Version=Add-Text $AppVersion 178 32 70 20 $true
$Status=Add-Text '正在连接这台电脑' 78 54 245 22 $true
$Hide=Add-Button '×' 'hide' 316 24 28 28;$Hide.AccessibleName='收起面板';$Hide.BackColor=$Bg
$Open=Add-Entry '控制台  ↗' '授权、记录与设置' 'open' 24
$Open.BackColor=[Drawing.Color]::FromArgb(61,53,78);$Open.ForeColor=$Accent
if([Windows.Forms.SystemInformation]::HighContrast){$Open.BackColor=$Surface;$Open.ForeColor=$Ink}
$Shop=Add-Entry '我的商城  ↗' '安装来源店铺' 'shop' 192
$Shop.BackColor=[Drawing.Color]::FromArgb(38,66,57);$Shop.ForeColor=$Mint
$null=Add-Text '自动更新' 24 204 210 24
$null=Add-Text '空闲时更新 Biuuka' 24 230 210 22 $true
$Auto=Add-Toggle '自动更新' 'auto-off' 288 212
$null=Add-Text '桌面通知' 24 268 210 24
$null=Add-Text '接收已授权网站的提醒' 24 294 230 22 $true
$Notify=Add-Toggle '网站通知' 'notify-on' 288 276
$Divider=New-Object Windows.Forms.Panel;$Divider.BackColor=$Surface;$Divider.Location=New-Object Drawing.Point 24,330;$Divider.Size=New-Object Drawing.Size 320,1;$Panel.Controls.Add($Divider)
$EngineTitle=Add-Text '服务状态' 24 350 210 24
$EngineHint=Add-Text '正在读取本机状态' 24 376 236 22 $true
$Engine=Add-Toggle '服务开关' 'pause' 288 356
$Updates=Add-Button '检查更新' 'updates' 24 426 152 36;$Updates.BackColor=$Surface;$Updates.ForeColor=$Accent
$Quit=Add-Button '退出托盘' 'quit' 192 426 152 36;$Quit.BackColor=$Surface;$Quit.ForeColor=$Ink
$Tips=New-Object Windows.Forms.ToolTip;$Tips.SetToolTip($Engine,'关闭功能后，仍可从网页重新开启');$Tips.SetToolTip($Quit,'退出图标，后台继续运行');$Tips.SetToolTip($Notify,'仅接收已授权网站的桌面提醒')
function Refresh-Panel {
    try{
        $Data=Get-Content -Raw -Encoding UTF8 -LiteralPath $StatusFile | ConvertFrom-Json
        if($script:Pending){
            if(!$Jobs.Count -and [bool]$Data.($script:Pending.Field) -eq $script:Pending.Value){$script:Pending=$null}
            elseif(!$Jobs.Count -and [DateTime]::UtcNow -gt $script:Pending.Until){$script:Pending=$null;$script:ActionError='设置未确认，请重试'}
            else{$Data.($script:Pending.Field)=$script:Pending.Value}
        }
        $Status.Text=if($script:ActionError){$script:ActionError}elseif(!$Data.online){'○ 尚未连接'}elseif($Data.enabled){'● 已连接，准备就绪'}else{'● 已连接 · 服务已关闭'}
        $Status.ForeColor=if($Data.online){$Mint}else{$Muted}
        $Tray.Text=if($Data.enabled){'Biuuka · 服务运行中'}else{'Biuuka · 控制面板'}
        $Name=if($Data.merchantName){[string]$Data.merchantName}else{'Biuuka'};$Shop.Controls[0].Text=$Name;$Shop.AccessibleDescription='返回安装来源：'+$Name;$Tips.SetToolTip($Shop,'返回 '+$Name)
        $EngineTitle.Text=if($Data.enabled){'服务已开启'}else{'服务已关闭'};$EngineHint.Text=if($Data.enabled){'关闭后仍可从网页重新开启'}else{'开启后恢复账号、额度等功能'};$Engine.Text=if($Data.enabled){'关闭'}else{'开启'};$Engine.Tag=if($Data.enabled){'pause'}else{'start'}
        $Auto.Text=if($Data.autoUpdate){'已开启'}else{'已关闭'};$Auto.Tag=if($Data.autoUpdate){'auto-off'}else{'auto-on'}
        $Notify.Text=if($Data.notifications){'已开启'}else{'已关闭'};$Notify.Tag=if($Data.notifications){'notify-off'}else{'notify-on'}
        $Auto.Checked=[bool]$Data.autoUpdate
        $Notify.Checked=[bool]$Data.notifications;$Engine.Checked=[bool]$Data.enabled;$Engine.AccessibleName=$EngineTitle.Text
        $Auto.AccessibleName='自动更新 '+$Auto.Text;$Notify.AccessibleName='网站通知 '+$Notify.Text
        $Auto.Enabled=$Notify.Enabled=$Engine.Enabled=([bool]$Data.online -and !$script:Pending -and !$Jobs.Count)
        $Updates.Enabled=[bool]$Data.online -and !$Jobs.Count
        if($Panel.Visible){$Panel.Update()}
    }catch{$Status.Text='状态暂不可用，请打开控制台';$Auto.Enabled=$Notify.Enabled=$Updates.Enabled=$Engine.Enabled=$false}
}
function Show-Panel {
    Refresh-Panel
    $Cursor=[Windows.Forms.Cursor]::Position;$Area=[Windows.Forms.Screen]::FromPoint($Cursor).WorkingArea
    $X=[Math]::Max($Area.Left,[Math]::Min($Cursor.X-($Panel.Width/2),$Area.Right-$Panel.Width-8))
    $Y=[Math]::Max($Area.Top,[Math]::Min($Cursor.Y-$Panel.Height-12,$Area.Bottom-$Panel.Height-8))
    $Panel.Location=New-Object Drawing.Point ([int]$X),([int]$Y);$Panel.Show();$Panel.BringToFront();[BiuukaNative]::SetForegroundWindow($Panel.Handle) | Out-Null;$Panel.Activate();$Open.Focus() | Out-Null
}
# Always reveal on click: toggling races with Deactivate and double-click events.
$Tray.Add_MouseClick({param($Sender,$Event) Show-Panel})
$Timer=New-Object Windows.Forms.Timer;$Timer.Interval=200
$Timer.Add_Tick({
    foreach($Job in @($Jobs.ToArray())){if($Job.HasExited){if($Job.ExitCode -ne 0){$script:Pending=$null;$script:ActionError='设置未保存，请重试'};$Jobs.Remove($Job);$Job.Dispose()}}
    Refresh-Panel
})
$Panel.ResumeLayout($true)
try{$Timer.Start();[Windows.Forms.Application]::Run()}finally{$Timer.Stop();$Tray.Visible=$false;$Tray.Dispose();$Tips.Dispose();$Logo.Image.Dispose();$Panel.Dispose();$Timer.Dispose();$Icon.Dispose()}
