import{expect,it}from'vitest';import{byDomain}from'./fault-fixtures.js';it('covers checkpoint commit and all resume incompatibilities',()=>expect(byDomain('checkpoint')).toHaveLength(8));
