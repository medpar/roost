import TroveApp from '@/components/app';
import { ToastProvider } from '@/components/ui';

export default function Home() {
  return (
    <ToastProvider>
      <TroveApp />
    </ToastProvider>
  );
}
