import {type Catalog, type CatalogCollection, type CatalogSkill, collectionInstallCommand, skillInstallCommand} from './catalog';

// Commands use literal CLI identifiers only; never interpolate arbitrary upstream prose.
export function hasInstallIdentifier(skill: Pick<CatalogSkill,'repo'|'name'|'installable'>): boolean {
  return skill.installable!==false&&/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(skill.repo)&&/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(skill.name);
}

export function canInstallRepository(catalog:Catalog, collection:CatalogCollection): boolean {
  if(collection.installScope!=='repository'||!collection.revision||!/^[a-f0-9]{40}$/.test(collection.revision)||collection.catalogSkillIds.length!==collection.skillCount)return false;
  const members=catalog.skills.filter(s=>s.repo===collection.id);
  return members.length===collection.skillCount&&collection.catalogSkillIds.every(id=>members.some(s=>s.id===id));
}

export function collectionCommands(catalog:Catalog, repo:string): string[] {
  const collection=catalog.collections.find(c=>c.id===repo);
  if(collection&&canInstallRepository(catalog,collection))return [collectionInstallCommand(repo,collection.revision)];
  const members=catalog.skills.filter(s=>s.repo===repo);
  const counts=new Map<string,number>();for(const s of members)counts.set(s.name,(counts.get(s.name)??0)+1);
  return members.filter(s=>hasInstallIdentifier(s)&&counts.get(s.name)===1).map(skillInstallCommand);
}

export function kitCommands(catalog:Catalog, repos:string[]):string[] {
  return [...new Set(repos.flatMap(repo=>collectionCommands(catalog,repo)))];
}
