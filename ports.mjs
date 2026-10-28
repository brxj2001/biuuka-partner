export const DEFAULT_PORTS=[17322,17323];
export async function listenAvailable(factory,preferred=17322,alternatives=DEFAULT_PORTS){
 for(const port of [...new Set([preferred,...alternatives])]){
  const server=factory(port);
  try{await new Promise((resolve,reject)=>{const fail=e=>{server.off('listening',ready);reject(e);};const ready=()=>{server.off('error',fail);resolve();};server.once('error',fail);server.once('listening',ready);server.listen(port,'127.0.0.1');});return {server,port};}
  catch(e){server.closeAllConnections();if(e.code!=='EADDRINUSE')throw e;}
 }
 throw Error('Biuuka ports are occupied (17322 / 17323). Close the conflicting application and run biuuka start.');
}
