import { AuthProvider } from '@/lib/auth';
import { DataProvider } from '@/lib/data';
import { PrefsProvider } from '@/lib/prefs';
import { ImporterProvider } from '@/components/SubmissionImporter';
import AppShell from '@/components/AppShell';

export default function StaffLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthProvider>
      <DataProvider>
        <PrefsProvider>
          <ImporterProvider>
            <AppShell>{children}</AppShell>
          </ImporterProvider>
        </PrefsProvider>
      </DataProvider>
    </AuthProvider>
  );
}
