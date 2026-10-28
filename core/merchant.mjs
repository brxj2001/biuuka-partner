import {trustedOrigin} from './access.mjs';
export const DEFAULT_MERCHANT={name:'Biuuka',url:'https://brxj.biuuka.com/'};
export function merchant(value){
 try{
  const u=new URL(value.url);if(!trustedOrigin(u.origin)||u.username||u.password||u.hash||u.href.length>2048)return null;
  const name=typeof value.name==='string'?value.name.trim():'';if(!name||name.length>60||/[\u0000-\u001f\u007f]/.test(name))return null;
  // Only navigation context; never persist authentication or tracking query strings.
  for(const key of [...u.searchParams.keys()])if(!['shopId','storeId'].includes(key))u.searchParams.delete(key);
  // Upgrade the historical no-shop placeholder without replacing an actual shop.
  if(name==='Biuuka'&&u.href==='https://biuuka.com/')return {...DEFAULT_MERCHANT};
  return {name,url:u.href};
 }catch{return null;}
}
export function installMerchant(encoded,previous){
 if(!encoded)return merchant(previous)||DEFAULT_MERCHANT;
 if(encoded.length>4096||!/^[A-Za-z0-9_-]+$/.test(encoded))throw Error('Invalid installation source');
 const result=merchant(JSON.parse(Buffer.from(encoded,'base64url').toString('utf8')));
 if(!result)throw Error('Installation source must be a trusted HTTPS shop');return result;
}
