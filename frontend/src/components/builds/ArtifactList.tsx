'use client';
import { useState } from 'react';
import { Download, Copy, Star, Smartphone, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { BuildArtifact } from '@/lib/types';
import { buildsApi } from '@/lib/api';

const fmtSize = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(2)} MB` : `${(b / 1024).toFixed(1)} KB`);

export function ArtifactList({ projectId, buildId, artifacts }: {
  projectId: string; buildId: string; artifacts: BuildArtifact[];
}) {
  const [busy, setBusy] = useState<string | null>(null);

  const download = async (a: BuildArtifact) => {
    setBusy(a.id);
    try {
      await buildsApi.downloadArtifact(projectId, buildId, a.id, a.fileName);
    } catch {
      toast.error('Download failed (are you signed in as the owner of this build?)');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="glass rounded-xl p-5 mt-5" data-testid="artifact-list">
      <h2 className="text-white font-semibold mb-1 flex items-center gap-2">
        <Smartphone className="w-4 h-4 text-green-400" />
        Debug APK{artifacts.length > 1 ? `s (${artifacts.length} variants)` : ''}
      </h2>
      <p className="text-gray-500 text-xs mb-4">
        Signed with the debug key. On your phone, allow “Install unknown apps” for your browser or file manager, then open the file.
        {artifacts.length > 1 && ' Several variants were built: the recommended one is listed first (universal or arm64-v8a suits recent Samsung Galaxy phones).'}
      </p>
      <div className="space-y-3">
        {artifacts.map((a) => (
          <div key={a.id} className="border border-gray-800 rounded-lg p-3" data-testid="artifact-row">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white text-sm font-mono truncate" data-testid="artifact-name">{a.fileName}</span>
                  {a.recommended && (
                    <span className="inline-flex items-center gap-1 text-xs bg-green-500/10 text-green-400 px-2 py-0.5 rounded-full">
                      <Star className="w-3 h-3" /> Recommended
                    </span>
                  )}
                  <span className="text-xs bg-gray-800 text-gray-300 px-2 py-0.5 rounded-full">{a.variant}</span>
                  <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">{a.abi}</span>
                </div>
                <div className="text-gray-500 text-xs mt-1" data-testid="artifact-size">{fmtSize(a.sizeBytes)}</div>
              </div>
              <button
                onClick={() => download(a)}
                disabled={busy === a.id}
                className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-60"
                data-testid="artifact-download"
              >
                {busy === a.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Download
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-gray-500 text-xs">SHA-256</span>
              <code className="text-xs text-gray-300 break-all" data-testid="artifact-sha256">{a.sha256}</code>
              <button
                onClick={() => { navigator.clipboard.writeText(a.sha256); toast.success('SHA-256 copied'); }}
                className="text-gray-500 hover:text-white flex-shrink-0"
                aria-label="Copy SHA-256"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
