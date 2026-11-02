import https from 'node:https';
import {readFile,writeFile,mkdir,mkdtemp,rename,rm,lstat,chmod} from 'node:fs/promises';
import {X509Certificate,createPrivateKey} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {trustedOrigin} from './access.mjs';
export const HTTPS_PORTS=[17324,17325];
const folder=state=>path.join(state,'https');
async function privatePath(file,directory=false){const s=await lstat(file);if(s.isSymbolicLink()||(directory?!s.isDirectory():!s.isFile())||(s.mode&0o077))throw Error('https_unsafe_permissions');}
export async function readIdentity(state,{allowExpired=false}={}){
 const dir=folder(state);await privatePath(dir,true);
 const keyFile=path.join(dir,'key.pem'),certFile=path.join(dir,'cert.pem');await privatePath(keyFile);await privatePath(certFile);
 const key=await readFile(keyFile),cert=await readFile(certFile),x=new X509Certificate(cert);
 if(x.ca||!x.checkIP('127.0.0.1')||!x.checkPrivateKey(createPrivateKey(key))||Date.parse(x.validFrom)>Date.now()||(!allowExpired&&Date.parse(x.validTo)<=Date.now()))throw Error('https_invalid_identity');
 return {key,cert,fingerprint:x.fingerprint256,sha1:x.fingerprint,expiresAt:x.validTo,certFile};
}
export async function prepareIdentity(state){
 try{return await readIdentity(state);}catch(e){if(e.code!=='ENOENT')throw e;}
 await mkdir(state,{recursive:true,mode:0o700});const target=folder(state);
 // Never replace an existing identity or trust entry implicitly.
 try{await lstat(target);throw Error('https_existing_identity_incomplete');}catch(e){if(e.code!=='ENOENT')throw e;}
 const stage=await mkdtemp(path.join(state,'.https-'));await chmod(stage,0o700);
 try{
  const configFile=path.join(stage,'openssl.cnf');await writeFile(configFile,'[req]\ndistinguished_name=dn\n[dn]\n[server]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n',{mode:0o600});
  execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','365','-subj','/CN=Biuuka Local HTTPS','-keyout',path.join(stage,'key.pem'),'-out',path.join(stage,'cert.pem'),'-config',configFile,'-extensions','server'],{stdio:['pipe','ignore','pipe'],timeout:30000});
  await rm(configFile);
  await chmod(path.join(stage,'key.pem'),0o600);await chmod(path.join(stage,'cert.pem'),0o600);await rename(stage,target);return await readIdentity(state);
 }finally{await rm(stage,{recursive:true,force:true});}
}
export async function trustIdentity(state,{confirm=false,platform=process.platform,run=execFileSync}={}){
 if(platform!=='darwin')throw Error('https_macos_only');if(!confirm)throw Error('https_trust_confirmation_required');
 const identity=await readIdentity(state);
 run('/usr/bin/security',['add-trusted-cert','-r','trustRoot','-p','ssl','-s','127.0.0.1','-k',path.join(os.homedir(),'Library/Keychains/login.keychain-db'),identity.certFile],{stdio:'inherit',timeout:120000});
 return {fingerprint:identity.fingerprint,expiresAt:identity.expiresAt};
}
export async function removeIdentityTrust(state,{run=execFileSync}={}){
 const identity=await readIdentity(state,{allowExpired:true}).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(!identity)return;
 // Delete only this device's exact certificate, never a root by a shared name.
 try{run('/usr/bin/security',['delete-certificate','-t','-Z',identity.fingerprint.replaceAll(':',''),path.join(os.homedir(),'Library/Keychains/login.keychain-db')],{stdio:'pipe',timeout:30000});}catch(e){if(e.status!==44)throw e;}
}
export async function startHttps({state,server,httpPort,ports=HTTPS_PORTS}){
 const identity=await readIdentity(state);let last;
 for(const port of ports){
  const sockets=new Set();
  const permitted=req=>req.headers.host===`127.0.0.1:${port}`&&trustedOrigin(req.headers.origin)&&!req.headers.authorization;
  const secure=https.createServer({key:identity.key,cert:identity.cert,minVersion:'TLSv1.2'},(req,res)=>{
   if(!permitted(req)){res.writeHead(403,{'Cache-Control':'no-store'});res.end();return;}
   req.headers.host=`127.0.0.1:${httpPort}`;server.emit('request',req,res);
  });
  secure.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  secure.on('upgrade',(req,socket,head)=>{if(!permitted(req)||req.url!=='/events'){socket.destroy();return;}req.headers.host=`127.0.0.1:${httpPort}`;server.emit('upgrade',req,socket,head);});
  try{await new Promise((resolve,reject)=>{secure.once('error',reject);secure.listen(port,'127.0.0.1',resolve);});return {port,fingerprint:identity.fingerprint,close(){for(const s of sockets)s.destroy();secure.close();}};}
  catch(e){secure.close();last=e;if(e.code!=='EADDRINUSE')throw e;}
 }
 throw last;
}

export async function removeIdentity(state){
 await removeIdentityTrust(state);await privatePath(folder(state),true);await rm(folder(state),{recursive:true});
}
