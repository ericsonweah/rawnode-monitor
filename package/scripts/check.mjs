import { readFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { isBuiltin } from 'node:module';
const root=fileURLToPath(new URL('../',import.meta.url));
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
for(const key of ['dependencies','devDependencies','peerDependencies','optionalDependencies'])if(Object.keys(pkg[key]||{}).length)throw Error(`Forbidden ${key}`);
if(pkg.private!==true||pkg.scripts.prepublishOnly!=='node scripts/reject-publication.mjs')throw Error('Publication safeguards missing');
async function walk(dir){const files=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())files.push(...await walk(p));else if(/\.(js|mjs)$/.test(e.name))files.push(p)}return files}
const files=[...await walk(path.join(root,'src')),...await walk(path.join(root,'resources')),...await walk(path.join(root,'config'))];
for(const file of files){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status!==0)throw Error(result.stderr);const source=await readFile(file,'utf8');for(const m of source.matchAll(/(?:from\s*|import\s*\()(['"])([^'"]+)\1/g)){const spec=m[2];if(!spec.startsWith('.')&&!isBuiltin(spec))throw Error(`Non-native import ${spec} in ${file}`)}}
for(const [name,target]of Object.entries(pkg.exports)){const value=typeof target==='string'?{import:target}:target;for(const f of Object.values(value))await access(path.join(root,f));if(name!== './package.json'&&name!== './studio/client')await import(new URL('../'+value.import,import.meta.url));}
console.log(JSON.stringify({ok:true,checkedJavaScript:files.length,exports:Object.keys(pkg.exports).length,node:process.version}));
