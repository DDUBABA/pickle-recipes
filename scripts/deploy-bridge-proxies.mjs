import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
const root=process.cwd(),target=path.join(root,'.local/bridge-proxy'),assets=path.join(target,'public');
await mkdir(assets,{recursive:true});
await copyFile('workers/bridge-router/index.js',path.join(assets,'_worker.js'));
await writeFile(path.join(assets,'index.html'),'<!doctype html><meta charset="utf-8"><title>Pickle Login Bridge</title>');
const projects=['pickle-loginbridge','pickle-loginbridge--smartthings-pat','pickle-loginbridge--dongtan-lakecity-visit-web','pickle-loginbridge--knocktown-appapi'];
// Only the four existing compatibility projects are changed; submissions cannot create projects.
for(const project of projects){
  await writeFile(path.join(target,'wrangler.jsonc'),JSON.stringify({name:project,pages_build_output_dir:'./public',compatibility_date:'2026-11-17',compatibility_flags:['global_fetch_strictly_public']}));
  execFileSync(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),'pages','deploy','public', '--project-name',project,'--branch','main','--commit-dirty=true'],{cwd:target,stdio:'inherit'});
}
