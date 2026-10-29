import {readFile,writeFile,readdir,mkdir,rm,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../web/console/',import.meta.url));
const hash=b=>createHash('sha256').update(b).digest('hex');
async function files(dir){const result=[];for(const item of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(dir,item.name);if(item.isDirectory())result.push(...await files(p));else if(item.isFile())result.push(p);else throw Error('Console build rejects symlinks');}return result;}
function run(command,args){return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:root,stdio:'inherit',env:{...process.env,NEXT_TELEMETRY_DISABLED:'1',PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH}});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error('Console build failed: '+code)));});}
let flight;
export function buildConsole(){return flight??=(async()=>{
 const sources=[fileURLToPath(import.meta.url),...await files(path.join(root,'src')),...['package.json','package-lock.json','next.config.mjs','tsconfig.json'].map(n=>path.join(root,n))];
 const sourceHash=hash(Buffer.concat(await Promise.all(sources.map(async f=>Buffer.concat([Buffer.from(path.relative(root,f)),await readFile(f)])))));
 const generated=path.join(root,'generated');
 try{const prior=JSON.parse(await readFile(path.join(generated,'console-assets.json'),'utf8'));if(prior.sourceHash===sourceHash){for(const name of ['console.html',...Object.values(prior.routes)])await access(path.join(generated,name));return generated;}}catch{}
 try{await access(path.join(root,'node_modules/next/dist/bin/next'));}catch{
  const candidates=[path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js'),path.resolve(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js')];
  let npm;for(const c of candidates){try{await access(c);npm=c;break;}catch{}}
  if(npm)await run(process.execPath,[npm,'ci','--ignore-scripts','--no-audit','--no-fund']);else await run(process.platform==='win32'?'npm.cmd':'npm',['ci','--ignore-scripts','--no-audit','--no-fund']);
 }
 process.env.BIUUKA_CONSOLE_BUILD=sourceHash.slice(0,20);
 await run(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'build']);
 await rm(generated,{recursive:true,force:true});await mkdir(generated,{recursive:true});
 const routes={};
 const licenses=[];
 for(const name of ['next','react','react-dom','lucide-react','scheduler','styled-jsx','tslib']){
  const dir=path.join(root,'node_modules',name);let license;
  for(const file of (await readdir(dir)).filter(n=>/^(license(?:\.md|\.txt|-mit)?|copyrightnotice\.txt)$/i.test(n)).sort()){try{license=await readFile(path.join(dir,file),'utf8');break;}catch{}}
  if(!license)throw Error('Missing bundled dependency license: '+name);
  licenses.push(name+'\n'+license);
 }
 const licenseBytes=Buffer.from(licenses.join('\n\n'));await writeFile(path.join(generated,'console-'+hash(licenseBytes).slice(0,24)+'.txt'),licenseBytes);
 for(const file of await files(path.join(root,'out/_next'))){const route='/'+path.relative(path.join(root,'out'),file).split(path.sep).join('/');const bytes=await readFile(file),name='console-'+hash(Buffer.concat([Buffer.from(route),bytes])).slice(0,24)+path.extname(file);routes[route]=name;await writeFile(path.join(generated,name),bytes);}
 let html=await readFile(path.join(root,'out/index.html'),'utf8');
 const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].filter(m=>!/^<script\b[^>]*\bsrc=/.test(m[0])&&m[1]);
 const scriptHashes=[...new Set(scripts.map(m=>"'sha256-"+createHash('sha256').update(m[1]).digest('base64')+"'"))];
 html=html.replace('</head>','<meta name="console-token" content="__CONSOLE_TOKEN__"></head>');
 await writeFile(path.join(generated,'console.html'),html);
 await writeFile(path.join(generated,'console-assets.json'),JSON.stringify({sourceHash,routes,scriptHashes},null,2));
 return generated;
})().catch(e=>{flight=null;throw e;});}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildConsole();
