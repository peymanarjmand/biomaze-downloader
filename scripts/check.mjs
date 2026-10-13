import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const extension=path.join(root,'extension');
const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json'),'utf8'));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
assert.equal(manifest.manifest_version,3);
assert.equal(manifest.version,pkg.version,'Update package.json and manifest.json together');
const references=[manifest.background.service_worker,manifest.action.default_popup,...manifest.content_scripts.flatMap(c=>c.js)];
for(const name of references) assert(fs.existsSync(path.join(extension,name)),`Missing extension file: ${name}`);
let checked=0;
function scan(folder){
  for(const file of fs.readdirSync(folder,{withFileTypes:true})){
    const name=path.join(folder,file.name);
    if(file.isDirectory()) scan(name);
    else if(file.name.endsWith('.js')) {new vm.Script(fs.readFileSync(name,'utf8'),{filename:name});checked++;}
  }
}
scan(extension);
console.log(`Manifest ${manifest.version}: referenced files exist; ${checked} JavaScript files parse.`);
