import { useQuery } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { Crumb, PageHeader, PanelBar } from '@/components/layout/app-shell';
import { ListGroup, ListRow, Pill, RowId, RowMeta, RowTitle } from '@/components/ui/list';
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
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {packages.isLoading ? <Loading /> : packages.error ? <ErrorState error={packages.error} /> : !items.length ? <Empty icon={Package} title="No packages" /> : (
          <ListGroup icon={<Package className="size-3.5 text-muted" />} label="Registered" count={items.length}>
            {items.map((p) => (
              <ListRow key={p.packageId} onClick={() => navigate(`/packages/${p.packageId}`)}>
                <RowId>{p.latestContentDigest?.slice(7, 15) ?? 'PKG'}</RowId>
                <RowTitle sub={`${p.releaseCount} release${p.releaseCount === 1 ? '' : 's'}`}>{p.packageId}</RowTitle>
                <RowMeta>{p.latestVersion ? <Pill color="var(--green)">v{p.latestVersion}</Pill> : null}<span className="w-14 text-right text-faint">{relativeTime(p.updatedAt).replace(' ago', '')}</span></RowMeta>
              </ListRow>
            ))}
          </ListGroup>
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
