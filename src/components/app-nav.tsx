'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Opportunities', icon: '📊' },
  { href: '/watchlist', label: 'Watchlist', icon: '👁️' },
  { href: '/alerts', label: 'Alerts', icon: '🔔' },
  { href: '/trades', label: 'Trades', icon: '💹' },
  { href: '/settings', label: 'Settings', icon: '⚙️' },
];

// Extra items shown only on desktop sidebar
const desktopExtraItems = [
  { href: '/feedback', label: 'Feedback', icon: '📋', insertBefore: '/settings' },
];

export function AppNav() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <>
      {/* Desktop sidebar — hidden on mobile */}
      <nav className={`hidden lg:flex flex-col sticky top-0 h-screen overflow-y-auto bg-gray-900 border-r border-gray-800 p-4 gap-1 shrink-0 transition-all duration-200 ${collapsed ? 'w-16' : 'w-52'}`}>
        <div className="flex items-center justify-between mb-6">
          {!collapsed && <span className="text-lg font-bold text-blue-400 px-2">Indicator Bot</span>}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`text-gray-500 hover:text-gray-300 transition-colors ${collapsed ? 'mx-auto' : ''}`}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? '▸' : '◂'}
          </button>
        </div>
        {(() => {
          // Build desktop nav with extra items inserted
          const items = [...navItems];
          for (const extra of desktopExtraItems) {
            const idx = items.findIndex((i) => i.href === extra.insertBefore);
            if (idx >= 0) items.splice(idx, 0, extra);
            else items.push(extra);
          }
          return items;
        })().map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${collapsed ? 'justify-center' : ''} ${
                active
                  ? 'bg-gray-800 text-blue-400 font-medium'
                  : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>

      {/* Mobile bottom nav — hidden on desktop */}
      <nav className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800 z-50 lg:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="flex">
          {navItems.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex-1 flex items-center justify-center py-3 transition-colors ${
                  active ? 'text-blue-400' : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <span className="text-2xl">{item.icon}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
