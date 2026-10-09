import { visit } from 'jsonc-parser';
import { Value, ResultSchema, type Artifact, type ResultDeclaration } from '@meteor-flow/contracts';

export const limits={result:1024*1024,file:50*1024*1024,total:200*1024*1024,count:100};
export function parseResult(data:Buffer, taskId:string, attemptId:string):ResultDeclaration {
  const text=new TextDecoder('utf-8',{fatal:true}).decode(data);
  const objects:Set<string>[]=[];
  visit(text,{
    onObjectBegin(){objects.push(new Set());},
    onObjectProperty(key){const keys=objects.at(-1)!;if(keys.has(key))throw new Error(`结果包含重复字段：${key}`);keys.add(key);},
    onObjectEnd(){objects.pop();},
    onError(){throw new Error('结果必须是完整、严格的 JSON');},
  },{allowTrailingComma:false,disallowComments:true});
  const value:unknown=JSON.parse(text);
  if(!Value.Check(ResultSchema,value))throw new Error('结果协议或字段不符合 meteor-flow.result/v1');
  if(Buffer.byteLength(value.summary,'utf8')>32*1024)throw new Error('结果摘要超过 32 KiB');
  if(value.task_id!==taskId||value.attempt_id!==attemptId)throw new Error('结果 task_id / attempt_id 不匹配');
  const paths=value.artifacts.map(a=>`${a.root_id}\0${a.path}`);
  if(new Set(paths).size!==paths.length)throw new Error('结果产物路径不能重复');
  return value;
}

export type Manifest={version:1;jobId:string;generation:string;taskId:string;attemptId:string;archiveId:string;cancelRequested:boolean;result:ResultDeclaration;resultHash:string;artifacts:Artifact[]};
