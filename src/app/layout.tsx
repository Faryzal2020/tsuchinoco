import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, Geist_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { DataProvider } from '@/lib/data';
import { PrefsProvider } from '@/lib/prefs';
import { ToastProvider } from '@/components/ui/Toast';
import AppShell from '@/components/AppShell';

const jakarta = Plus_Jakarta_Sans({ variable: '--font-jakarta', subsets: ['latin'], weight: ['400', '600', '700'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Tsuchinoco Ops',
  description: 'Stock, preorders, planning, and wrap-up for the circle.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${jakarta.variable} ${geistMono.variable}`}>
        <ToastProvider>
          <AuthProvider>
            <DataProvider>
              <PrefsProvider>
                <AppShell>{children}</AppShell>
              </PrefsProvider>
            </DataProvider>
          </AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
