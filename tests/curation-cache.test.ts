import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { CatalogSchema, ReviewRecordSchema, SourcesSchema } from "../pipeline/lib/schemas";
import { loadReviews } from "../pipeline/run";

const root=fileURLToPath(new URL("../",import.meta.url));
const json=async(file:string)=>JSON.parse(await readFile(path.join(root,file),"utf8"));

describe("four-kit curation survives a later rank",()=>{
  it("loads each pinned session review from the committed cache without private notes",async()=>{
    const evidence=await json("data/curation-evidence/four-kits-2026-11-17.json") as {id:string;fingerprint:string}[];
    const catalog=CatalogSchema.parse(await json("catalog.json"));
    const loaded=await loadReviews(path.join(root,"data/cache/reviews"));
    for(const entry of evidence){
      const record=ReviewRecordSchema.parse(await json(`data/cache/reviews/${entry.fingerprint}.json`));
      const published=catalog.skills.find(skill=>skill.id===entry.id);
      expect(published,entry.id).toBeDefined();
      expect(record.fingerprint).toBe(entry.fingerprint);
      expect(record.model).toBe("in-session-review");
      expect(record.review.security).toEqual({level:"none",notes:[]});
      expect(loaded.get(entry.fingerprint)).toEqual(published?.review);
    }
  });

  it("nominates every reviewed source rather than relying on topic discovery",async()=>{
    const evidence=await json("data/curation-evidence/four-kits-2026-11-17.json") as {id:string}[];
    const sources=SourcesSchema.parse(parse(await readFile(path.join(root,"data/sources.yaml"),"utf8")));
    for(const {id} of evidence){
      const repo=id.slice(0,id.indexOf(":"));
      expect(sources.repos,repo).toContain(repo);
      expect(sources.exclude??[],repo).not.toContain(repo);
    }
  });
});
