#!/usr/bin/env node
import fs from 'node:fs';
import readline from 'node:readline';
const log=process.env.METEOR_TEST_TERMINAL_LOG;
const mode=process.argv[6];
if(log)fs.appendFileSync(log,JSON.stringify({kind:'spawn',args:process.argv.slice(2)})+'\n');
process.stdout.write(JSON.stringify({type:'terminal.frame',seq:1,encoding:'ansi',width:120,height:32,full:true,bytes:Buffer.from('\u001b[2J\u001b[Hfixture terminal').toString('base64')})+'\n');
readline.createInterface({input:process.stdin}).on('line',line=>{
  const frame=JSON.parse(line);if(log)fs.appendFileSync(log,JSON.stringify({kind:'input',mode,frame})+'\n');
  if(frame.type==='terminal.release')process.exit(0);
});
setInterval(()=>{},1000);
