import type { AuthenticatedPrincipal } from '@sage/app-contracts';

export class CatalogAuthorizationError extends Error {
  readonly code: 'CATALOG_AUTHENTICATION_REQUIRED' | 'CATALOG_SYNC_FORBIDDEN';
  constructor(code: CatalogAuthorizationError['code'], message: string) { super(message); this.code = code; }
}

export function requireCatalogReadPrincipal(principal: AuthenticatedPrincipal | undefined): AuthenticatedPrincipal {
  if (principal === undefined || principal.authenticationId.length === 0 || principal.principalId.length === 0 || principal.tenantId.length === 0) {
    throw new CatalogAuthorizationError('CATALOG_AUTHENTICATION_REQUIRED', 'Authenticated workspace principal required');
  }
  return principal;
}

export function requireCatalogAdmin(principal: AuthenticatedPrincipal | undefined): AuthenticatedPrincipal {
  const authenticated = requireCatalogReadPrincipal(principal);
  if (!authenticated.roles.includes('provider-catalog-admin')) {
    throw new CatalogAuthorizationError('CATALOG_SYNC_FORBIDDEN', 'Provider Catalog admin role required');
  }
  return authenticated;
}
