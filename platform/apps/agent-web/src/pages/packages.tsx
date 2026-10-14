import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { Crumb, PageHeader } from '@/components/layout/app-shell';
import { Empty, ErrorState, JsonView, Loading, Mono } from '@/components/ui/misc';
import { Table, Td, Th, Tr } from '@/components/ui/table';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/utils';

export function PackagesPage() {
  const navigate = useNavigate();
  const packages = useQuery({ queryKey: ['packages'], queryFn: api.packages.list });
  return (
    <>
      <PageHeader title="Packages" meta={packages.data ? `${packages.data.packages.length}` : null} />
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {packages.isLoading ? <Loading /> : packages.error ? <ErrorState error={packages.error} /> : !packages.data?.packages.length ? <Empty title="No packages" /> : (
          <Table>
            <thead><tr><Th>Package</Th><Th>Latest</Th><Th>Releases</Th><Th>Digest</Th><Th className="text-right">Updated</Th></tr></thead>
            <tbody>{packages.data.packages.map((p) => (
              <Tr key={p.packageId} onClick={() => navigate(`/packages/${p.packageId}`)}>
                <Td className="font-medium">{p.packageId}</Td><Td><Mono>{p.latestVersion ?? '—'}</Mono></Td><Td className="text-muted">{p.releaseCount}</Td>
                <Td><Mono className="text-muted">{p.latestContentDigest?.slice(0, 19) ?? '—'}…</Mono></Td><Td className="text-right text-muted">{relativeTime(p.updatedAt)}</Td>
              </Tr>
            ))}</tbody>
          </Table>
        )}
      </div>
    </>
  );
}

export function PackageDetailPage() {
  const { packageId = '' } = useParams();
  const pkg = useQuery({ queryKey: ['package', packageId], queryFn: () => api.packages.get(packageId) });
  return (
    <>
      <PageHeader breadcrumb={<Crumb to="/packages">Packages</Crumb>} title={packageId} />
      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">{pkg.isLoading ? <Loading /> : pkg.error ? <ErrorState error={pkg.error} /> : <JsonView value={pkg.data} />}</div>
    </>
  );
}
