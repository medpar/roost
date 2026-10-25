import SettingsView from './settings-view';
import { ToastProvider } from '@/components/ui';

export const metadata = { title: 'Settings & integrations' };

export default function Settings() {
  return (
    <ToastProvider>
      <SettingsView />
    </ToastProvider>
  );
}
