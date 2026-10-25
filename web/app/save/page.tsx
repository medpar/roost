import { Suspense } from 'react';
import QuickSave from './quick-save';

export const metadata = { title: 'Save' };

// Bookmarklet & share-target landing page: /save?url=&title=&text=&tags=&collection=
export default function SavePage() {
  return (
    <main className="center-page">
      <Suspense fallback={<span className="spinner" />}>
        <QuickSave />
      </Suspense>
    </main>
  );
}
