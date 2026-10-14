import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { PageHeader } from '@/components/layout/app-shell';
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
      <div className="min-h-0 flex-1 overflow-auto">
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
      <PageHeader title={<span className="flex items-center gap-2"><Link to="/packages" className="text-muted hover:text-fg">Packages</Link><span className="text-muted">/</span>{packageId}</span>} />
      <div className="min-h-0 flex-1 overflow-auto p-4">{pkg.isLoading ? <Loading /> : pkg.error ? <ErrorState error={pkg.error} /> : <JsonView value={pkg.data} />}</div>
    </>
  );
}
