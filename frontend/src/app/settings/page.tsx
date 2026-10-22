'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, ShieldAlert, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { meApi } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';

export default function SettingsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, clearAuth } = useAuth();
  const [busy, setBusy] = useState<'data' | 'account' | null>(null);

  const deleteData = async () => {
    if (!confirm('Delete ALL your projects, build history, logs and generated files? This cannot be undone.')) return;
    setBusy('data');
    try {
      const r = await meApi.deleteData();
      queryClient.invalidateQueries();
      toast.success(`Deleted ${r.deletedProjects} project(s) and their files`);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Deletion failed');
    } finally {
      setBusy(null);
    }
  };

  const deleteAccount = async () => {
    if (!confirm('Permanently delete your account and everything attached to it?')) return;
    setBusy('account');
    try {
      await meApi.deleteAccount();
      clearAuth();
      toast.success('Account deleted');
      router.push('/');
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Deletion failed');
      setBusy(null);
    }
  };

  return (
    <AppShell>
      <div className="p-8 max-w-3xl space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-gray-400 mt-1">{user?.email}</p>
        </div>

        <div className="glass rounded-xl p-5 space-y-2">
          <h2 className="text-white font-semibold flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-yellow-400" /> Data retention
          </h2>
          <p className="text-gray-400 text-sm">
            Build artifacts (APK/AAB, QR codes) and project sources are deleted automatically 24 hours after your
            last build. You can also delete everything yourself at any time.
          </p>
        </div>

        <div className="glass rounded-xl p-5 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-white font-medium">Delete my build history and files</h3>
            <p className="text-gray-500 text-sm">Removes all projects, builds, logs, AI fixes and generated files. Your account stays.</p>
          </div>
          <button
            onClick={deleteData}
            disabled={busy !== null}
            className="flex items-center gap-2 border border-red-500/40 text-red-400 hover:bg-red-500/10 px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {busy === 'data' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Delete data
          </button>
        </div>

        <div className="glass rounded-xl p-5 flex items-center justify-between gap-4 border border-red-500/20">
          <div>
            <h3 className="text-white font-medium">Delete my account</h3>
            <p className="text-gray-500 text-sm">Permanently removes your account and all associated data.</p>
          </div>
          <button
            onClick={deleteAccount}
            disabled={busy !== null}
            className="flex items-center gap-2 bg-red-500 hover:bg-red-400 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {busy === 'account' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            Delete account
          </button>
        </div>
      </div>
    </AppShell>
  );
}
