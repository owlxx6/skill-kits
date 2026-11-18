import type {Catalog, CatalogSkill, CatalogSourceSkill, Config, Curation, RepoMeta, Review, SkillRecord} from './schemas';
import {CatalogSchema} from './schemas';
import {publication, licenseCategory, licenseLabel, type SafetyCleared} from './license';
import {licenseEvidenceOf} from '../rank';
import {repoSignal, reviewScore, skillScore} from './scores';

export interface DirectoryInput {
  existing: Catalog;
  repos: RepoMeta[];
  skills: SkillRecord[];
  reviews: Map<string, Review>;
  curation: Curation;
  config: Config;
  now: Date;
  isSafetyCleared: SafetyCleared;
  // True only after a complete tree and all primary files were successfully processed.
  completeRepos: ReadonlySet<string>;
  repositoryTotals?: ReadonlyMap<string,number>;
}

export function buildCollectionDirectory(input: DirectoryInput) {
  const {existing, repos, skills, reviews, curation, config, now}=input;
  const approved=new Set(Object.values(curation).flatMap(c=>c.approved).filter(id=>!id.includes(':')).map(id=>id.toLowerCase()));
  const existingReviewed=new Map(existing.skills.map(s=>[s.id,s]));
  const reviewed=new Map(existingReviewed);
  const source=new Map((existing.sourceSkills??[]).map(s=>[s.id,s]));
  const collections=new Map(existing.collections.map(c=>[c.id,c]));
  const processed=new Set<string>();
  const pending: {id:string;reason:string}[]=[];
  for(const repo of repos){
    if(!approved.has(repo.fullName.toLowerCase()))continue;
    if(repo.archived)throw Error(`Archived repository: ${repo.fullName}`);
    processed.add(repo.fullName);
    const members=skills.filter(s=>s.repo===repo.fullName);
    const nameCounts=new Map<string,number>();for(const s of members)nameCounts.set(s.name,(nameCounts.get(s.name)??0)+1);
    // Replace only the explicitly refreshed repositories; keep all unrelated records.
    for(const [id,s] of reviewed)if(s.repo===repo.fullName)reviewed.delete(id);
    for(const [id,s] of source)if(s.repo===repo.fullName)source.delete(id);
    const listed:string[]=[],labels=new Set<string>();
    const signal=repoSignal(repo,now,config.scoring);
    for(const skill of members){
      labels.add(skill.license ? licenseLabel(skill.license) : 'Unclear license');
      const status=publication(skill,config.filter.allowedLicenses,input.isSafetyCleared);
      const review=reviews.get(skill.fingerprint);
      const blocked=review?.security.level==='severe';
      if(!input.isSafetyCleared(skill)||status.status!=='publishable'||blocked){
        pending.push({id:skill.id,reason:blocked?'requires safety assessment':status.status==='waiting'?status.reason:'awaiting current scan clearance'});
        continue;
      }
      const license=skill.license!;
      const metadata={id:skill.id,repo:skill.repo,path:skill.path,name:skill.name,description:skill.description,
        url:`${repo.url}/tree/${repo.defaultBranch}/${skill.path}`,license:licenseLabel(license),
        licenseOutcome:license.outcome,licenseCategory:licenseCategory(license,config.filter.allowedLicenses),
        licenseEvidence:licenseEvidenceOf(skill,repo),stars:repo.stars,forks:repo.forks,pushedAt:repo.pushedAt,
        repoSignal:signal,humanReviewed:false as const,installable:nameCounts.get(skill.name)===1&&/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(skill.name)};
      listed.push(skill.id);
      if(review){
        const value=reviewScore(review.scores);
        const entry:CatalogSkill={...metadata,review:{...review,security:{level:'none',notes:[]}},reviewScore:value,score:skillScore(value,signal,config.scoring)};
        reviewed.set(skill.id,entry);
      }else{
        const entry:CatalogSourceSkill={...metadata,reviewStatus:'unreviewed'};source.set(skill.id,entry);
      }
    }
    const old=collections.get(repo.fullName);
    const enough=new Set(members.map(s=>s.fingerprint)).size>=config.collection.minSkills;
    if((enough||old)&&listed.length){
      const complete=input.completeRepos.has(repo.fullName);
      const total=complete?members.length:Math.max(input.repositoryTotals?.get(repo.fullName)??old?.skillCount??0,members.length);
      if(total>members.length)labels.add('Unclear license');
      collections.set(repo.fullName,{id:repo.fullName,url:repo.url,description:repo.description,
        license:labels.size===1?[...labels][0]:'Mixed',licenses:[...labels].sort(),stars:repo.stars,forks:repo.forks,
        pushedAt:repo.pushedAt,repoSignal:signal,skillCount:total,catalogSkillIds:listed,
        kitScores:old?.kitScores??{},humanReviewed:false,
        installScope:complete&&members.length===listed.length?'repository':'listed'});
      if(/^[a-f0-9]{40}$/.test(repo.defaultBranch))collections.get(repo.fullName)!.revision=repo.defaultBranch;
    }else collections.delete(repo.fullName);
  }
  const visibleIds=new Set([...reviewed.keys(),...source.keys()]);
  const catalog=CatalogSchema.parse({...existing,generatedAt:now.toISOString(),skills:[...reviewed.values()],sourceSkills:[...source.values()],collections:[...collections.values()],
    kits:existing.kits.map(kit=>{
      const decisions=curation[kit.id];
      const additions=(decisions?.approved??[]).flatMap(id=>{const canonical=[...processed].find(repo=>repo.toLowerCase()===id.toLowerCase());return canonical&&collections.has(canonical)?[canonical]:[];});
      return {...kit,collections:[...new Set([...kit.collections.filter(id=>!processed.has(id)||collections.has(id)),...additions])],
        skills:kit.skills.filter(id=>visibleIds.has(id)),pending:[...new Set([...kit.pending.filter(id=>!visibleIds.has(id)&&!collections.has(id)),...kit.skills.filter(id=>!visibleIds.has(id)),...(decisions?.approved??[]).filter(id=>processed.has(id)&&!collections.has(id))])]};
    })});
  return {catalog,pending};
}
