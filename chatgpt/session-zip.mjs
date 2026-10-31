import {crc32,inflateRawSync} from 'node:zlib';
const LIMIT=64*1024*1024;
export function encodeZip(files){
 const chunks=[],directory=[];let offset=0,total=0;
 for(const [name,bytes]of files){total+=bytes.length;if(total>LIMIT)throw Error('会话包超过 64 MB，请分批导出。');const n=Buffer.from(name),h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt32LE(crc32(bytes),14);h.writeUInt32LE(bytes.length,18);h.writeUInt32LE(bytes.length,22);h.writeUInt16LE(n.length,26);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);h.copy(c,6,4,30);c.writeUInt32LE(offset,42);chunks.push(h,n,bytes);directory.push(c,n);offset+=h.length+n.length+bytes.length;}
 const d=Buffer.concat(directory),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.size,8);end.writeUInt16LE(files.size,10);end.writeUInt32LE(d.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...chunks,d,end]);
}
export function decodeZip(bytes){
 if(bytes.length>LIMIT)throw Error('会话包超过 64 MB。');let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0||bytes.readUInt16LE(end+4)||bytes.readUInt16LE(end+6))throw Error('不支持此 ZIP 格式。');
 const count=bytes.readUInt16LE(end+10);let at=bytes.readUInt32LE(end+16),total=0;const files=new Map();if(count>500)throw Error('会话包文件过多。');
 for(let i=0;i<count;i++){
  if(at+46>end||bytes.readUInt32LE(at)!==0x02014b50)throw Error('会话包目录损坏。');
  const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),size=bytes.readUInt32LE(at+24),packed=bytes.readUInt32LE(at+20),n=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),pos=bytes.readUInt32LE(at+42),mode=bytes.readUInt32LE(at+38)>>>16;
  if(flags&1||![0,8].includes(method)||((mode&0xf000)===0xa000)||at+46+n+extra+comment>end)throw Error('会话包含不支持的条目。');
  const name=bytes.subarray(at+46,at+46+n).toString('utf8');if(!name||name.includes('\\')||name.startsWith('/')||name.split('/').some(v=>v==='..'||v==='.')||name.includes('\0')||files.has(name))throw Error('会话包路径无效。');
  total+=size;if(total>LIMIT||pos+30>at||bytes.readUInt32LE(pos)!==0x04034b50)throw Error('会话包大小或条目无效。');const start=pos+30+bytes.readUInt16LE(pos+26)+bytes.readUInt16LE(pos+28);if(start+packed>at)throw Error('会话包条目越界。');
  const data=method===0?Buffer.from(bytes.subarray(start,start+packed)):inflateRawSync(bytes.subarray(start,start+packed),{maxOutputLength:Math.max(1,size)});if(data.length!==size||crc32(data)!==bytes.readUInt32LE(at+16))throw Error('会话包校验失败。');files.set(name,data);at+=46+n+extra+comment;
 }
 return files;
}
