'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Download, QrCode, Share2, Loader2, CheckCircle2,
  XCircle, Zap, Clock, ChevronRight, Terminal, Wrench, Copy,
  StopCircle,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { buildsApi } from '@/lib/api';
import { useBuildSocket } from '@/lib/hooks/useBuildSocket';
import { BuildLog, Build, BuildStatus, BuildFix } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';

const LOG_COLORS: Record<string, string> = {
  error: 'text-red-400',
  warn: 'text-yellow-400',
  info: 'text-gray-300',
  debug: 'text-gray-600',
};

const STATUS_CONFIG: Record<BuildStatus, { icon: React.ReactNode; color: string; label: string; pulse?: boolean }> = {
  PENDING:   { icon: <Clock className="w-5 h-5" />,        color: 'text-gray-400', label: 'Pending' },
  QUEUED:    { icon: <Clock className="w-5 h-5" />,        color: 'text-blue-400', label: 'Queued', pulse: true },
  BUILDING:  { icon: <Loader2 className="w-5 h-5 animate-spin" />, color: 'text-yellow-400', label: 'Building' },
  FIXING:    { icon: <Zap className="w-5 h-5 animate-pulse" />,    color: 'text-orange-400', label: 'AI Fixing' },
  SUCCESS:   { icon: <CheckCircle2 className="w-5 h-5" />, color: 'text-green-400', label: 'Build Successful' },
  FAILED:    { icon: <XCircle className="w-5 h-5" />,      color: 'text-red-400', label: 'Build Failed' },
  CANCELLED: { icon: <XCircle className="w-5 h-5" />,      color: 'text-gray-400', label: 'Cancelled' },
  TIMEOUT:   { icon: <XCircle className="w-5 h-5" />,      color: 'text-red-400', label: 'Timed Out' },
};

