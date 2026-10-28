ObjC.import('AppKit');
ObjC.import('Foundation');
function run(argv) {
 const action=argv[0], ids=['com.openai.codex','com.openai.chat'];
 const all=()=>ObjC.unwrap($.NSWorkspace.sharedWorkspace.runningApplications).filter(a=>ids.includes(ObjC.unwrap(a.bundleIdentifier)));
 const describe=a=>({bundle:ObjC.unwrap(a.bundleURL.path),id:ObjC.unwrap(a.bundleIdentifier),running:true});
 const checkProfile=a=>{const task=$.NSTask.alloc.init;task.launchPath='/bin/ps';task.arguments=['-p',String(a.processIdentifier),'-o','command='];const pipe=$.NSPipe.pipe;task.standardOutput=pipe;task.launch;task.waitUntilExit;const text=ObjC.unwrap($.NSString.alloc.initWithDataEncoding(pipe.fileHandleForReading.readDataToEndOfFile,$.NSUTF8StringEncoding));if(/--user-data-dir|--profile-directory|--codex-home/.test(text))throw Error('desktop_identity_unconfirmed');};
 const validate=d=>{const b=$.NSBundle.bundleWithPath($(d.bundle));if(!b || !ids.includes(ObjC.unwrap(b.bundleIdentifier)) || ObjC.unwrap(b.bundleIdentifier)!==d.id)throw Error('desktop_identity_unconfirmed');};
 if(action==='inspect'){
  const running=all();if(running.length>1)throw Error('desktop_ambiguous');if(running.length){checkProfile(running[0]);return JSON.stringify(describe(running[0]));}
  for(const id of ids){const url=$.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier($(id));if(url && !url.isNil())return JSON.stringify({bundle:ObjC.unwrap(url.path),id,running:false});}
  return 'null';
 }
 const d=JSON.parse(argv[1]);validate(d);
 const matches=()=>all().filter(a=>ObjC.unwrap(a.bundleURL.path)===d.bundle);
 if(action==='stop'){
  for(const app of matches()){checkProfile(app);app.terminate;}
  const deadline=Date.now()+20000;while(matches().length){if(Date.now()>deadline)throw Error('desktop_stop_failed');delay(0.25);}
 }else{
  if(!matches().length){if(!$.NSWorkspace.sharedWorkspace.launchApplication($(d.bundle)))throw Error('desktop_start_failed');}
  const deadline=Date.now()+15000;while(!matches().length){if(Date.now()>deadline)throw Error('desktop_start_failed');delay(0.25);}delay(1);if(!matches().length)throw Error('desktop_start_failed');
 }
 return '{}';
}
