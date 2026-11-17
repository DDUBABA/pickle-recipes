import {nextVersion} from './validation.js';
export function releaseItem(current,metadata,prNumber,date) {
  if(current?.releases.some(release=>release.prNumber===prNumber))return current;
  if(metadata.type==='patch' && (!current||current.version!==metadata.baseVersion))throw new Error(`Base version conflict for PR #${prNumber}`);
  if(metadata.type!=='patch' && current)throw new Error(`Duplicate new item in PR #${prNumber}`);
  const version=current?nextVersion(current.version):'1.0';
  return {version,releases:[{version,baseVersion:metadata.baseVersion,date,type:metadata.type,summary:metadata.summary,submittedBy:metadata.submittedBy,prNumber},...(current?.releases || [])]};
}
