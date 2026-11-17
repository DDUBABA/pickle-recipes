import {mkdir,readFile,writeFile,copyFile,cp,rm} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {validate} from './validate.mjs';
import {readJson,contentHash} from './catalog.mjs';
import {readBridges,bridgeHash} from './bridges.mjs';
import {bridgeItem} from '../lib/bridge.js';
export async function build(root=process.cwd(),{indexOnly=false}={}) {
  const all=await validate(root);
  const terms=await readJson(path.join(root,'terms.json'));const config=await readJson(path.join(root,'site.config.json'));
  const ledger=await readJson(path.join(root,'.github/release-state.json'));
  const origin=new URL(process.env.SITE_URL || config.siteUrl).origin;
  const published=all.filter(({meta,files})=>ledger.items[meta.id]?.hash===contentHash(meta,files)&&meta.releases.length>0&&meta.version===ledger.items[meta.id].version);
  const sites=(await readBridges(root)).filter(site=>ledger.bridges?.[site.siteId]?.hash===bridgeHash(site));
  const bridgeItems=sites.map(site=>bridgeItem(site,ledger.bridges[site.siteId]));
  const items=[...published.map(({meta})=>meta),...bridgeItems];
  const hosts=Object.fromEntries(sites.flatMap(site=>[[`pickle-loginbridge--${site.siteId}.pages.dev`,site.siteId],[`${site.siteId}.login.pickle-recipes.com`,site.siteId]]));
  await mkdir(path.join(root,'bridge'),{recursive:true});
  await writeFile(path.join(root,'bridge/index.json'),JSON.stringify({schemaVersion:1,items:bridgeItems},null,2)+'\n');
  for(const name of ['hosts.json','bridge/hosts.json'])await writeFile(path.join(root,name),JSON.stringify(hosts,null,2)+'\n');
  const catalog={schemaVersion:1,affiliation:terms.affiliation,termsVersion:terms.termsVersion,guideUrl:'/guide.md',templateUrl:'/template/',termsUrl:'/terms.json',api:{consent:'/api/consent',verifyConsent:'/api/consent/verify',revokeConsent:'/api/consent/revoke',health:'/api/health',search:'/api/search',item:'/api/items/{id}',download:'/api/download',submit:'/api/submit',feedback:'/api/feedback',stats:'/api/stats'},items};
  const xmlEscape=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
  const sitemap=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/','/bridge/','/terms.html','/template/','/guide.md'].map(route=>`<url><loc>${xmlEscape(origin+route)}</loc></url>`).join('')}</urlset>\n`;
  await mkdir(path.join(root,'recipes'),{recursive:true});
  await writeFile(path.join(root,'recipes/index.json'),JSON.stringify(catalog,null,2)+'\n');
  await writeFile(path.join(root,'sitemap.xml'),sitemap);
  await writeFile(path.join(root,'robots.txt'),`User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${origin}/sitemap.xml\n`);
  if(indexOnly)return;
  const dist=path.resolve(root,'dist');
  if(path.dirname(dist)!==path.resolve(root))throw new Error('Unsafe output directory');
  await rm(dist,{recursive:true,force:true});await mkdir(path.join(dist,'recipes'),{recursive:true});
  for(const name of ['app.js','style.css','terms.html','terms.json','guide.md','llms.txt','robots.txt','sitemap.xml','LICENSE','favicon.svg','social-card.png'])await copyFile(path.join(root,name),path.join(dist,name));
  await copyFile(path.join(root,'recipes/index.json'),path.join(dist,'recipes/index.json'));
  await cp(path.join(root,'template'),path.join(dist,'template'),{recursive:true});
  await mkdir(path.join(dist,'bridge/sites'),{recursive:true});
  const apiOrigins=[...new Set(sites.filter(s=>s.mode==='api_token').map(s=>new URL(s.api.url).origin))];
  const bridgeCsp=`default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ${apiOrigins.join(' ')}; img-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'none'`;
  // Tests may build a recipe-only fixture; normal releases always include the engine.
  for(const name of ['app.js','core.js','style.css','index.json','hosts.json','sites/_schema.json']){
    try{await copyFile(path.join(root,'bridge',name),path.join(dist,'bridge',name));}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  try{const bridgeHtml=await readFile(path.join(root,'bridge/index.html'),'utf8');await writeFile(path.join(dist,'bridge/index.html'),bridgeHtml.replace(/(<meta http-equiv="Content-Security-Policy" content=")[^"]*(")/,`$1${bridgeCsp.replace("; frame-ancestors 'none'",'')}$2`));}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const site of sites)await writeFile(path.join(dist,`bridge/sites/${site.siteId}.json`),JSON.stringify(site,null,2)+'\n');
  await copyFile(path.join(root,'hosts.json'),path.join(dist,'hosts.json'));
  const html=(await readFile(path.join(root,'index.html'),'utf8')).replaceAll(config.siteUrl,origin);
  await writeFile(path.join(dist,'index.html'),html);
  await writeFile(path.join(dist,'404.html'),'<!doctype html><html lang="ko"><meta charset="utf-8"><title>찾을 수 없습니다</title><h1>페이지를 찾을 수 없습니다.</h1><a href="/">피클 레시피로 돌아가기</a></html>');
  const ld=html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  const hash=createHash('sha256').update(ld||'').digest('base64');
  await writeFile(path.join(dist,'_headers'),`/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Strict-Transport-Security: max-age=31536000\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-${hash}'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'\n/terms.json\n  Cache-Control: no-store\n/recipes/index.json\n  Cache-Control: no-cache\n`);
  await writeFile(path.join(dist,'_routes.json'),JSON.stringify({version:1,include:['/api/*'],exclude:[]}));
  // Remove the inherited main-site CSP before setting the bridge's tighter policy.
  const bridgeHeaders=`/bridge/*\n  ! Content-Security-Policy\n  Content-Security-Policy: ${bridgeCsp}\n  Cache-Control: no-store\n/hosts.json\n  Cache-Control: no-store\n`;
  const headersPath=path.join(dist,'_headers');await writeFile(headersPath,(await readFile(headersPath,'utf8'))+bridgeHeaders);
  await mkdir(path.join(root,'functions/_generated'),{recursive:true});
  const bundles=Object.fromEntries(published.map(({meta,files})=>[meta.id,{'meta.json':JSON.stringify(meta,null,2)+'\n',...files}]));
  for(const site of sites)bundles[site.siteId]={[`sites/${site.siteId}.json`]:JSON.stringify(site,null,2)+'\n'};
  await writeFile(path.join(root,'functions/_generated/catalog.js'),`// Generated by scripts/build.mjs. Server-only bundle.\nexport const terms=${JSON.stringify(terms)};\nexport const catalog=${JSON.stringify(catalog)};\nexport const bundles=${JSON.stringify(bundles)};\n`);
  console.log(`Built ${published.length} published items; ${all.length-published.length} pending items withheld.`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await build(process.cwd(),{indexOnly:process.argv.includes('--index-only')});
