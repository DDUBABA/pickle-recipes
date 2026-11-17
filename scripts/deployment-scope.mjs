import {execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

// Explicit code paths: data, release ledgers, generated indexes and docs cannot deploy Pages.
export const sitePaths=['functions/','lib/','public/','template/','scripts/','migrations/','workers/'];
export const siteFiles=new Set(['index.html','app.js','style.css','terms.html','terms.json','site.config.json',
  'guide.md','llms.txt','LICENSE','favicon.svg','social-card.png','package.json','pnpm-lock.yaml','pnpm-workspace.yaml',
  'wrangler.jsonc','wrangler.bridge.jsonc','wrangler.bridge-domain.jsonc','wrangler.retention.jsonc',
  '.github/workflows/build-index.yml']);
export function requiresSiteDeployment(paths){
  return paths.some(file=>siteFiles.has(file)||sitePaths.some(prefix=>file.startsWith(prefix))||
    (file.startsWith('bridge/')&&!file.startsWith('bridge/sites/')&&!['bridge/index.json','bridge/hosts.json'].includes(file))||file==='bridge/sites/_schema.json');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const base=process.argv[2]||'origin/production';
  const paths=execFileSync('git',['diff','--name-only','--no-renames','-z',base,'HEAD'],{encoding:'utf8'}).split('\0').filter(Boolean);
  const deploy=requiresSiteDeployment(paths);
  console.log(`Site code changed: ${deploy}`);
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`deploy=${deploy}\n`);
}
