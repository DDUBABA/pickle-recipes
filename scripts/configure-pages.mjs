import {pathToFileURL} from 'node:url';
import {cloudflareClient} from './cloudflare.mjs';

export async function configurePages(api,project='pickle-recipes') {
  const route=`/pages/projects/${project}`;
  const current=await api(route);
  if(!current.source)throw new Error('Expected the existing Git-connected Pages project');
  // Native path filters bypass matching for large/empty pushes. Disabling Git
  // deployments makes data-only commits consume exactly zero Pages builds.
  const config={...current.source.config,production_deployments_enabled:false,preview_deployment_setting:'none',deployments_enabled:false};
  await api(route,{method:'PATCH',body:{source:{type:current.source.type,config}}});
  const verified=await api(route);
  if(verified.source.config.production_deployments_enabled!==false||verified.source.config.preview_deployment_setting!=='none')throw new Error('Pages automatic deployment settings were not applied');
  return {project,productionAutomatic:false,previewAutomatic:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(await configurePages(cloudflareClient())));
