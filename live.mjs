import ws from './ws.cjs';
import {trustedOrigin,validOrigin} from './access.mjs';
// Read-only snapshots. No commands, credentials in URLs, or management over WS.
export function attachLive(server,{hosts,token,access,snapshot}){
 const wss=new ws.WebSocketServer({noServer:true,maxPayload:2048,perMessageDeflate:false});
 const allowed=peer=>trustedOrigin(peer.origin)||peer.local&&peer.credential===token||access.permits(peer.credential,peer.origin,'account');
 const send=peer=>{if(!allowed(peer)){peer.close(1008,'authorization_required');return;}if(peer.readyState===ws.OPEN){if(peer.bufferedAmount>262144){peer.terminate();return;}const value={...snapshot()};if(!trustedOrigin(peer.origin)&&!peer.local){value.update=null;}peer.send(JSON.stringify({type:'snapshot',...value}));}};
 server.on('upgrade',(req,socket,head)=>{
  const origin=req.headers.origin,local=origin===`http://${req.headers.host}`;
  if(req.url!=='/events'||!hosts.has(req.headers.host)||!(local||validOrigin(origin))||wss.clients.size>=16){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  wss.handleUpgrade(req,socket,head,peer=>{
   peer.origin=origin;peer.local=local;peer.credential='';peer.alive=true;
   const deadline=setTimeout(()=>peer.terminate(),5000);
   peer.on('error',()=>{});peer.on('pong',()=>{peer.alive=true;});peer.on('close',()=>clearTimeout(deadline));
   let authenticated=false;
   const authenticate=()=>{if(!allowed(peer)){peer.close(1008,'authorization_required');return;}authenticated=true;clearTimeout(deadline);send(peer);};
   peer.on('message',(data,binary)=>{if(authenticated||binary){peer.close(1008,'read_only');return;}try{const value=JSON.parse(data);if(value.type!=='authorize'||typeof value.token!=='string')throw Error();peer.credential=value.token;authenticate();}catch{peer.close(1008,'authorization_required');}});
   if(trustedOrigin(origin))authenticate();
  });
 });
 const broadcast=()=>{for(const peer of wss.clients)if(allowed(peer))send(peer);else if(peer.credential)peer.close(1008,'authorization_required');};
 const heartbeat=setInterval(()=>{for(const peer of wss.clients){if(!peer.alive){peer.terminate();continue;}peer.alive=false;peer.ping();}broadcast();},5000);heartbeat.unref();
 const close=()=>{clearInterval(heartbeat);for(const peer of wss.clients)peer.terminate();wss.close();};
 server.once('close',close);
 const original=server.closeAllConnections.bind(server);server.closeAllConnections=()=>{close();original();};
 return {broadcast};
}
