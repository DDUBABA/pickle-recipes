import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm,access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {build} from '../scripts/build.mjs';
import {contentHash} from '../scripts/catalog.mjs';
import {meta,files} from './helpers.mjs';
test('Build withholds unreviewed bundles, publishes reviewed hashes, and propagates blocking',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'pickle-build-'));
  try{
    for(const name of ['index.html','app.js','style.css','terms.html','terms.json','site.config.json','guide.md','llms.txt','LICENSE','favicon.svg','social-card.png','template'])await cp(name,path.join(root,name),{recursive:true});
    await mkdir(path.join(root,'.github'));await mkdir(path.join(root,'recipes',meta.id,'scripts'),{recursive:true});
    await writeFile(path.join(root,`recipes/${meta.id}/meta.json`),JSON.stringify(meta));
    for(const [name,content]of Object.entries(files))await writeFile(path.join(root,`recipes/${meta.id}/${name}`),content);
    await writeFile(path.join(root,'.github/release-state.json'),JSON.stringify({items:{},processedPrs:[]}));
    await build(root);let index=JSON.parse(await readFile(path.join(root,'dist/recipes/index.json'),'utf8'));assert.equal(index.items.length,0);
    await assert.rejects(access(path.join(root,`dist/recipes/${meta.id}/scripts/service.py`)));
    await writeFile(path.join(root,'.github/release-state.json'),JSON.stringify({items:{[meta.id]:{version:meta.version,hash:contentHash(meta,files)}},processedPrs:[1]}));
    await build(root);index=JSON.parse(await readFile(path.join(root,'dist/recipes/index.json'),'utf8'));assert.equal(index.items[0].version,'1.0');
    await writeFile(path.join(root,`recipes/${meta.id}/meta.json`),JSON.stringify({...meta,status:'blocked'}));
    await build(root);index=JSON.parse(await readFile(path.join(root,'dist/recipes/index.json'),'utf8'));assert.equal(index.items[0].status,'blocked');
    await writeFile(path.join(root,`recipes/${meta.id}/scripts/service.py`),'print("unreviewed change")');await build(root);index=JSON.parse(await readFile(path.join(root,'dist/recipes/index.json'),'utf8'));assert.equal(index.items.length,0);
  }finally{await rm(root,{recursive:true,force:true});}
});

