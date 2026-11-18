import {describe,it,expect} from 'vitest';
import {buildCollectionDirectory,type DirectoryInput} from '../pipeline/lib/collection-directory';
import {buildCatalog} from '../pipeline/rank';
import {CatalogSourceSkillSchema} from '../pipeline/lib/schemas';
import {NOW,testConfig,testKits,makeRepo,makeSkill,makeReview,fp} from './fixtures';
import {parseCatalog,kitsOfSkill,topSkillPerRepo} from '../site/src/lib/catalog';
import {collectionCommands,canInstallRepository,hasInstallIdentifier} from '../site/src/lib/installation';
import {searchDocuments} from '../site/src/lib/search';
import {FakeGitHub} from './fakes';
import {scanWaitingSkills,summarizeSafety,type SafetyCache} from '../pipeline/lib/skill-safety';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {stringify} from 'yaml';
import {runPipeline} from '../pipeline/run';

function setup(overrides:Partial<DirectoryInput>={}){
 const repo=makeRepo();
 const skills=['a','b','c'].map((name,i)=>makeSkill({id:`acme/skills:skills/${name}`,path:`skills/${name}`,name,fingerprint:fp(String(i+1))}));
 const existing=buildCatalog({repos:[],skills:[],reviews:new Map(),kits:testKits,curation:{},config:testConfig,now:NOW});
 return {existing,repos:[repo],skills,reviews:new Map(),curation:{'resume-career':{approved:['acme/skills'],rejected:[]}},config:testConfig,now:NOW,isSafetyCleared:()=>true,completeRepos:new Set(['acme/skills']),...overrides} satisfies DirectoryInput;
}
describe('complete collection directory',()=>{
 it('preserves source listings through the real extract and rank handlers without model calls',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'skill-directory-'));
  try{
   await mkdir(path.join(root,'data/cache'),{recursive:true});
   const input=setup();
   await writeFile(path.join(root,'data/config.yaml'),stringify(testConfig));
   await writeFile(path.join(root,'data/kits.yaml'),stringify(testKits));
   await writeFile(path.join(root,'data/curation.yaml'),stringify(input.curation));
   await writeFile(path.join(root,'data/cache/repos.json'),JSON.stringify(input.repos));
   await writeFile(path.join(root,'catalog.json'),JSON.stringify({...input.existing,sourceSkills:[]}));
   const files=Object.fromEntries(['a','b','c'].map(name=>[`skills/${name}/SKILL.md`,`---\nname: ${name}\ndescription: Resume ${name}\n---\nHarmless documented task ${name}.\n`]));
   const gh=new FakeGitHub([{meta:input.repos[0],files}]);
   await runPipeline({root,dryRun:false,steps:['extract','rank']},{gh,getLlm:()=>{throw Error('Unexpected model call');},now:NOW,log:()=>{}});
   const result=JSON.parse(await readFile(path.join(root,'catalog.json'),'utf8'));
   expect(result.sourceSkills).toHaveLength(3);expect(result.collections[0].catalogSkillIds).toHaveLength(3);
   const reports=JSON.parse(await readFile(path.join(root,'data/cache/safety.json'),'utf8'));
   expect(Object.keys(reports.entries)).toHaveLength(3);
   gh.failTreeFor.add('acme/skills');
   await runPipeline({root,dryRun:false,steps:['extract','rank']},{gh,getLlm:()=>{throw Error('Unexpected model call');},now:NOW,log:()=>{}});
   const failed=JSON.parse(await readFile(path.join(root,'catalog.json'),'utf8'));
   expect(failed.sourceSkills).toHaveLength(0);
   expect(failed.kits[0].pending).toContain('acme/skills');
  }finally{
   if(!path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'skill-directory-'))throw Error('Unexpected cleanup path');
   await rm(root,{recursive:true,force:true});
  }
 });
 it('scans permissive members in explicit directory mode and retains their reports',async()=>{
  const repo=makeRepo(),skill=makeSkill(),cache:SafetyCache={};
  const gh=new FakeGitHub([{meta:repo,files:{'skills/a/SKILL.md':'Read this harmless guide.'}}]);
  const tree=await gh.getTree(repo.fullName);
  const counts=await scanWaitingSkills(gh,repo,tree,[skill],{allowed:['MIT'],cache,scanAll:true});
  expect(counts.scanned).toBe(1);expect(cache[skill.id].verdict).toBe('clear');
  expect(summarizeSafety([skill],['MIT'],cache,counts,[repo.fullName]).stats.clear).toBe(1);
  expect(cache[skill.id]).toBeDefined();
 });
 it('lists unreviewed members without invented editorial fields',()=>{
  const {catalog,pending}=buildCollectionDirectory(setup());
  expect(catalog.sourceSkills).toHaveLength(3);expect(catalog.skills).toHaveLength(0);expect(pending).toEqual([]);
  for(const member of catalog.sourceSkills!){expect(member.review).toBeUndefined();expect(member.reviewScore).toBeUndefined();expect(member.humanReviewed).toBe(false);}
  expect(catalog.collections[0].installScope).toBe('repository');
 });
 it('keeps low scoring reviews in inventory but outside recommendations',()=>{
  const input=setup();input.reviews.set(input.skills[0].fingerprint,makeReview({scores:{clarity:2,completeness:2,usefulness:2}}));
  const catalog=buildCollectionDirectory(input).catalog;
  expect(catalog.skills[0].reviewScore).toBe(2);expect(catalog.sourceSkills).toHaveLength(2);
  expect(topSkillPerRepo(parseCatalog(catalog),5)).toHaveLength(0);
 });
 it('does not admit a blocked or unscanned member merely because its license is permissive',()=>{
  const result=buildCollectionDirectory(setup({isSafetyCleared:s=>s.name!=='b'}));
  expect(result.catalog.sourceSkills?.map(s=>s.name)).toEqual(['a','c']);expect(result.pending).toHaveLength(1);
  expect(result.catalog.collections[0].installScope).toBe('listed');
  expect(collectionCommands(parseCatalog(result.catalog),'acme/skills')).toEqual(['npx skills add acme/skills --skill a','npx skills add acme/skills --skill c']);
 });
 it('keeps an incomplete tree from enabling an unfiltered installation',()=>{
  const catalog=buildCollectionDirectory(setup({completeRepos:new Set(),repositoryTotals:new Map([['acme/skills',9]])})).catalog;
  expect(catalog.collections[0].skillCount).toBe(9);expect(catalog.collections[0].installScope).toBe('listed');
 });
 it('rejects severe editorial findings and sanitizes private review notes',()=>{
  const input=setup();input.reviews.set(input.skills[0].fingerprint,makeReview({security:{level:'severe',notes:['PRIVATE FINDING']}}));
  input.reviews.set(input.skills[1].fingerprint,makeReview({security:{level:'notice',notes:['PRIVATE FINDING']}}));
  const result=buildCollectionDirectory(input);expect(result.pending).toHaveLength(1);
  expect(JSON.stringify(result.catalog)).not.toContain('PRIVATE FINDING');
 });
 it('preserves unrelated published records and collections',()=>{
  const input=setup();input.existing=buildCatalog({repos:[makeRepo({fullName:'other/repo'})],skills:[makeSkill({id:'other/repo:x',repo:'other/repo',path:'x'})],reviews:new Map([[fp('a'),makeReview()]]),kits:testKits,curation:{},config:testConfig,now:NOW});
  const result=buildCollectionDirectory(input).catalog;
  expect(result.skills.find(s=>s.repo==='other/repo')).toEqual(input.existing.skills[0]);
 });
 it('assigns collection members to their kit in search without adding fake individual recommendations',()=>{
  const catalog=parseCatalog(buildCollectionDirectory(setup()).catalog),member=catalog.skills[0];
  expect(kitsOfSkill(catalog,member.id).map(k=>k.id)).toEqual(['resume-career']);
  expect(searchDocuments(catalog).find(d=>d.id==='skill:'+member.id)).toMatchObject({rating:null,kits:['resume-career'],reviewStatus:'Source listing · not editorially reviewed'});
  expect(catalog.kits[0].skills).toEqual([]);
 });
 it('requires explicit complete scope even for a legacy collection with equal counts',()=>{
  const catalog=parseCatalog(buildCollectionDirectory(setup()).catalog);delete catalog.collections[0].installScope;
  expect(canInstallRepository(catalog,catalog.collections[0])).toBe(false);expect(collectionCommands(catalog,'acme/skills')).toHaveLength(3);
 });
 it('pins a complete repository installation to the revision actually inspected',()=>{
  const input=setup({repos:[makeRepo({defaultBranch:fp('a')})]});
  const catalog=parseCatalog(buildCollectionDirectory(input).catalog);
  expect(canInstallRepository(catalog,catalog.collections[0])).toBe(true);
  expect(collectionCommands(catalog,'acme/skills')).toEqual([`npx skills add acme/skills@${fp('a')}`]);
 });
 it('recognizes an approval whose repository casing differs from the canonical name',()=>{
  const input=setup({curation:{'resume-career':{approved:['ACME/SKILLS'],rejected:[]}}});
  const catalog=buildCollectionDirectory(input).catalog;
  expect(catalog.sourceSkills).toHaveLength(3);expect(catalog.kits[0].collections).toEqual(['acme/skills']);
 });
 it('keeps duplicate install names unavailable when a matching member is held',()=>{
  const input=setup();input.skills[1].name='a';input.isSafetyCleared=s=>s.path!=='skills/b';
  const catalog=parseCatalog(buildCollectionDirectory(input).catalog);
  expect(catalog.skills.find(s=>s.name==='a')?.installable).toBe(false);
  expect(collectionCommands(catalog,'acme/skills')).toEqual(['npx skills add acme/skills --skill c']);
 });
 it('does not allow upstream text to inject shell commands',()=>{
  expect(hasInstallIdentifier({repo:'acme/skills',name:'safe;curl evil'})).toBe(false);
  expect(hasInstallIdentifier({repo:'acme/skills',name:'$(evil)'})).toBe(false);
 });
 it('refuses fabricated review fields on source records',()=>{
  const member=buildCollectionDirectory(setup()).catalog.sourceSkills![0];
  expect(CatalogSourceSkillSchema.safeParse({...member,review:makeReview()}).success).toBe(false);
  expect(CatalogSourceSkillSchema.safeParse({...member,reviewScore:0}).success).toBe(false);
 });
 it('keeps older useful sources eligible while preserving the archive gate',()=>{
  expect(()=>buildCollectionDirectory(setup({repos:[makeRepo({archived:true})]}))).toThrow(/Archived repository/);
  expect(buildCollectionDirectory(setup({repos:[makeRepo({pushedAt:'2020-01-01T00:00:00Z'})]})).catalog.sourceSkills).toHaveLength(3);
 });
});
