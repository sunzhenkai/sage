import type { IdentityVerificationPort, TrustedPrincipal } from '@sage/platform-ports';
export interface ProductionRequestLike { readonly headers: Readonly<Record<string, string | string[] | undefined>>; readonly body?: unknown; readonly query?: unknown }
export async function authenticateProductionRequest(request: ProductionRequestLike, input: { readonly verifier: IdentityVerificationPort; readonly audience: string; readonly nonce?: string; readonly now?: () => Date }): Promise<TrustedPrincipal> {
  const authorization=request.headers.authorization;const header=Array.isArray(authorization)?authorization[0]:authorization;if(!header?.startsWith('Bearer '))throw new Error('IDENTITY_INVALID');
  const principal=await input.verifier.verify({bearerToken:header.slice(7),expectedAudience:input.audience,...(input.nonce===undefined?{}:{expectedNonce:input.nonce}),now:(input.now??(()=>new Date()))().toISOString()});
  for(const source of[request.body,request.query])if(source&&typeof source==='object'){const candidate=source as Record<string,unknown>;for(const key of['tenantId','tenant_id','principalRef','principal_ref','maximumScopes','claims'])if(key in candidate)throw new Error('UNTRUSTED_IDENTITY_OVERRIDE');}
  return principal;
}
