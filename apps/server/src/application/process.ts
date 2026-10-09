/** Identity lookup failures are unknown, never evidence that a process exited. */
export function definitelyGone(pid:number):boolean {
  try{process.kill(pid,0);return false;}
  catch(error){return (error as NodeJS.ErrnoException).code==='ESRCH';}
}
