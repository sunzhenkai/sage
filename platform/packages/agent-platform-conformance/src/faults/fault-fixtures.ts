import { executeAuthorityFaultMatrix } from './execution.js';
export const faultEvidence = executeAuthorityFaultMatrix().cases;
export const byDomain = (domain: string) => faultEvidence.filter((item) => item.point.startsWith(`${domain}.`));
