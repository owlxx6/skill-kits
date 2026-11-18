import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {parse} from 'yaml';
import {createGitHubClient,type GitHubClient} from '../pipeline/lib/github';
import {extractRepo} from '../pipeline/extract';
import {gitBlobId,readLicenseCache,licenseCacheFile} from '../pipeline/lib/license';
import {readSafetyCache,readScanOverrides,safetyCacheFile,safetyCleared} from '../pipeline/lib/skill-safety';
import {CatalogSchema,ConfigSchema,CurationSchema,RepoMetaSchema,SkillRecordSchema} from '../pipeline/lib/schemas';
import {buildCollectionDirectory} from '../pipeline/lib/collection-directory';
import {loadReviews} from '../pipeline/run';
import {findSkillLocations} from '../pipeline/lib/skillfile';

const args=process.argv.slice(2);
const option=(name:string)=>{const i=args.indexOf(name);if(i<0||!args[i+1])throw Error(`Missing ${name}`);return args[i+1];};
const input=path.resolve(option('--input'));
if(!input.startsWith(path.resolve('.session-reviews')+path.sep))throw Error('Use an ignored .session-reviews input directory');
await mkdir(input,{recursive:true});
const json=async(p:string,fallback:any=undefined)=>{try{return JSON.parse(await readFile(p,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return fallback;throw e;}};
const save=async(p:string,data:unknown)=>writeFile(p,JSON.stringify(data,null,2)+'\n');
const existing=CatalogSchema.parse(await json('catalog.json'));
const config=ConfigSchema.parse(parse(await readFile('data/config.yaml','utf8')));
const curation=CurationSchema.parse(parse(await readFile('data/curation.yaml','utf8')));
const proposalIndex=args.indexOf('--propose');
const proposed=proposalIndex<0?[]:args[proposalIndex+1].split(',').map(value=>{
 const [kit,repo]=value.split('=');
 if(!existing.kits.some(k=>k.id===kit)||!repo||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))throw Error(`Invalid proposal: ${value}`);
 return {kit,repo};
});
if(proposed.length&&args.includes('--apply'))throw Error('Proposals require explicit curation approval before application');
for(const {kit,repo} of proposed){const entry=curation[kit]??={approved:[],rejected:[]};if(!entry.approved.includes(repo))entry.approved.push(repo);}
const approved=new Set(Object.values(curation).flatMap(c=>c.approved).filter(id=>!id.includes(':')));
const selected=option('--repos').split(',');
for(const repo of selected)if(!approved.has(repo))throw Error(`Repository is not approved: ${repo}`);
const licenses=readLicenseCache(await json(input+'/licenses.json'));
const safety=readSafetyCache(await json(input+'/safety.json'));
const remote=createGitHubClient(undefined,{retryDelayMs:500});
const trees=new Map<string,Awaited<ReturnType<GitHubClient['getTree']>>>();
const blobs=new Map<string,Promise<Uint8Array>>();
await mkdir(input+'/blobs',{recursive:true});
const gh:GitHubClient={...remote,
 async getTree(repo,ref){const key=repo+':'+ref;if(!trees.has(key))trees.set(key,await remote.getTree(repo,ref));return trees.get(key)!;},
 async getFileBytes(repo,ref,p){
  const tree=await gh.getTree(repo,ref);const blob=tree.entries.find(e=>e.path===p&&e.type==='blob');
  if(!blob)throw Error(`File absent from pinned tree: ${repo}/${p}`);
  if(!blobs.has(blob.sha))blobs.set(blob.sha,(async()=>{
   let bytes:Uint8Array|undefined;
   for(const root of [input+'/blobs',path.resolve('../skill-kits/.session-reviews/repository-waves/blobs')]){
    try{bytes=new Uint8Array(await readFile(root+'/'+blob.sha));break;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
   }
   bytes??=await remote.getFileBytes(repo,ref,p);
   if(gitBlobId(bytes)!==blob.sha)throw Error(`Blob mismatch: ${p}`);
   await writeFile(input+'/blobs/'+blob.sha,bytes);return bytes;
  })());
  return blobs.get(blob.sha)!;
 },
 async getFileText(repo,ref,p){return new TextDecoder('utf8',{fatal:true}).decode(await gh.getFileBytes(repo,ref,p));},
};
const records=[];
const checkArchive=(repo:{archived:boolean;fullName:string})=>{
 if(repo.archived)throw Error(`Archived repository: ${repo.fullName}`);
};
for(const name of selected){
 const cacheFile=input+'/'+name.replace('/','--')+'.json';
 const cached=await json(cacheFile);
 if(cached&&!args.includes('--refresh')){checkArchive(cached.repo);records.push(cached);console.log(`reuse ${name}: ${cached.skills.length} skills at ${cached.commit}`);continue;}
 console.log(`extract ${name}`);
 const meta=await gh.getRepo(name);if(!meta)throw Error(`Repository unavailable: ${name}`);
 checkArchive(meta);
 const refs=execFileSync('git',['ls-remote','--symref',meta.url+'.git','HEAD'],{encoding:'utf8',timeout:60000});
 const commit=refs.match(/^([0-9a-f]{40})\s+HEAD$/m)?.[1];if(!commit)throw Error(`No pinned HEAD: ${name}`);
 const repo=RepoMetaSchema.parse({...meta,defaultBranch:commit});
 const tree=await gh.getTree(name,commit);
 const result=await extractRepo(gh,repo,new Map(),licenses,{cache:safety,allowed:config.filter.allowedLicenses,scanAll:true,limits:{concurrency:8},checkpoint:async()=>{await save(input+'/safety.json',safetyCacheFile(safety));}});
 const record={repo,commit,skills:result.skills.map(s=>SkillRecordSchema.parse(s)),rawSkillCount:findSkillLocations(tree.entries).length,
  complete:!result.truncated&&result.invalid===0&&result.failedDownloads===0&&result.licenseFailedDownloads===0,
  invalid:result.invalid,failedDownloads:result.failedDownloads,truncated:result.truncated};
 records.push(record);await save(cacheFile,record);await save(input+'/licenses.json',licenseCacheFile(licenses));await save(input+'/safety.json',safetyCacheFile(safety));
 console.log(`done ${name}: ${record.skills.length} valid; ${record.invalid} invalid; ${record.failedDownloads} unread`);
 blobs.clear();trees.clear();
}
const result=buildCollectionDirectory({existing,repos:records.map(r=>r.repo),skills:records.flatMap(r=>r.skills),reviews:await loadReviews('data/cache/reviews'),curation,config,now:new Date(),
 isSafetyCleared:safetyCleared(safety,await readScanOverrides('data/scan-overrides.yaml')),
 completeRepos:new Set(records.filter(r=>r.complete).map(r=>r.repo.fullName)),repositoryTotals:new Map(records.map(r=>[r.repo.fullName,r.rawSkillCount]))});
await save(input+'/catalog-preview.json',result.catalog);await save(input+'/pending.internal.json',result.pending);
await save(input+'/manifest.internal.json',{date:new Date().toISOString(),proposed,ownerApproved:proposed.length===0,repositories:records.map(r=>({repo:r.repo.fullName,commit:r.commit,valid:r.skills.length,raw:r.rawSkillCount,complete:r.complete})),available:result.catalog.skills.length+(result.catalog.sourceSkills?.length??0),sourceListings:result.catalog.sourceSkills?.length??0,pending:result.pending.length});
if(args.includes('--apply'))await save('catalog.json',result.catalog);
console.log(JSON.stringify({available:result.catalog.skills.length+(result.catalog.sourceSkills?.length??0),reviewed:result.catalog.skills.length,sourceListings:result.catalog.sourceSkills?.length??0,pending:result.pending.length,applied:args.includes('--apply')}));
