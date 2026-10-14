import { useQuery } from '@tanstack/react-query';
import { Clock, Fingerprint, Hash, Package, Tags } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { Crumb, PageHeader, PanelBar } from '@/components/layout/app-shell';
import { Monogram, Tag } from '@/components/bui/atoms';
import { RecordsTable } from '@/components/bui/records-table';
import { Empty, ErrorState, JsonView, Loading } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/utils';

export function PackagesPage() {
  const navigate = useNavigate();
  const packages = useQuery({ queryKey: ['packages'], queryFn: api.packages.list });
  const items = packages.data?.packages ?? [];
  return (
    <>
      <PanelBar left={<><Package className="size-4 text-muted" strokeWidth={1.6} /><span className="text-[13px] font-medium">Packages</span></>} />
      <div className="flex min-h-0 flex-1 flex-col">
        {packages.isLoading ? <Loading /> : packages.error ? <ErrorState error={packages.error} /> : !items.length ? <Empty icon={Package} title="No packages" /> : (
          <RecordsTable fill rows={items} getKey={(x) => x.packageId} onRowClick={(x) => { void navigate(`/packages/${x.packageId}`); }}
            columns={[
              { key: 'pkg', label: 'Package', icon: <Package />, width: '30%', sort: (x, y) => x.packageId.localeCompare(y.packageId), render: (x) => <span className="flex min-w-0 items-center gap-2"><Monogram text={x.packageId} /><span className="truncate">{x.packageId}</span></span> },
              { key: 'version', label: 'Latest version', icon: <Tags />, width: 150, render: (x) => x.latestVersion ? <Tag>{`v${x.latestVersion}`}</Tag> : <span className="text-ink-3">—</span> },
              { key: 'releases', label: 'Releases', icon: <Hash />, width: 110, align: 'right', sort: (x, y) => x.releaseCount - y.releaseCount, render: (x) => <span className="tabular-nums text-ink-2">{x.releaseCount}</span> },
              { key: 'digest', label: 'Content digest', icon: <Fingerprint />, render: (x) => <span className="font-mono text-[12px] text-ink-2">{x.latestContentDigest ? `${x.latestContentDigest.slice(0, 19)}…` : '—'}</span> },
              { key: 'updated', label: 'Last update', icon: <Clock />, width: 140, sort: (x, y) => x.updatedAt.localeCompare(y.updatedAt), render: (x) => <span className="text-ink-2">{relativeTime(x.updatedAt)}</span> }
            ]} />
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
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <div className="mx-auto w-full max-w-[760px] px-6 pb-16 pt-10">
          <h2 className="mb-4 text-[20px] font-semibold tracking-[-0.02em]">{packageId}</h2>
          {pkg.isLoading ? <Loading /> : pkg.error ? <ErrorState error={pkg.error} /> : <JsonView value={pkg.data} />}
        </div>
      </div>
    </>
  );
}
