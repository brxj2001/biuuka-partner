import {mkdir,readFile,writeFile,rename,readdir,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
export class Records {
  constructor(root){this.root=path.join(root,'records');}
  file(id){if(!/^[a-f0-9-]{36}$/.test(id))throw Object.assign(Error('invalid_record'),{code:'invalid_record'});return path.join(this.root,id+'.json');}
  async put(record){await mkdir(this.root,{recursive:true,mode:0o700});const file=this.file(record.id),tmp=file+'.tmp';await writeFile(tmp,JSON.stringify(record),{mode:0o600});await rename(tmp,file);return record;}
  async begin(input){return this.put({id:randomUUID(),createdAt:new Date().toISOString(),...input,answer:'',status:'running',threadId:null,saved:false});}
  async get(id){return JSON.parse(await readFile(this.file(id),'utf8'));}
  async list(){let files;try{files=await readdir(this.root);}catch(e){if(e.code==='ENOENT')return [];throw e;}const result=[];for(const file of files.filter(x=>/^[a-f0-9-]{36}\.json$/.test(x))){const r=await this.get(file.slice(0,-5));const {answer,prompt,...summary}=r;result.push(summary);}return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  async remove(id,deleteThread){
    const record=await this.get(id);
    if(record.status==='running')throw Object.assign(Error('record_running'),{code:'record_running'});
    if(record.threadId){
      if(!deleteThread)throw Object.assign(Error('thread_delete_required'),{code:'thread_delete_required'});
      await deleteThread(record.threadId);
    }
    await rm(this.file(id),{force:true});
  }
  async recover(){for(const r of await this.list())if(r.status==='running'){const full=await this.get(r.id);await this.put({...full,status:'interrupted'});}}
}
