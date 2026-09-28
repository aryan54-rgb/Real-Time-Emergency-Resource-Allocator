import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PulseRoute — Emergency Resource Allocator',
  description: 'HLTH02 MVP: real-time hospital resource allocation (simulated data).',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <footer className="footer">Demo MVP · all hospital data is simulated · not for clinical use</footer>
      </body>
    </html>
  );
}
