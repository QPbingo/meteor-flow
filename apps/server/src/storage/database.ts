import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, chmodSync, openSync, closeSync } from 'node:fs';
import type { State } from '@meteor-flow/contracts';
import { DomainError, initialState, reduce, type Command } from '../domain/model.js';
import type { StatePatch } from './state-patch.js';

const ddl = `
CREATE TABLE projects(id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE bindings(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), session TEXT NOT NULL, terminal_id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), UNIQUE(session,terminal_id));
CREATE TABLE tasks(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), binding_id TEXT NOT NULL REFERENCES bindings(id), data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE attempts(id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), binding_id TEXT NOT NULL REFERENCES bindings(id), occupies INTEGER NOT NULL CHECK(occupies IN(0,1)), data TEXT NOT NULL CHECK(json_valid(data)));
CREATE UNIQUE INDEX one_active_binding ON attempts(binding_id) WHERE occupies=1;
CREATE UNIQUE INDEX one_active_task ON attempts(task_id) WHERE occupies=1;
CREATE TABLE artifacts(id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), attempt_id TEXT NOT NULL REFERENCES attempts(id), data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE events(id INTEGER PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE starts(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE jobs(id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE operations(id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL);
`;
const checksum = createHash('sha256').update(ddl).digest('hex');
const tables = ['projects','bindings','tasks','attempts','artifacts','events','starts','jobs','operations'] as const;
const columns:Record<string,string[]> = {
  projects:[], bindings:['project_id','session','terminal_id'], tasks:['project_id','binding_id'],
  attempts:['task_id','binding_id','occupies'], artifacts:['task_id','attempt_id'],
  events:[], starts:['project_id'], jobs:['task_id'], operations:[],
};
const property:Record<string,string> = {project_id:'projectId',session:'session',terminal_id:'terminalId',binding_id:'bindingId',task_id:'taskId',occupies:'occupies',attempt_id:'attemptId'};

/** Only the dedicated writer thread constructs this repository. */
export class Repository {
  // These SQL strings are fixed by the schema. Reusing statements bounds
  // native handles instead of allocating a new set for every observation/write.
  private statements=new Map<string,Database.Statement>();
  private constructor(private db:Database.Database) {}
  private prepare(sql:string){let statement=this.statements.get(sql);if(!statement){statement=this.db.prepare(sql);this.statements.set(sql,statement);}return statement;}

  static async open(file:string, session:string) {
    const existed=existsSync(file);
    const db=new Database(file,{timeout:3000});
    chmodSync(file,0o600);
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    const version=db.pragma('user_version',{simple:true}) as number;
    try {
      if(version>1)throw new Error('数据库版本高于此应用，拒绝自动降级');
      if(version===0){
        if(existed){
          const backup=`${file}.before-v1-${Date.now()}-${randomUUID()}.bak`;
          const reserved=openSync(backup,'wx',0o600);closeSync(reserved);
          await db.backup(backup);chmodSync(backup,0o600);
        }
        db.transaction(()=>{
          db.exec(ddl);
          db.prepare('INSERT INTO migrations VALUES(1,?,?)').run(checksum,Date.now());
          db.prepare('INSERT INTO settings VALUES(1,?)').run(JSON.stringify(initialState(session).settings));
          db.pragma('user_version = 1');
        })();
      }
      const migration=db.prepare('SELECT checksum FROM migrations WHERE version=1').get() as {checksum:string}|undefined;
      if(migration?.checksum!==checksum)throw new Error('数据库迁移校验不一致，拒绝写入');
      if(db.pragma('quick_check',{simple:true})!=='ok')throw new Error('数据库完整性检查失败');
      return new Repository(db);
    }catch(error){db.close();throw error;}
  }

  read():State {
    const state=initialState('');
    for(const table of tables){
      (state[table] as unknown[])=(this.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all() as {data:string}[]).map(r=>JSON.parse(r.data));
    }
    state.settings=JSON.parse((this.prepare('SELECT data FROM settings WHERE id=1').get() as {data:string}).data);
    return state;
  }

  execute(command:Command, operation?:{id:string;digest:string}):{result:unknown;state:State;patch:StatePatch;replayed:boolean} {
    return this.db.transaction(()=>{
      const state=this.read();
      if(operation){
        const old=state.operations.find(o=>o.id===operation.id);
        if(old){
          if(old.digest!==operation.digest)throw new DomainError('OPERATION_CONFLICT','同一操作标识不能用于不同请求');
          return {result:old.result,state,patch:{},replayed:true};
        }
      }
      const before=new Map(tables.map(t=>[t,new Map((state[t] as Array<{id?:string;seq?:number}>).map(row=>[row.id??row.seq,JSON.stringify(row)]))]));
      const previousSettings=JSON.stringify(state.settings);
      const patch:StatePatch={};
      const result=reduce(state,command);
      if(operation)state.operations.push({id:operation.id,digest:operation.digest,result});
      for(const table of tables){
        const cols=['id',...columns[table],'data'];
        const statement=this.prepare(`INSERT INTO ${table}(${cols.join(',')}) VALUES(${cols.map(()=>'?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${cols.slice(1).map(c=>`${c}=excluded.${c}`).join(',')}`);
        for(const value of state[table]){
          const row=value as unknown as Record<string,unknown>;
          const id=(row.id??row.seq) as string|number;
          const encoded=JSON.stringify(row);
          if(before.get(table)?.get(id)===encoded)continue;
          const values=columns[table].map(col=>col==='occupies'?Number(row.occupies):row[property[col]]);
          statement.run(id,...values,encoded);
          ((patch[table]??=[]) as unknown[]).push(value);
        }
      }
      const settings=JSON.stringify(state.settings);
      if(settings!==previousSettings){this.prepare('UPDATE settings SET data=? WHERE id=1').run(settings);patch.settings=state.settings;}
      return {result,state,patch,replayed:false};
    }).immediate();
  }
  close(){this.db.close();}
}
