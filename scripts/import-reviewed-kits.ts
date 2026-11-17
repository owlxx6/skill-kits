import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { parse, stringify } from "yaml";
import { createGitHubClient } from "../pipeline/lib/github";
import { findSkillLocations } from "../pipeline/lib/skillfile";
import { gitBlobId } from "../pipeline/lib/license";
import { scanSkillFiles, SAFETY_RULES_VERSION, type SafetyInputFile } from "../pipeline/lib/safety";
import { CatalogSchema, ConfigSchema, KitsSchema, CurationSchema, ReviewRecordSchema, SkillRecordSchema, RepoMetaSchema } from "../pipeline/lib/schemas";
import { buildCatalog } from "../pipeline/rank";

// Explicit local session import. No model calls and no changes to the scheduled pipeline.
// All scans/provenance stay in the private input folder. --apply is required to publish data locally.
const args = process.argv.slice(2);
const option = (name: string) => { const i=args.indexOf(name); if(i<0 || !args[i+1]) throw Error(`Missing ${name}`); return path.resolve(args[i+1]); };
const input=option("--input"), cache=option("--cache");
const json = async (file: string): Promise<unknown> => JSON.parse(await readFile(file,"utf8"));
const proposals = await json(path.join(input,"kit-proposals.json")) as {kits:Record<string,{usageOrder:{id:string}[]}>};
const expectedKits=["web-app","ui-design","data-analysis","workflow-automation"];
if(JSON.stringify(Object.keys(proposals.kits).sort())!==JSON.stringify([...expectedKits].sort())) throw Error("Unexpected kit scope");
const selections=new Map(expectedKits.map(id=>[id,proposals.kits[id].usageOrder.map(s=>s.id)]));
const selected=new Set([...selections.values()].flat());
const records = await json(path.join(input,"review-records.internal.json")) as {id:string;record:unknown}[];
const assessments = await json(path.join(input,"assessments.internal.json")) as {id:string;decision:string;commit:string;sourceUrl:string}[];
const skills = (await json(path.join(cache,"data/cache/skills.json")) as unknown[]).map(s=>SkillRecordSchema.parse(s));
const repos = (await json(path.join(cache,"data/cache/repos.json")) as unknown[]).map(s=>RepoMetaSchema.parse(s));
const config=ConfigSchema.parse(parse(await readFile("data/config.yaml","utf8")));
const kits=KitsSchema.parse(parse(await readFile("data/kits.yaml","utf8")));
const curation=CurationSchema.parse(parse(await readFile("data/curation.yaml","utf8")));
const original=CatalogSchema.parse(await json("catalog.json"));
const coverage=await json(path.join(input,"read-coverage.internal.json")) as {id:string;path:string;sha256:string}[];
const gh=createGitHubClient(undefined,{retryDelayMs:500});
const reviews=new Map();const cleared=new Set<string>();const reports:Record<string,unknown>={};
const trees=new Map<string,Awaited<ReturnType<typeof gh.getTree>>>();
const blobs=new Map<string,Promise<Uint8Array>>();
for(const id of selected){
 const skill=skills.find(s=>s.id===id), assessment=assessments.find(a=>a.id===id), entry=records.find(r=>r.id===id);
 if(!skill || !assessment || !entry || assessment.decision==="hold")throw Error(`Unreviewed/held selection: ${id}`);
 const record=ReviewRecordSchema.parse(entry.record);
 if(record.fingerprint!==skill.fingerprint)throw Error(`Stale review: ${id}`);
 if(!/^[a-f0-9]{40}$/.test(assessment.commit))throw Error("Missing pinned commit");
 for(const file of coverage.filter(f=>f.id===id)){
  const resolved=path.resolve(input,file.path);
  if(!resolved.startsWith(input+path.sep))throw Error("Read coverage outside input");
  const hash=createHash("sha256").update(await readFile(resolved)).digest("hex");
  if(hash!==file.sha256)throw Error(`Changed reviewed file: ${file.path}`);
 }
 if(!coverage.some(f=>f.id===id && f.path.endsWith("/SKILL.md")))throw Error(`No complete primary read: ${id}`);
 const key=skill.repo+":"+assessment.commit;
 if(!trees.has(key))trees.set(key,await gh.getTree(skill.repo,assessment.commit));
 const tree=trees.get(key)!;
 if(tree.truncated)throw Error(`Incomplete tree: ${skill.repo}`);
 const location=findSkillLocations(tree.entries).find(l=>l.dir===skill.path);
 if(location?.fingerprint!==skill.fingerprint)throw Error(`Upstream fingerprint mismatch: ${id}`);
 const prefix=skill.path==="."?"":skill.path+"/";
 const entries=tree.entries.filter(e=>e.type==="blob" && e.path.startsWith(prefix));
 if(entries.length>1500)throw Error(`Unbounded skill folder: ${id}`);
 const files:SafetyInputFile[]=[];
 // Eight downloads at a time; append in tree order for deterministic reports.
 for(let start=0;start<entries.length;start+=8){
  files.push(...await Promise.all(entries.slice(start,start+8).map(async e=>{
   if(e.mode==="120000")throw Error(`Unresolved symbolic link: ${e.path}`);
   if(!blobs.has(e.sha))blobs.set(e.sha,gh.getFileBytes(skill.repo,assessment.commit,e.path));
   const bytes=await blobs.get(e.sha)!;
   if(gitBlobId(bytes)!==e.sha)throw Error(`Downloaded blob mismatch: ${e.path}`);
   return isUtf8(bytes)&&!bytes.includes(0)?{path:e.path.slice(prefix.length),content:new TextDecoder().decode(bytes)}:{path:e.path.slice(prefix.length),size:bytes.length};
  })));
 }
 const report=scanSkillFiles(files);reports[id]={commit:assessment.commit,fingerprint:skill.fingerprint,rulesVersion:SAFETY_RULES_VERSION,report};
 await writeFile(path.join(input,"site-import-scans.internal.json"),JSON.stringify(reports,null,2)+"\n");
 if(report.verdict!=="clear")throw Error(`Admission stopped: ${id} requires scan review (${report.verdict})`);
 cleared.add(id);reviews.set(skill.fingerprint,record.review);
 console.log(`clear ${id} (${files.length} files)`);
}
for(const [kit,ids] of selections){
 const existing=curation[kit]??{approved:[],rejected:[]};
 curation[kit]={approved:[...new Set([...existing.approved,...ids])],rejected:existing.rejected.filter(id=>!selected.has(id))};
}
const generated=CatalogSchema.parse(buildCatalog({repos,skills,reviews,kits,curation,config,now:new Date(),isSafetyCleared:s=>cleared.has(s.id)}));
const imported=generated.skills.filter(s=>selected.has(s.id));
if(imported.length!==selected.size)throw Error("A selected skill failed license/review/ranking eligibility");
for(const skill of imported){
 const a=assessments.find(a=>a.id===skill.id)!;skill.url=a.sourceUrl;
 // Selection was authorized by the owner; the source-file review was performed in session.
 // Do not turn inclusion approval into the public claim "Reviewed by a human".
 skill.humanReviewed=false;
 if(skill.name==="data-analysis"){
  skill.review.summary="Explore CSV and spreadsheet data, report missing values, summarize patterns and create charts with pandas. Requires a compatible Python environment. Instructions were reviewed; runtime verification remains incomplete.";
  skill.review.cautions=["Requires Python 3.11+, pandas 3.x, matplotlib and seaborn","Exploratory correlations do not establish causation","Choose missing-value and sampling policies for the actual dataset; runtime verification is incomplete"];
 }
 if(skill.name==="pandas"){
  skill.review.summary="Prepare tabular data with explicit types, validated joins, pandas 3 assignment and resampling patterns, and Parquet export. This community-maintained reference complements the analysis workflow; runtime verification remains incomplete.";
  skill.review.cautions=["Requires compatible Python/pandas; Parquet needs pyarrow","Do not replace unknown amounts with zero without a business rule","Choose join cardinality for the actual data; runtime verification is incomplete"];
 }
 if(skill.licenseEvidence?.path)skill.licenseEvidence.url=`https://github.com/${skill.repo}/blob/${a.commit}/${skill.licenseEvidence.path}`;
 // Public-schema placeholder only, not a safety verdict. Original review and scan stay private.
 skill.review.security={level:"none",notes:[]};
}
const combined=CatalogSchema.parse({...original,generatedAt:generated.generatedAt,
 skills:[...original.skills.filter(s=>!selected.has(s.id)),...imported],
 kits:original.kits.map(kit=>{
  const ids=selections.get(kit.id);if(!ids)return kit;
  return {...kit,skills:[...new Set([...kit.skills,...ids])],pending:kit.pending.filter(id=>!selected.has(id)),
   proposals:{collections:kit.proposals.collections,skills:kit.proposals.skills.filter(s=>!selected.has(s.id))}};
 })});
const approval=Object.fromEntries([...selections].map(([kit,ids])=>[kit,{skillIds:ids,authorization:"Owner requested local pipeline completion and site integration in chat",reviewMethod:"session review; not a claim that owner read every source file"}]));
await mkdir(path.join(input,"site-import"),{recursive:true});
await writeFile(path.join(input,"site-import","approval.internal.json"),JSON.stringify(approval,null,2)+"\n");
await writeFile(path.join(input,"site-import","catalog-before.internal.json"),JSON.stringify(original,null,2)+"\n");
await writeFile(path.join(input,"site-import","catalog-preview.json"),JSON.stringify(combined,null,2)+"\n");
if(args.includes("--apply")){
 await writeFile("data/curation.yaml",stringify(curation));
 await writeFile("catalog.json",JSON.stringify(combined,null,2)+"\n");
}
console.log(JSON.stringify({selected:selected.size,clear:cleared.size,totalSkills:combined.skills.length,kits:[...selections].map(([id,skills])=>({id,count:skills.length})),applied:args.includes("--apply")}));
