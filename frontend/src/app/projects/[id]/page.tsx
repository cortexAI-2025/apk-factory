'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Play, Trash2, Loader2, CheckCircle2, XCircle,
  Clock, Zap, Download, QrCode, Package, GitBranch, Code,
  ChevronRight,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { projectsApi, buildsApi } from '@/lib/api';
import { Build, BuildStatus, BuildType } from '@/lib/types';
import { formatDistanceToNow, format } from 'date-fns';

const STATUS_CONFIG: Record<BuildStatus, { color: string; label: string }> = {
  PENDING:   { color: 'text-gray-400 bg-gray-800', label: 'Pending' },
  QUEUED:    { color: 'text-blue-400 bg-blue-500/10 border border-blue-500/20', label: 'Queued' },
  BUILDING:  { color: 'text-yellow-400 bg-yellow-500/10 border border-yellow-500/20', label: 'Building' },
  FIXING:    { color: 'text-orange-400 bg-orange-500/10 border border-orange-500/20', label: 'AI Fixing' },
  SUCCESS:   { color: 'text-green-400 bg-green-500/10 border border-green-500/20', label: 'Success' },
  FAILED:    { color: 'text-red-400 bg-red-500/10 border border-red-500/20', label: 'Failed' },
  CANCELLED: { color: 'text-gray-400 bg-gray-800', label: 'Cancelled' },
  TIMEOUT:   { color: 'text-red-400 bg-red-500/10', label: 'Timeout' },
};

