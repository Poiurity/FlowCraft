import { Activity, MonitorSmartphone, Code2, Database } from 'lucide-react';
import { useLang } from '../i18n/LanguageContext';

export type WorkspaceTab = 'activity' | 'preview' | 'code' | 'state';

interface Props {
  activeTab: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
}

const TABS: { id: WorkspaceTab; Icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'activity', Icon: Activity },
  { id: 'preview',  Icon: MonitorSmartphone },
  { id: 'code',     Icon: Code2 },
  { id: 'state',    Icon: Database },
];

export function WorkspaceTabs({ activeTab, onChange }: Props) {
  const { L } = useLang();
  return (
    <div className="workspace-tabs">
      {TABS.map(({ id, Icon }) => (
        <button
          key={id}
          className={`workspace-tab${activeTab === id ? ' workspace-tab--active' : ''}`}
          onClick={() => onChange(id)}
        >
          <Icon size={14} />
          <span>{L.tabs[id]}</span>
        </button>
      ))}
    </div>
  );
}
