'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, Upload, Github, Folder, Clock, CheckCircle2, XCircle,
  Loader2, Zap, TrendingUp, Package, Activity, Coins, Cpu,
  Flame, Database, Wrench,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { AppShell } from '@/components/layout/AppShell';
import { projectsApi, metricsApi } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';
import { Project, BuildStatus, BuildStats, LiveBuildItem, ChartPoint } from '@/lib/types';
import { formatDistanceToNow, format } from 'date-fns';
import { NewProjectModal } from '@/components/projects/NewProjectModal';

// ── Status config ─────────────────────────────────────────────────────────────
const statusConfig: Record<string, { color: string; label: string; dot: string }> = {
  PENDING:   { color: 'text-gray-400 bg-gray-800',         label: 'Pending',   dot: 'bg-gray-500' },
  QUEUED:    { color: 'text-blue-400 bg-blue-500/10',      label: 'Queued',    dot: 'bg-blue-400' },
  BUILDING:  { color: 'text-yellow-400 bg-yellow-500/10',  label: 'Building',  dot: 'bg-yellow-400 animate-pulse' },
  FIXING:    { color: 'text-orange-400 bg-orange-500/10',  label: 'AI Fixing', dot: 'bg-orange-400 animate-pulse' },
  SUCCESS:   { color: 'text-green-400 bg-green-500/10',    label: 'Success',   dot: 'bg-green-400' },
  FAILED:    { color: 'text-red-400 bg-red-500/10',        label: 'Failed',    dot: 'bg-red-400' },
  CANCELLED: { color: 'text-gray-400 bg-gray-800',         label: 'Cancelled', dot: 'bg-gray-500' },
  TIMEOUT:   { color: 'text-red-400 bg-red-500/10',        label: 'Timeout',   dot: 'bg-red-400' },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = statusConfig[status] ?? statusConfig.PENDING;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

// ── Metric card ───────────────────────────────────────────────────────────────
function MetricCard({
  label, value, sub, icon: Icon, color, loading,
}: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string; loading?: boolean;
}) {
  return (
    <div className="glass rounded-xl p-5">
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <p className="text-gray-400 text-sm">{label}</p>
          {loading ? (
            <div className="h-8 w-20 bg-gray-800 animate-pulse rounded mt-1" />
          ) : (
            <p className="text-2xl font-bold text-white mt-1 truncate">{value}</p>
          )}
          {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
        </div>
        <Icon className={`w-7 h-7 ${color} opacity-60 flex-shrink-0 mt-1`} />
      </div>
    </div>
  );
}

// ── Build trend chart ─────────────────────────────────────────────────────────
function BuildTrendChart({ data, loading }: { data: ChartPoint[]; loading: boolean }) {
  if (loading) {
    return <div className="h-56 bg-gray-800/50 animate-pulse rounded-xl" />;
  }
  if (!data.length) {
    return (
      <div className="h-56 flex items-center justify-center text-gray-600 text-sm">
        No build data yet
      </div>
    );
  }

  // Only show the last 14 days in the chart label
  const display = data.slice(-14).map((d) => ({
    ...d,
    label: format(new Date(d.date + 'T00:00:00'), 'MMM d'),
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={display} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
        <defs>
          <linearGradient id="gSuccess" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gFailed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
        <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: '#9ca3af' }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: '#9ca3af' }} />
        <Area type="monotone" dataKey="total"   name="Total"   stroke="#6366f1" fill="url(#gTotal)"   strokeWidth={1.5} dot={false} />
        <Area type="monotone" dataKey="success" name="Success" stroke="#22c55e" fill="url(#gSuccess)" strokeWidth={1.5} dot={false} />
        <Area type="monotone" dataKey="failed"  name="Failed"  stroke="#ef4444" fill="url(#gFailed)"  strokeWidth={1.5} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Live build feed ───────────────────────────────────────────────────────────
function LiveFeed({ items, loading }: { items: LiveBuildItem[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 bg-gray-800/50 animate-pulse rounded-lg" />
        ))}
      </div>
    );
  }
  if (!items.length) {
    return (
      <div className="text-center py-8 text-gray-600 text-sm">
        No builds yet — trigger your first build to see it here
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-500 text-xs border-b border-gray-800">
            <th className="text-left py-2 pr-4 font-medium">Project</th>
            <th className="text-left py-2 pr-4 font-medium">Type</th>
            <th className="text-left py-2 pr-4 font-medium">Status</th>
            <th className="text-left py-2 pr-4 font-medium">Duration</th>
            <th className="text-left py-2 pr-4 font-medium">Credits</th>
            <th className="text-left py-2 font-medium">When</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/60">
          {items.map((b) => (
            <tr key={b.id} className="hover:bg-gray-800/20 transition-colors">
              <td className="py-2.5 pr-4">
                <Link
                  href={`/projects/${b.project.id}`}
                  className="text-blue-400 hover:text-blue-300 font-mono text-xs truncate max-w-[140px] block"
                >
                  {b.project.name}
                </Link>
              </td>
              <td className="py-2.5 pr-4">
                <span className="text-gray-400 text-xs font-mono">{b.buildType}</span>
              </td>
              <td className="py-2.5 pr-4">
                <StatusBadge status={b.status} />
              </td>
              <td className="py-2.5 pr-4 text-gray-400 text-xs font-mono">
                {b.duration != null ? `${b.duration}s` : '—'}
              </td>
              <td className="py-2.5 pr-4">
                {b.costCredits != null ? (
                  <span className="text-yellow-400 text-xs font-mono">{b.costCredits.toFixed(3)}</span>
                ) : (
                  <span className="text-gray-600 text-xs">—</span>
                )}
              </td>
              <td className="py-2.5 text-gray-500 text-xs">
                {formatDistanceToNow(new Date(b.createdAt), { addSuffix: true })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Project card ─────────────────────────────────────────────────────────────
function ProjectCard({ project }: { project: Project }) {
  const lastBuild = project.builds?.[0];
  return (
    <Link href={`/projects/${project.id}`}>
      <div className="glass rounded-xl p-5 hover:border-green-500/30 transition-all cursor-pointer group">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-800 rounded-lg flex items-center justify-center">
              <Folder className="w-5 h-5 text-green-400" />
            </div>
            <div>
              <h3 className="text-white font-medium group-hover:text-green-400 transition-colors">
                {project.name}
              </h3>
              <p className="text-gray-500 text-xs">
                {project.projectType.replace('_', ' ')} · {project._count?.builds || 0} builds
              </p>
            </div>
          </div>
          {lastBuild && <StatusBadge status={lastBuild.status as string} />}
        </div>

        {project.compatibilityScore !== undefined && (
          <div className="flex items-center gap-2 mt-3">
            <div className="flex-1 bg-gray-800 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full ${
                  project.compatibilityScore >= 70 ? 'bg-green-500' :
                  project.compatibilityScore >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                }`}
                style={{ width: `${project.compatibilityScore}%` }}
              />
            </div>
            <span className="text-xs text-gray-500">{project.compatibilityScore}%</span>
          </div>
        )}

        <div className="text-xs text-gray-600 mt-3">
          {formatDistanceToNow(new Date(project.createdAt), { addSuffix: true })}
        </div>
      </div>
    </Link>
  );
}

// ── Success rate ring ─────────────────────────────────────────────────────────
function SuccessRing({ rate }: { rate: number }) {
  const r = 20;
  const circ = 2 * Math.PI * r;
  const dash  = (rate / 100) * circ;
  return (
    <svg width={52} height={52} className="-rotate-90">
      <circle cx={26} cy={26} r={r} fill="none" stroke="#1f2937" strokeWidth={5} />
      <circle
        cx={26} cy={26} r={r} fill="none"
        stroke={rate >= 70 ? '#22c55e' : rate >= 40 ? '#eab308' : '#ef4444'}
        strokeWidth={5}
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
      />
    </svg>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);

  const { data: projectData, isLoading: projectsLoading, refetch } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(1, 20),
  });

  const { data: stats, isLoading: statsLoading } = useQuery<BuildStats>({
    queryKey: ['metrics-stats'],
    queryFn: () => metricsApi.stats(),
    refetchInterval: 15000,
  });

  const { data: feed, isLoading: feedLoading } = useQuery<LiveBuildItem[]>({
    queryKey: ['metrics-feed'],
    queryFn: () => metricsApi.feed(15),
    refetchInterval: 10000,
  });

  const { data: chart, isLoading: chartLoading } = useQuery<ChartPoint[]>({
    queryKey: ['metrics-chart'],
    queryFn: () => metricsApi.chart(30),
    refetchInterval: 60000,
  });

  const projects: Project[] = projectData?.projects || [];

  const fmtDuration = (sec: number) =>
    sec >= 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`;

  return (
    <AppShell>
      <div className="p-8 space-y-8">
        {/* ── Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">
              Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}
            </h1>
            <p className="text-gray-400 mt-1">Build, fix and ship Android APKs</p>
          </div>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-green-500 hover:bg-green-400 text-white px-4 py-2.5 rounded-xl font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Project
          </button>
        </div>

        {/* ── Metric cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
          <MetricCard
            label="Total Builds" value={stats?.totalBuilds ?? 0}
            sub={`${stats?.activeBuilds ?? 0} active`}
            icon={Activity} color="text-blue-400" loading={statsLoading}
          />
          <MetricCard
            label="Builds / Hour" value={stats?.buildsLastHour ?? 0}
            icon={Flame} color="text-orange-400" loading={statsLoading}
          />
          <MetricCard
            label="Avg Duration" value={stats ? fmtDuration(stats.avgDurationSec) : '—'}
            icon={Clock} color="text-purple-400" loading={statsLoading}
          />
          <MetricCard
            label="Total Credits" value={stats?.totalCredits?.toFixed(3) ?? '0.000'}
            sub="CPU-seconds × rate"
            icon={Coins} color="text-yellow-400" loading={statsLoading}
          />
          <MetricCard
            label="Cache Hits" value={stats?.mavenCacheHits ?? 0}
            sub="Maven offline"
            icon={Database} color="text-cyan-400" loading={statsLoading}
          />
          <MetricCard
            label="AI Fixes" value={stats?.aiFixesApplied ?? 0}
            sub="applied successfully"
            icon={Wrench} color="text-pink-400" loading={statsLoading}
          />
        </div>

        {/* ── Chart + Success ring ── */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
          {/* Chart */}
          <div className="glass rounded-xl p-5 xl:col-span-3">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-white">Build Activity — Last 30 days</h2>
              <span className="text-xs text-gray-500">auto-refresh 60s</span>
            </div>
            <BuildTrendChart data={chart ?? []} loading={chartLoading} />
          </div>

          {/* Success rate + quick stats */}
          <div className="glass rounded-xl p-5 flex flex-col justify-between">
            <h2 className="text-sm font-semibold text-white mb-4">Success Rate</h2>
            <div className="flex flex-col items-center gap-2 flex-1 justify-center">
              <div className="relative flex items-center justify-center">
                <SuccessRing rate={stats?.successRate ?? 0} />
                <span className="absolute text-sm font-bold text-white">
                  {statsLoading ? '…' : `${stats?.successRate ?? 0}%`}
                </span>
              </div>
              <span className="text-xs text-gray-500 mt-1">
                {stats?.successBuilds ?? 0} passed · {stats?.failedBuilds ?? 0} failed
              </span>
            </div>
            <div className="space-y-2 mt-4">
              {[
                { label: 'Projects',  value: projects.length,          icon: Package,       color: 'text-blue-400' },
                { label: 'Success',   value: stats?.successBuilds ?? 0, icon: CheckCircle2, color: 'text-green-400' },
                { label: 'Failed',    value: stats?.failedBuilds ?? 0,  icon: XCircle,      color: 'text-red-400' },
                { label: 'Active',    value: stats?.activeBuilds ?? 0,  icon: Cpu,          color: 'text-yellow-400' },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-gray-400">
                    <Icon className={`w-3.5 h-3.5 ${color}`} /> {label}
                  </span>
                  <span className="text-white font-medium">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Live build feed ── */}
        <div className="glass rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Live Build Feed
            </h2>
            <span className="text-xs text-gray-500">auto-refresh 10s</span>
          </div>
          <LiveFeed items={feed ?? []} loading={feedLoading} />
        </div>

        {/* ── Quick actions ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => setShowModal(true)}
            className="glass rounded-xl p-5 flex items-center gap-4 hover:border-green-500/30 transition-all text-left group"
          >
            <div className="w-12 h-12 bg-green-500/10 rounded-xl flex items-center justify-center">
              <Upload className="w-6 h-6 text-green-400" />
            </div>
            <div>
              <div className="text-white font-medium group-hover:text-green-400 transition-colors">
                Upload ZIP
              </div>
              <div className="text-gray-500 text-sm">Drag & drop your Android project</div>
            </div>
          </button>

          <button
            onClick={() => setShowModal(true)}
            className="glass rounded-xl p-5 flex items-center gap-4 hover:border-blue-500/30 transition-all text-left group"
          >
            <div className="w-12 h-12 bg-blue-500/10 rounded-xl flex items-center justify-center">
              <Github className="w-6 h-6 text-blue-400" />
            </div>
            <div>
              <div className="text-white font-medium group-hover:text-blue-400 transition-colors">
                Import from GitHub
              </div>
              <div className="text-gray-500 text-sm">Paste a repository URL</div>
            </div>
          </button>
        </div>

        {/* ── Projects ── */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">
            Your Projects{' '}
            {projects.length > 0 && (
              <span className="text-gray-500 text-sm font-normal">({projects.length})</span>
            )}
          </h2>

          {projectsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 text-green-400 animate-spin" />
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-gray-800 rounded-2xl">
              <Package className="w-12 h-12 text-gray-700 mx-auto mb-4" />
              <h3 className="text-gray-400 font-medium mb-2">No projects yet</h3>
              <p className="text-gray-600 text-sm mb-6">
                Upload a ZIP or import from GitHub to get started
              </p>
              <button
                onClick={() => setShowModal(true)}
                className="inline-flex items-center gap-2 bg-green-500 hover:bg-green-400 text-white px-4 py-2 rounded-lg font-medium transition-colors text-sm"
              >
                <Plus className="w-4 h-4" />
                Create first project
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {projects.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </div>
          )}
        </div>
      </div>

      {showModal && (
        <NewProjectModal
          onClose={() => setShowModal(false)}
          onSuccess={() => { setShowModal(false); refetch(); }}
        />
      )}
    </AppShell>
  );
}
