import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Performance Reviews | Brillar HR Portal',
  description: 'Track, manage, and collaborate on employee performance reviews.'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full bg-slate-50">
      <body className="min-h-full font-sans text-slate-900 antialiased">
        <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10 sm:px-10">
          <header className="mb-10 border-b border-slate-200 pb-6">
            <h1 className="text-3xl font-semibold text-slate-900">
              Performance Reviews
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Keep every review transparent, actionable, and aligned with Brillar HR standards.
            </p>
          </header>
          <main className="flex-1">{children}</main>
          <footer className="mt-12 border-t border-slate-200 pt-6 text-xs text-slate-500">
            Managed by Brillar HR Portal
          </footer>
        </div>
      </body>
    </html>
  );
}
