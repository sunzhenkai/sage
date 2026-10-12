import { createHash } from 'node:crypto';
export class SeededId { private sequence=0; constructor(readonly seed:string){if(seed.length===0)throw new TypeError('SEED_INVALID');} next(namespace:string):string{this.sequence+=1;return `${namespace}-${createHash('sha256').update(`${this.seed}:${namespace}:${this.sequence}`).digest('hex').slice(0,24)}`;} }
