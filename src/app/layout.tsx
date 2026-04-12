import type { Metadata, Viewport } from 'next';
import { TRPCProvider } from '@/trpc/provider';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Tally — AI-Powered Optimization',
    template: '%s | Tally',
  },
  description:
    'AI-powered optimization for your entire multi-distributor stack. Analyze usage, cut waste, stay compliant, and buy what you need — all in one place.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? 'https://tally.app'),
  openGraph: {
    title: 'Tally — AI-Powered Optimization',
    description:
      'Analyze usage, cut waste, stay compliant, and buy what you need — all in one place.',
    type: 'website',
    siteName: 'Tally',
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <TRPCProvider>{children}</TRPCProvider>
      </body>
    </html>
  );
}