function fmtDuration(secs?: number) {
  if (!secs) return '—';
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

function fmtSize(bytes?: number) {
  if (!bytes) return '—';
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const [buildType, setBuildType] = useState<BuildType>('DEBUG');
  const [autoFix, setAutoFix] = useState(true);
  const [buildLoading, setBuildLoading] = useState(false);

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id),
    refetchInterval: 5000,
  });

  const deleteMutation = useMutation({
    mutationFn: () => projectsApi.delete(id),
    onSuccess: () => {
      toast.success('Project deleted');
      router.push('/dashboard');
    },
    onError: () => toast.error('Delete failed'),
  });

  const handleBuild = async () => {
    setBuildLoading(true);
    try {
      const build = await buildsApi.create(id, { buildType, autoFix });
      toast.success('Build started!');
      qc.invalidateQueries({ queryKey: ['project', id] });
      router.push(`/builds/${build.id}?projectId=${id}`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to start build');
    } finally {
      setBuildLoading(false);
    }
  };

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-6 h-6 text-green-400 animate-spin" />
        </div>
      </AppShell>
    );
  }

  if (!project) return null;

  const builds: Build[] = project.builds || [];

  return (
    <AppShell>
      <div className="p-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-6">
          <Link href="/dashboard" className="hover:text-white transition-colors">Dashboard</Link>
          <ChevronRight className="w-4 h-4" />
          <span className="text-gray-300">{project.name}</span>
        </div>

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 bg-gray-800 rounded-xl flex items-center justify-center">
                <Package className="w-6 h-6 text-green-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">{project.name}</h1>
                {project.description && (
                  <p className="text-gray-400 text-sm">{project.description}</p>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={() => {
              if (confirm(`Delete "${project.name}"? This cannot be undone.`)) {
                deleteMutation.mutate();
              }
            }}
            className="flex items-center gap-2 text-red-400 hover:text-red-300 border border-red-500/20 hover:border-red-500/40 px-3 py-2 rounded-lg text-sm transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Build trigger + Project info */}
          <div className="space-y-5">
            {/* Build trigger */}
            <div className="glass rounded-xl p-5">
              <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
                <Play className="w-4 h-4 text-green-400" />
                Build APK
              </h2>

              <div className="space-y-3 mb-4">
                <div>
                  <label className="text-xs text-gray-400 block mb-1.5">Build type</label>
                  <div className="flex gap-2">
                    {(['DEBUG', 'RELEASE', 'AAB'] as BuildType[]).map((bt) => (
                      <button
                        key={bt}
                        onClick={() => setBuildType(bt)}
                        className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${
                          buildType === bt
                            ? 'bg-green-500 text-white'
                            : 'bg-gray-800 text-gray-400 hover:text-white'
                        }`}
                      >
                        {bt}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-center gap-3 cursor-pointer">
                  <div
                    onClick={() => setAutoFix(!autoFix)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${
                      autoFix ? 'bg-green-500' : 'bg-gray-700'
                    }`}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                      autoFix ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </div>
                  <div>
                    <div className="text-sm text-gray-200 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-orange-400" />
                      AI AutoFix
                    </div>
                    <div className="text-xs text-gray-500">Auto-repair up to 3 errors</div>
                  </div>
                </label>
              </div>

              <button
                onClick={handleBuild}
                disabled={buildLoading}
                className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {buildLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                {buildLoading ? 'Starting...' : 'Build APK'}
              </button>
            </div>

            {/* Project info */}
            <div className="glass rounded-xl p-5">
              <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
                <Code className="w-4 h-4 text-blue-400" />
                Project Analysis
              </h2>
              <div className="space-y-3">
                {[
                  { label: 'Type', value: project.projectType.replace('_', ' ') },
                  { label: 'Source', value: project.sourceType.replace('_', ' ') },
                  { label: 'Gradle', value: project.gradleVersion || 'Unknown' },
                  { label: 'SDK', value: project.sdkVersion ? `API ${project.sdkVersion}` : 'Unknown' },
                  { label: 'Kotlin', value: project.kotlinVersion || 'Unknown' },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">{label}</span>
                    <span className="text-gray-200 font-mono text-xs bg-gray-800 px-2 py-0.5 rounded">
                      {value}
                    </span>
                  </div>
                ))}

                {project.compatibilityScore !== undefined && (
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-500">Compatibility</span>
                      <span className={`text-xs font-medium ${
                        project.compatibilityScore >= 70 ? 'text-green-400' :
                        project.compatibilityScore >= 40 ? 'text-yellow-400' : 'text-red-400'
                      }`}>{project.compatibilityScore}%</span>
                    </div>
                    <div className="w-full bg-gray-800 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${
                          project.compatibilityScore >= 70 ? 'bg-green-500' :
                          project.compatibilityScore >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${project.compatibilityScore}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right: Build history */}
          <div className="lg:col-span-2">
            <h2 className="text-white font-semibold mb-4 flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-purple-400" />
              Build History
              <span className="text-gray-500 text-sm font-normal">({builds.length})</span>
            </h2>

            {builds.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-gray-800 rounded-xl">
                <Play className="w-10 h-10 text-gray-700 mx-auto mb-3" />
                <p className="text-gray-400">No builds yet</p>
                <p className="text-gray-600 text-sm">Click "Build APK" to start your first build</p>
              </div>
            ) : (
              <div className="space-y-3">
                {builds.map((build) => {
                  const cfg = STATUS_CONFIG[build.status as BuildStatus] || STATUS_CONFIG.PENDING;
                  return (
                    <Link
                      key={build.id}
                      href={`/builds/${build.id}?projectId=${id}`}
                      className="glass rounded-xl p-4 flex items-center gap-4 hover:border-green-500/20 transition-colors group"
                    >
                      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cfg.color}`}>
                        {build.status === 'BUILDING' && <Loader2 className="w-3 h-3 animate-spin" />}
                        {build.status === 'FIXING'   && <Zap className="w-3 h-3 animate-pulse" />}
                        {build.status === 'SUCCESS'  && <CheckCircle2 className="w-3 h-3" />}
                        {build.status === 'FAILED'   && <XCircle className="w-3 h-3" />}
                        {cfg.label}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-gray-300 text-sm font-medium">{build.buildType}</span>
                          {build.autoFixAttempts > 0 && (
                            <span className="text-orange-400 text-xs flex items-center gap-1">
                              <Zap className="w-3 h-3" />
                              {build.autoFixAttempts} fix{build.autoFixAttempts > 1 ? 'es' : ''}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-600 mt-0.5">
                          {formatDistanceToNow(new Date(build.createdAt), { addSuffix: true })}
                          {build.duration && ` · ${fmtDuration(build.duration)}`}
                          {build.apkSize && ` · ${fmtSize(build.apkSize)}`}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {build.apkUrl && (
                          <a
                            href={build.apkUrl}
                            download
                            onClick={(e) => e.stopPropagation()}
                            className="p-1.5 text-gray-400 hover:text-green-400 hover:bg-green-500/10 rounded-lg transition-colors"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                        )}
                        {build.qrCodeUrl && (
                          <a
                            href={build.qrCodeUrl}
                            target="_blank"
                            onClick={(e) => e.stopPropagation()}
                            className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                          >
                            <QrCode className="w-4 h-4" />
                          </a>
                        )}
                        <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
