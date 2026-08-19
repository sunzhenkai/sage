import{expect,it}from'vitest';import{byDomain}from'./fault-fixtures.js';it('covers body, metadata, finalize and response-loss windows',()=>expect(byDomain('artifact')).toHaveLength(4));
