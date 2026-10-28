// Copy to your own website. This client never receives the local control token.
export class BiuukaExternal {
 constructor(){this.base='http://127.0.0.1:17322';this.token='';}
 async call(route,body){const r=await fetch(this.base+route,{method:body?'POST':'GET',credentials:'omit',headers:{...(this.token?{Authorization:'Bearer '+this.token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error((await r.json()).error);return r;}
 async begin(){this.nonce=Array.from(crypto.getRandomValues(new Uint8Array(24)),n=>n.toString(16).padStart(2,'0')).join('');const d=await(await this.call('/pair/start',{nonce:this.nonce})).json();this.ticket=d.ticket;return d;}
 async authorize(code){const grant=await(await this.call('/pair/exchange',{ticket:this.ticket,nonce:this.nonce,code})).json();this.token=grant.token;return {expiresAt:grant.expiresAt,scopes:grant.scopes};}
 async notify(title,body){return(await this.call('/notify',{title,body})).json();}
}
// Call from a user action. The local page owns permission/duration selection.
BiuukaExternal.prototype.connect=async function(){
 const pending=await this.begin();
 return new Promise((resolve,reject)=>{
  const dialog=document.createElement('dialog');
  dialog.innerHTML='<form><h2>连接本机 Biuuka</h2><p>先在本机页面确认网站、权限与时长，再输入当前 30 秒滚动码。</p><p><a target="_blank" rel="noopener noreferrer">打开本机授权页 ↗</a></p><label>当前授权码 <input inputmode="numeric" autocomplete="off" maxlength="6" pattern="[0-9]{6}" required></label><p role="status"></p><button type="submit">匹配并连接</button> <button type="button">取消</button></form>';
  dialog.querySelector('a').href=pending.url;
  const close=()=>{dialog.close();dialog.remove();};
  dialog.querySelector('button[type="button"]').onclick=()=>{close();reject(Error('cancelled'));};
  dialog.addEventListener('cancel',()=>{dialog.remove();reject(Error('cancelled'));});
  dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();const submit=dialog.querySelector('button[type="submit"]');submit.disabled=true;try{const grant=await this.authorize(dialog.querySelector('input').value.trim());close();resolve(grant);}catch{dialog.querySelector('[role="status"]').textContent='请确认已在本机授权，输入当前码；过期或尝试过多时请重新申请。';submit.disabled=false;}};
  document.body.append(dialog);dialog.showModal();
 });
};
