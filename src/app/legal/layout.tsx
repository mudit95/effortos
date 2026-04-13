import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import React from 'react';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  const pages = [
    { href: '/legal/terms', label: 'Terms & Conditions' },
    { href: '/legal/privacy', label: 'Privacy Policy' },
    { href: '/legal/refund', label: 'Cancellation & Refund' },
    { href: '/legal/shipping', label: 'Shipping & Exchange' },
    { href: '/legal/contact', label: 'Contact Us' },
  ];

  return (
    <div className="min-h-screen bg-[#0B0F14] text-white">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors mb-8"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to EffortOS
        </Link>

        <article className="
          [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:text-white [&_h1]:mb-2
          [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-white [&_h2]:mt-8 [&_h2]:mb-2
          [&_p]:text-sm [&_p]:text-white/70 [&_p]:leading-relaxed [&_p]:mt-3
          [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mt-2 [&_ul]:space-y-1.5
          [&_li]:text-sm [&_li]:text-white/70
          [&_strong]:text-white/90 [&_strong]:font-medium
          [&_a]:text-cyan-400 [&_a:hover]:underline
        ">
          {children}
        </article>

        <nav className="mt-16 pt-6 border-t border-white/[0.06] flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-white/30">
          {pages.map(p => (
            <Link key={p.href} href={p.href} className="hover:text-white/60 transition-colors">
              {p.label}
            </Link>
          ))}
        </nav>
        <p className="mt-4 text-[10px] text-white/20">© {new Date().getFullYear()} EffortOS. All rights reserved.</p>
      </div>
    </div>
  );
}

export const metadata = {
  robots: { index: true, follow: false },
};
