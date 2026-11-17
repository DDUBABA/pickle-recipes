import {sitePattern} from '../bridge/core.js';
import {VERSION} from './validation.js';
export function assertBridgePr(metadata,files,current) {
  if(metadata?.artifactType!=='bridge'||!sitePattern.test(metadata.itemId||'')||metadata.itemId.length>43||!['new','patch'].includes(metadata.type))throw new Error('Invalid bridge metadata');
  const target=`bridge/sites/${metadata.itemId}.json`;
  if(files.length!==1||files[0].filename!==target||!['added','modified'].includes(files[0].status)||files[0].previous_filename)throw new Error('Bridge submission must change exactly one bridge/sites JSON; code and renames are forbidden');
  if(metadata.type==='new'?(metadata.baseVersion!==null||!!current):(!VERSION.test(metadata.baseVersion||'')||current?.version!==metadata.baseVersion))throw new Error('Bridge duplicate or stale baseVersion');
}
