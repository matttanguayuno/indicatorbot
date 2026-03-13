'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Opportunities', icon: '📊' },
  { href: '/alerts', label: 'Alerts', icon: '🔔' },
  { href: '/rules', label: 'Rules', icon: '📐' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 z-50" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div className="max-w-lg mx-auto flex justify-around">
        {navItems.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center py-3 px-4 text-xs transition-colors ${
                active ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              <span className="text-lg mb-0.5">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
