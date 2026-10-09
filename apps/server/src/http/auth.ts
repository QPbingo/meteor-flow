import { randomBytes, timingSafeEqual } from 'node:crypto';
import { writeFile, rename, open } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DomainError } from '../domain/model.js';

type Session={csrf:string;expires:number};
export class LocalAuth {
  private secret='';
  private sessions=new Map<string,Session>();
  private attempts=new Map<string,{time:number;count:number}>();
  private exchanging=false;
  origin='';
  constructor(private dataDir:string,readonly generation:string){}
  private token(){return randomBytes(32).toString('base64url');}
  async init(origin:string){this.origin=origin;await this.rotate();}
  private async rotate(){
    const next=this.token();
    const file=join(this.dataDir,'open.json');const temporary=join(this.dataDir,`open-${this.token()}.tmp`);
    await writeFile(temporary,JSON.stringify({generation:this.generation,url:`${this.origin}/#token=${next}`}),{flag:'wx',mode:0o600});
    const fd=await open(temporary,'r');try{await fd.sync();}finally{await fd.close();}
    await rename(temporary,file);this.secret=next;
  }
  private same(a:string,b:string){const left=Buffer.from(a);const right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
  boundary(request:FastifyRequest){
    const expected=new URL(this.origin);
    if(request.headers.host!==expected.host)throw new DomainError('HOST','拒绝非本机入口 Host',403);
    const origin=request.headers.origin;
    if(origin!==undefined&&origin!==this.origin)throw new DomainError('ORIGIN','拒绝跨站请求',403);
    if(request.headers['sec-fetch-site']==='cross-site')throw new DomainError('ORIGIN','拒绝跨站请求',403);
    if(!['GET','HEAD','OPTIONS'].includes(request.method)&&origin!==this.origin)throw new DomainError('ORIGIN','写入必须来自本机控制台页面',403);
  }
  session(request:FastifyRequest){
    const token=request.cookies.meteor_flow;const session=token?this.sessions.get(token):undefined;
    if(session&&session.expires>Date.now())return session;
    if(token)this.sessions.delete(token);return null;
  }
  require(request:FastifyRequest,websocket=false){
    if(websocket&&request.headers.origin!==this.origin)throw new DomainError('ORIGIN','终端连接必须来自本机控制台页面',403);
    const session=this.session(request);if(!session)throw new DomainError('AUTH','请从启动终端中的本机链接打开控制台',401);
    const csrf=websocket?(request.query as {csrf?:string}).csrf:request.headers['x-csrf-token'];
    if((websocket||!['GET','HEAD'].includes(request.method))&&(typeof csrf!=='string'||!this.same(csrf,session.csrf)))throw new DomainError('CSRF','操作凭据失效，请重新打开控制台',403);
    return session;
  }
  async exchange(request:FastifyRequest,reply:FastifyReply,token:string){
    const key=request.ip;const recent=this.attempts.get(key);const sample=recent&&Date.now()-recent.time<60000?recent:{time:Date.now(),count:0};sample.count++;this.attempts.set(key,sample);
    if(sample.count>30)throw new DomainError('RATE_LIMIT','入口兑换过于频繁，请稍后重试',429);
    if(this.exchanging||!this.secret||!this.same(token,this.secret))throw new DomainError('BOOTSTRAP','入口已使用或过期，请使用 meteor-flow open 获取新入口',401);
    this.exchanging=true;
    try{
      await this.rotate();
      const cookie=this.token();const csrf=this.token();this.sessions.set(cookie,{csrf,expires:Date.now()+7*86400000});
      reply.setCookie('meteor_flow',cookie,{httpOnly:true,sameSite:'strict',path:'/',maxAge:7*86400});return {csrf};
    }finally{this.exchanging=false;}
  }
}
