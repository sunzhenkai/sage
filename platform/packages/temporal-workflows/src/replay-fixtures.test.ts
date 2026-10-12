import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { DURABLE_REPLAY_CORPUS } from './replay-corpus.js';
const root=new URL('../fixtures/replay/',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8')) as {fixtures:{caseId:string;file:string;digest:string}[];negative:{caseId:string;file:string;expectedCode:string}[]};
const digest=(body:Uint8Array)=>`sha256:${createHash('sha256').update(body).digest('hex')}`;
describe('versioned replay fixture manifest',()=>{
  it('covers the declared compatibility inventory and verifies every fixture byte digest',async()=>{
    expect(manifest.fixtures).toHaveLength(7);
    expect(manifest.fixtures.map(x=>x.caseId)).toEqual(DURABLE_REPLAY_CORPUS.map(x=>x.caseId));
    for(const fixture of manifest.fixtures){
      const body=await readFile(new URL(fixture.file,root));
      expect(fixture.digest).toBe(digest(body));
      expect(DURABLE_REPLAY_CORPUS.find(item=>item.caseId===fixture.caseId)?.fixtureDigest).toBe(fixture.digest);
      expect(JSON.parse(body.toString()).expected).toBe('COMPATIBLE');
    }
  });
  it('keeps all three fail-closed negative fixtures',async()=>{
    expect(manifest.negative.map(x=>x.expectedCode)).toEqual(['REPLAY_NONDETERMINISTIC','REPLAY_UNKNOWN_SCHEMA','REPLAY_UNKNOWN_HISTORY']);
    for(const fixture of manifest.negative)expect(JSON.parse(await readFile(new URL(fixture.file,root),'utf8')).expected).toBe(fixture.expectedCode);
  });
});
