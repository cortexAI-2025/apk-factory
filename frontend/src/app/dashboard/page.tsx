'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, Upload, Github, Folder, Clock, CheckCircle2, XCircle,
  Loader2, Zap, TrendingUp, Package,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { projectsApi } from '@/lib/api';
import { useAuth } from '@/lib/hooks/useAuth';
import { Project, BuildStatus } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';
import { NewProjectModal } from '@/components/projects/NewProjectModal';

const statusConfig: Record<BuildStatus, { color: string; label: string; icon: React.ReactNode }> = {
  PENDING:  { color: 'text-gray-400 bg-gray-800', label: 'Pending', icon: <Clock className="w-3 h-3" /> },
  QUEUED:   { color: 'text-blue-400 bg-blue-500/10', label: 'Queued', icon: <Clock className="w-3 h-3" /> },
  BUILDING: { color: 'text-yellow-400 bg-yellow-500/10', label: 'Building', icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  FIXING:   { color: 'text-orange-400 bg-orange-500/10', label: 'AI Fixing', icon: <Zap className="w-3 h-3 animate-pulse" /> },
  SUCCESS:  { color: 'text-green-400 bg-green-500/10', label: 'Success', icon: <CheckCircle2 className="w-3 h-3" /> },
  FAILED:   { color: 'text-red-400 bg-red-500/10', label: 'Failed', icon: <XCircle className="w-3 h-3" /> },
  CANCELLED:{ color: 'text-gray-400 bg-gray-800', label: 'Cancelled', icon: <XCircle className="w-3 h-3" /> },
  TIMEOUT:  { color: 'text-red-400 bg-red-500/10', label: 'Timeout', icon: <XCircle className="w-3 h-3" /> },
};

function BuildStatusBadge({ status }: { status: BuildStatus }) {
  const cfg = statusConfig[status] || statusConfig.PENDING;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.icon}
      {cfg.label}
    </span>
  );
}

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
          {lastBuild && <BuildStatusBadge status={lastBuild.status as BuildStatus} />}
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
            <span className="text-xs text-gray-500">{project.compatibilityScore}% compatible</span>
          </div>
        )}

        <div className="text-xs text-gray-600 mt-3">
          {formatDistanceToNow(new Date(project.createdAt), { addSuffix: true })}
        </div>
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list(1, 20),
  });

  const projects: Project[] = data?.projects || [];
  const totalBuilds = projects.reduce((sum, p) => sum + (p._count?.builds || 0), 0);
  const successBuilds = projects.filter((p) => p.builds?.[0]?.status === 'SUCCESS').length;

  return (
    <AppShell>
      <div className="p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
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

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {[
            { label: 'Total Projects', value: projects.length, icon: Package, color: 'text-blue-400' },
            { label: 'Total Builds', value: totalBuilds, icon: TrendingUp, color: 'text-purple-400' },
            { label: 'Successful', value: successBuilds, icon: CheckCircle2, color: 'text-green-400' },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="glass rounded-xl p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-sm">{label}</p>
                  <p className="text-3xl font-bold text-white mt-1">{value}</p>
                </div>
                <Icon className={`w-8 h-8 ${color} opacity-60`} />
              </div>
            </div>
          ))}
        </div>

        {/* Quick actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
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

        {/* Projects */}
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">
            Your Projects{' '}
            {projects.length > 0 && (
              <span className="text-gray-500 text-sm font-normal">({projects.length})</span>
            )}
          </h2>

          {isLoading ? (
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
