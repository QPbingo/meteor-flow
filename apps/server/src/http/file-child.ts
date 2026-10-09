import { safeRead } from '@meteor-flow/posix-fs';
process.once('disconnect',()=>process.exit(2));
const timer=setTimeout(()=>process.exit(2),10000);
process.once('message',(request:{root:string;file:string;max:number;hash:string})=>{
  clearTimeout(timer);
  try{
    const snapshot=safeRead(request.root,request.file,request.max);
    if(snapshot.sha256!==request.hash)throw new Error('归档摘要不一致，拒绝提供');
    process.send?.({data:snapshot.data,size:snapshot.size},()=>process.exit(0));
  }catch(error){process.send?.({error:error instanceof Error?error.message:String(error)},()=>process.exit(1));}
});
