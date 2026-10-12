import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, Geist_Mono } from 'next/font/google';
import './globals.css';
import { ToastProvider } from '@/components/ui/Toast';

const jakarta = Plus_Jakarta_Sans({ variable: '--font-jakarta', subsets: ['latin'], weight: ['400', '600', '700'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Tsuchinoco Ops',
  description: 'Stock, preorders, planning, and wrap-up for the circle.',
};

// The root layout only carries fonts and global CSS. The staff app (with its sign-in gate and
// data providers) lives in the (staff) route group; the public customer form lives under /f/.
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${jakarta.variable} ${geistMono.variable}`}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
