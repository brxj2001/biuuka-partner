import os from 'node:os';
import path from 'node:path';
import {access,cp,mkdir} from 'node:fs/promises';
export const stateDir=process.env.BIUUKA_STATE||path.join(os.homedir(),'.biuuka');
export const legacyState=process.platform==='win32'?path.join(process.env.LOCALAPPDATA||os.homedir(),'Biuuka'):path.join(os.homedir(),'Library/Application Support/Biuuka');
export async function migrateState(){
  await mkdir(stateDir,{recursive:true,mode:0o700});
  try{await access(path.join(stateDir,'config.json'));return;}catch{}
  try{await access(path.join(legacyState,'config.json'));}catch{return;}
  // Copy only our configuration; never copy credentials or overwrite current data.
  await cp(path.join(legacyState,'config.json'),path.join(stateDir,'config.json'),{force:false,errorOnExist:true});
}