function fmtDuration(secs?: number) {
  if (!secs) return null;
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export default function BuildViewerPage() {
  const { id: buildId } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const projectId = searchParams.get('projectId') || '';
  const router = useRouter();

  const [logs, setLogs] = useState<BuildLog[]>([]);
  const [liveStatus, setLiveStatus] = useState<BuildStatus | null>(null);
  const [fixes, setFixes] = useState<BuildFix[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const consoleRef = useRef<HTMLDivElement>(null);
  const logsLoaded = useRef(false);

  const { data: build, refetch } = useQuery<Build>({
    queryKey: ['build', buildId],
    queryFn: () => buildsApi.get(projectId, buildId),
    refetchInterval: (data) => {
      const status = data?.status as BuildStatus;
      return ['PENDING', 'QUEUED', 'BUILDING', 'FIXING'].includes(status) ? 3000 : false;
    },
  });

  const activeStatus = (liveStatus || build?.status) as BuildStatus;
  const isActive = ['PENDING', 'QUEUED', 'BUILDING', 'FIXING'].includes(activeStatus);

  // Load initial logs
  useEffect(() => {
    if (!logsLoaded.current && buildId && projectId) {
      logsLoaded.current = true;
      buildsApi.getLogs(projectId, buildId, 0, 1000).then(({ logs: initial }) => {
        setLogs(initial || []);
      });
    }
  }, [buildId, projectId]);

  // Socket for live updates
  useBuildSocket({
    buildId,
    onLog: (log) => setLogs((prev) => [...prev, log]),
    onStatus: (status) => {
      setLiveStatus(status as BuildStatus);
      if (['SUCCESS', 'FAILED', 'CANCELLED'].includes(status)) refetch();
    },
    onComplete: (result) => {
      setLiveStatus(result.status as BuildStatus);
      refetch();
      if (result.status === 'SUCCESS') {
        toast.success('Build successful!');
      } else if (result.status === 'FAILED') {
        toast.error('Build failed');
      }
    },
    onFix: (fix) => {
      setFixes((prev) => [
        ...prev,
        {
          id: `${Date.now()}`,
          attempt: fix.attempt,
          fixDescription: fix.description,
          filesModified: fix.filesModified,
          errorSummary: '',
          success: true,
          createdAt: new Date().toISOString(),
        },
      ]);
    },
  });

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!consoleRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = consoleRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  }, []);

  const handleGenerateLink = async () => {
    try {
      const result = await buildsApi.generatePublicLink(projectId, buildId);
      await navigator.clipboard.writeText(result.publicLink);
      toast.success('Public link copied to clipboard!');
      refetch();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to generate link');
    }
  };

  const handleCancel = async () => {
    try {
      await buildsApi.cancel(projectId, buildId);
      toast.success('Build cancelled');
      refetch();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Cannot cancel');
    }
  };

  const allFixes = [...(build?.fixes || []), ...fixes];
  const cfg = STATUS_CONFIG[activeStatus] || STATUS_CONFIG.PENDING;

  return (
    <AppShell>
      <div className="p-8 h-full flex flex-col">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
          <Link href="/dashboard" className="hover:text-white">Dashboard</Link>
          <ChevronRight className="w-4 h-4" />
          {projectId && (
            <>
              <Link href={`/projects/${projectId}`} className="hover:text-white">
                {build?.project?.name || 'Project'}
              </Link>
              <ChevronRight className="w-4 h-4" />
            </>
          )}
          <span className="text-gray-300">Build</span>
        </div>

        {/* Status header */}
        <div className="glass rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className={`${cfg.color} ${cfg.pulse ? 'animate-pulse' : ''}`}>
                {cfg.icon}
              </div>
              <div>
                <h1 className={`text-xl font-bold ${cfg.color}`}>{cfg.label}</h1>
                <p className="text-gray-500 text-sm font-mono">
                  {buildId.slice(0, 8)}...
                  {build?.buildType && ` · ${build.buildType}`}
                  {build?.duration && ` · ${fmtDuration(build.duration)}`}
                  {build?.autoFixAttempts && build.autoFixAttempts > 0 && (
                    <span className="text-orange-400"> · {build.autoFixAttempts} AI fix(es)</span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isActive && (
                <button
                  onClick={handleCancel}
                  className="flex items-center gap-2 border border-red-500/30 hover:border-red-500/60 text-red-400 px-3 py-2 rounded-lg text-sm transition-colors"
                >
                  <StopCircle className="w-4 h-4" />
                  Cancel
                </button>
              )}
              {activeStatus === 'SUCCESS' && build?.apkUrl && (
                <>
                  <a
                    href={build.apkUrl}
                    download
                    className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  >
                    <Download className="w-4 h-4" />
                    Download APK
                    {build.apkSize && ` (${(build.apkSize / 1024 / 1024).toFixed(1)}MB)`}
                  </a>
                  <button
                    onClick={handleGenerateLink}
                    className="flex items-center gap-2 border border-gray-700 hover:border-gray-500 text-gray-300 hover:text-white px-3 py-2 rounded-lg text-sm transition-colors"
                  >
                    <Share2 className="w-4 h-4" />
                    Share
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Public link + QR */}
          {build?.publicLink && (
            <div className="mt-4 pt-4 border-t border-gray-800 flex items-center gap-4">
              <div className="flex-1 bg-gray-800 rounded-lg px-3 py-2 font-mono text-xs text-gray-300 truncate">
                {build.publicLink}
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(build.publicLink!);
                  toast.success('Copied!');
                }}
                className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors"
              >
                <Copy className="w-4 h-4" />
              </button>
              {build.qrCodeUrl && (
                <a href={build.qrCodeUrl} target="_blank" className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800 transition-colors">
                  <QrCode className="w-4 h-4" />
                </a>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
          {/* Console - takes 2/3 */}
          <div className="lg:col-span-2 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-white font-semibold flex items-center gap-2">
                <Terminal className="w-4 h-4 text-green-400" />
                Build Console
                <span className="text-gray-500 text-sm font-normal">({logs.length} lines)</span>
              </h2>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                    className="w-3 h-3 rounded accent-green-500"
                  />
                  Auto-scroll
                </label>
              </div>
            </div>

            <div
              ref={consoleRef}
              onScroll={handleScroll}
              className="flex-1 bg-gray-950 border border-gray-800 rounded-xl p-4 overflow-y-auto scrollbar-thin min-h-[400px] max-h-[600px]"
            >
              {logs.length === 0 ? (
                <div className="flex items-center justify-center h-full text-gray-600 font-mono text-sm">
                  {isActive ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Waiting for output...
                    </div>
                  ) : (
                    'No logs available'
                  )}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {logs.map((log, i) => (
                    <div
                      key={log.id || i}
                      className={`console-line ${LOG_COLORS[log.level] || LOG_COLORS.info}`}
                    >
                      <span className="text-gray-600 select-none mr-2 text-xs">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      {log.message}
                    </div>
                  ))}
                  {isActive && (
                    <div className="text-green-400 font-mono text-sm">
                      <span className="cursor-blink">█</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right: Timeline / fixes */}
          <div className="space-y-5">
            {/* AI Fixes */}
            <div className="glass rounded-xl p-5">
              <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
                <Wrench className="w-4 h-4 text-orange-400" />
                AI Fix Timeline
                {allFixes.length > 0 && (
                  <span className="bg-orange-500/10 text-orange-400 text-xs px-1.5 py-0.5 rounded-full">
                    {allFixes.length}
                  </span>
                )}
              </h2>

              {allFixes.length === 0 ? (
                <div className="text-center py-6 text-gray-600 text-sm">
                  {activeStatus === 'SUCCESS' ? (
                    <div className="text-green-400">
                      <CheckCircle2 className="w-8 h-8 mx-auto mb-2" />
                      Built clean — no fixes needed
                    </div>
                  ) : (
                    <div>
                      <Zap className="w-8 h-8 mx-auto mb-2 text-gray-700" />
                      No fixes applied yet
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {allFixes.map((fix, i) => (
                    <div key={fix.id || i} className="border border-orange-500/20 bg-orange-500/5 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-orange-400 text-xs font-medium">
                          Fix #{fix.attempt}
                        </span>
                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                          fix.success
                            ? 'bg-green-500/10 text-green-400'
                            : 'bg-red-500/10 text-red-400'
                        }`}>
                          {fix.success ? 'Applied' : 'Failed'}
                        </span>
                      </div>
                      <p className="text-gray-300 text-xs mb-2">{fix.fixDescription}</p>
                      {fix.filesModified?.length > 0 && (
                        <div className="space-y-0.5">
                          {fix.filesModified.map((f) => (
                            <div key={f} className="text-xs text-gray-500 font-mono">
                              ~ {f}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Error summary */}
            {activeStatus === 'FAILED' && build?.errorMessage && (
              <div className="border border-red-500/20 bg-red-500/5 rounded-xl p-4">
                <h3 className="text-red-400 font-medium text-sm mb-2 flex items-center gap-2">
                  <XCircle className="w-4 h-4" />
                  Error Summary
                </h3>
                <pre className="text-red-300 text-xs whitespace-pre-wrap font-mono leading-relaxed">
                  {build.errorMessage}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
