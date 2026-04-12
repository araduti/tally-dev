import type { Metadata } from 'next';
import { TRPCProvider } from '@/trpc/provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tally — AI-Powered Optimization',
  description: 'AI-powered optimization for your entire multi-distributor stack',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <TRPCProvider>{children}</TRPCProvider>
      </body>
    </html>
  );
}
