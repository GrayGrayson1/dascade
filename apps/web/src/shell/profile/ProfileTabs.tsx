/** Profile modal body: "Profile" (name + avatar) and "Stats" (ratings + per-game stats). */
import { lazy, Suspense, useState } from 'react';
import { Spinner, Tabs } from '@dascade/ui';
import { ProfileEditor } from '../common.tsx';

const StatsPanel = lazy(() => import('./StatsPanel.tsx').then((m) => ({ default: m.StatsPanel })));

type Tab = 'profile' | 'stats';

export function ProfileTabs({ onSubmit }: { onSubmit?: () => void }) {
  const [tab, setTab] = useState<Tab>('profile');
  return (
    <div className="ps-tabs">
      <Tabs<Tab>
        label="Profile sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'profile', label: 'Profile' },
          { value: 'stats', label: 'Stats' },
        ]}
      />
      <div className="ps-tabs__body" role="tabpanel" aria-label={tab === 'profile' ? 'Profile' : 'Stats'}>
        {tab === 'profile' ? (
          <ProfileEditor onSubmit={onSubmit} />
        ) : (
          <Suspense fallback={<Spinner label="Loading stats" />}>
            <StatsPanel />
          </Suspense>
        )}
      </div>
    </div>
  );
}
