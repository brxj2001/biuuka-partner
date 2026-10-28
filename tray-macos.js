ObjC.import('Cocoa');
ObjC.import('QuartzCore');
function run(argv){
 var node=argv[0],launcher=argv[1],file=argv[2],status={},tasks=[],W=352,H=436;
 var app=$.NSApplication.sharedApplication;app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
 var pop=$.NSPopover.alloc.init;pop.behavior=$.NSPopoverBehaviorTransient;pop.contentSize=$.NSMakeSize(W,H);
 var vc=$.NSViewController.alloc.init,view=$.NSView.alloc.initWithFrame($.NSMakeRect(0,0,W,H));vc.view=view;pop.contentViewController=vc;
 view.appearance=$.NSAppearance.appearanceNamed($.NSAppearanceNameDarkAqua);
 function color(r,g,b){return $.NSColor.colorWithSRGBRedGreenBlueAlpha(r/255,g/255,b/255,1);}
 var ink=color(239,245,242),muted=color(170,190,184),mint=color(157,202,180),lilac=color(199,173,238);
 var background=$.NSBox.alloc.initWithFrame(view.bounds);background.boxType=$.NSBoxCustom;background.borderType=$.NSNoBorder;background.fillColor=color(27,33,37);background.contentViewMargins=$.NSMakeSize(0,0);view.addSubview(background);
 function rect(x,y,w,h){return $.NSMakeRect(x,H-y-h,w,h);}
 function text(title,x,y,w,h,size,bold){var label=$.NSTextField.labelWithString($(title));label.frame=rect(x,y,w,h);label.font=bold?$.NSFont.boldSystemFontOfSize(size):$.NSFont.systemFontOfSize(size);label.textColor=bold?ink:muted;view.addSubview(label);return label;}
 function launch(action){if(action==='quit'){app.terminate(null);return;}if(tasks.length)return;try{var t=$.NSTask.alloc.init;t.launchPath=$(node);t.arguments=$([launcher,'tray-action',action]);t.standardOutput=$.NSFileHandle.fileHandleWithNullDevice;t.standardError=$.NSFileHandle.fileHandleWithNullDevice;t.launch;tasks.push(t);if(['open','shop','updates'].indexOf(action)>=0)pop.performClose(null);}catch(e){subtitle.stringValue=$('操作未完成，请打开控制台');}}
 ObjC.registerSubclass({name:'BiuukaTrayDelegate',superclass:'NSObject',methods:{
  'action:':{types:['void',['id']],implementation:function(sender){launch(ObjC.unwrap(sender.identifier));}},
  'toggle:':{types:['void',['id']],implementation:function(){if(pop.shown){pop.performClose(null);return;}refresh();pop.showRelativeToRectOfViewPreferredEdge(statusItem.button.bounds,statusItem.button,$.NSMinYEdge);app.activateIgnoringOtherApps(true);}},
  'refresh:':{types:['void',['id']],implementation:function(){refresh();}}
 }});
 var delegate=$.BiuukaTrayDelegate.alloc.init;
 function button(title,action,x,y,w,h,tint){var b=$.NSButton.buttonWithTitleTargetAction($(title),delegate,'action:');b.frame=rect(x,y,w,h);b.identifier=$(action);b.bezelStyle=$.NSBezelStyleRounded;b.font=$.NSFont.systemFontOfSize(13);b.contentTintColor=tint||ink;view.addSubview(b);return b;}
 function toggle(title,hint,action,y){text(title,22,y,235,22,13,true);text(hint,22,y+24,245,19,11,false);var b=$.NSSwitch.alloc.initWithFrame(rect(288,y+7,42,26));b.target=delegate;b.action='action:';b.identifier=$(action);b.setAccessibilityLabel($(title));view.addSubview(b);return b;}
 var image=$.NSImage.alloc.initWithContentsOfFile($(argv[3]));
 var statusItem=$.NSStatusBar.systemStatusBar.statusItemWithLength($.NSVariableStatusItemLength);statusItem.button.toolTip=$('Biuuka');statusItem.button.target=delegate;statusItem.button.action='toggle:';
 if(image){var small=image.copy;small.size=$.NSMakeSize(23,23);statusItem.button.image=small;var logo=$.NSImageView.alloc.initWithFrame(rect(20,20,44,44));logo.image=image;view.addSubview(logo);}else{statusItem.button.title=$('B');}
 text('Biuuka',76,21,130,27,21,true);text(argv[4]||'',204,28,70,18,10,false);
 var subtitle=text('正在连接本机',76,51,250,19,11,false);
 button('打开控制台  ↗','open',20,89,152,40,lilac);button('返回商城  ↗','shop',180,89,152,40,mint);
 text('授权、记录与设置',26,135,147,18,10,false);var shopLabel=text('安装来源商城',186,135,146,18,10,false);
 var auto=toggle('自动更新','空闲时更新 Biuuka','auto-off',174),notify=toggle('网站通知','接收已授权网站的提醒','notify-on',238),engine=toggle('服务开关','关闭后保留本机开启入口','pause',302);
 button('检查更新','updates',20,384,152,32,lilac);button('退出托盘','quit',180,384,152,32,muted);
 function refresh(){
  try{status=JSON.parse(ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError($(file),$.NSUTF8StringEncoding,null)));}catch(e){status={};}
  subtitle.stringValue=$(status.online?(status.enabled?'服务已开启 · 准备就绪':'服务已关闭 · 可随时开启'):'本机服务暂未连接');subtitle.textColor=status.online?mint:muted;
  shopLabel.stringValue=$(status.merchantName||'安装来源商城');
  auto.state=status.autoUpdate?1:0;auto.identifier=$(status.autoUpdate?'auto-off':'auto-on');
  notify.state=status.notifications?1:0;notify.identifier=$(status.notifications?'notify-off':'notify-on');
  engine.state=status.enabled?1:0;engine.identifier=$(status.enabled?'pause':'start');
  tasks=tasks.filter(function(t){if(t.running)return true;if(Number(t.terminationStatus)!==0)subtitle.stringValue=$('操作失败，请打开控制台检查');return false;});
  [auto,notify,engine].forEach(function(b){b.enabled=!!status.online&&!tasks.length;});
 }
 refresh();var timer=$.NSTimer.scheduledTimerWithTimeIntervalTargetSelectorUserInfoRepeats(1,delegate,'refresh:',null,true);app.run;
}
