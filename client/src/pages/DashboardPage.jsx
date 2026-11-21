import { useLanguage } from '../app/LanguageProvider.jsx';
import PageHeading from '../components/ui/PageHeading.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';

export default function DashboardPage() {
  const { t } = useLanguage();
  return <><PageHeading titleKey="dashboard.title" descriptionKey="dashboard.description" /><div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{['dashboard.metricNotices', 'dashboard.metricEvents', 'dashboard.metricUpdates', 'dashboard.metricAreas'].map((label) => <div key={label} className="rounded-2xl border border-line bg-white p-4"><p className="text-xs font-medium text-muted">{t(label)}</p><p className="mt-3 text-2xl font-semibold text-ink">—</p><p className="mt-1 text-[11px] text-muted">{t('dashboard.metricUnavailable')}</p></div>)}</div><EmptyState titleKey="dashboard.emptyTitle" descriptionKey="dashboard.emptyDescription" /></>;
}
