import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
const require = createRequire(import.meta.url)
const vite = spawn(process.execPath, [path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), '--host','127.0.0.1'], {stdio:'inherit'})
let desktop
const cleanup = () => {desktop?.kill();vite.kill()}
process.on('SIGINT',cleanup);process.on('SIGTERM',cleanup)
try {
  let ready=false
  for(let n=0;n<80;n++) {try {if((await fetch('http://127.0.0.1:5173/')).ok){ready=true;break}}catch{};await new Promise(r=>setTimeout(r,250))}
  if(!ready) throw new Error('Không mở được Vite.')
  desktop=spawn(require('electron'),['.'],{stdio:'inherit',env:{...process.env,TASKFLOW_DEV:'1'}})
  desktop.on('error', e=>{console.error(e);cleanup();process.exitCode=1})
  desktop.on('exit', code=>{vite.kill();process.exitCode=code||0})
}catch(e){console.error(e);cleanup();process.exitCode=1}
