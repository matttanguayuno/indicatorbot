'use client';

import { useState, useEffect } from 'react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  // Show spinner briefly, then reveal the form
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 400);
    return () => clearTimeout(timer);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        window.location.href = '/';
      } else {
        setError('Invalid credentials');
      }
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-[#030712] flex items-center justify-center px-4">
      {/* Spinner — shown while page loads */}
      {!ready && (
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-[3px] border-[#1e3a5f] border-t-blue-500 rounded-full animate-spin" />
          <span className="text-gray-500 text-sm">Loading…</span>
        </div>
      )}

      {/* Login form — fades in */}
      {ready && (
        <div className="w-full max-w-sm animate-fade-in">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-blue-400">Indicator Bot</h1>
            <p className="text-gray-500 text-sm mt-1">AI Trading Signal Scanner</p>
          </div>

          <form onSubmit={handleSubmit} className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 text-sm focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 text-sm focus:outline-none focus:border-blue-500 transition-colors"
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white text-sm font-medium py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {loading && (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              )}
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>
      )}

      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
