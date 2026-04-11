'use client';
import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { X, Upload, Github, Loader2, FileArchive, Link } from 'lucide-react';
import { projectsApi } from '@/lib/api';

type Tab = 'zip' | 'github';

interface Props {
  onClose: () => void;
  onSuccess: (project: any) => void;
}

export function NewProjectModal({ onClose, onSuccess }: Props) {
  const [tab, setTab] = useState<Tab>('zip');
  const [loading, setLoading] = useState(false);

  // ZIP state
  const [file, setFile] = useState<File | null>(null);
  const [zipName, setZipName] = useState('');
  const [zipDesc, setZipDesc] = useState('');

  // GitHub state
  const [repoUrl, setRepoUrl] = useState('');
  const [repoName, setRepoName] = useState('');
  const [repoDesc, setRepoDesc] = useState('');

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) {
      setFile(accepted[0]);
      const name = accepted[0].name.replace('.zip', '').replace(/[-_]/g, ' ');
      setZipName(name);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/zip': ['.zip'] },
    maxFiles: 1,
    maxSize: 500 * 1024 * 1024,
  });

  const handleZipSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { toast.error('Please select a ZIP file'); return; }
    setLoading(true);
    try {
      const project = await projectsApi.uploadZip(file, zipName, zipDesc);
      toast.success('Project imported successfully!');
      onSuccess(project);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Upload failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGithubSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) { toast.error('Please enter a GitHub URL'); return; }
    setLoading(true);
    try {
      const project = await projectsApi.importUrl({
        name: repoName || repoUrl.split('/').pop() || 'My Project',
        sourceUrl: repoUrl,
        sourceType: 'GITHUB_URL',
        description: repoDesc,
      });
      toast.success('Repository imported successfully!');
      onSuccess(project);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-800">
          <h2 className="text-lg font-bold text-white">New Project</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          {(['zip', 'github'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
                tab === t
                  ? 'text-green-400 border-b-2 border-green-500'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {t === 'zip' ? <Upload className="w-4 h-4" /> : <Github className="w-4 h-4" />}
              {t === 'zip' ? 'Upload ZIP' : 'GitHub URL'}
            </button>
          ))}
        </div>

        <div className="p-6">
          {tab === 'zip' ? (
            <form onSubmit={handleZipSubmit} className="space-y-4">
              {/* Dropzone */}
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                  isDragActive
                    ? 'border-green-500 bg-green-500/5'
                    : file
                    ? 'border-green-500/50 bg-green-500/5'
                    : 'border-gray-700 hover:border-gray-600'
                }`}
              >
                <input {...getInputProps()} />
                {file ? (
                  <div>
                    <FileArchive className="w-10 h-10 text-green-400 mx-auto mb-2" />
                    <p className="text-white font-medium">{file.name}</p>
                    <p className="text-gray-500 text-sm">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                  </div>
                ) : (
                  <div>
                    <Upload className="w-10 h-10 text-gray-600 mx-auto mb-2" />
                    <p className="text-gray-300 font-medium">
                      {isDragActive ? 'Drop it here' : 'Drag & drop your ZIP file'}
                    </p>
                    <p className="text-gray-500 text-sm mt-1">or click to browse · max 500MB</p>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Project name</label>
                <input
                  type="text"
                  value={zipName}
                  onChange={(e) => setZipName(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-green-500 transition-colors text-sm"
                  placeholder="My Android App"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Description <span className="text-gray-600">(optional)</span>
                </label>
                <input
                  type="text"
                  value={zipDesc}
                  onChange={(e) => setZipDesc(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-green-500 transition-colors text-sm"
                  placeholder="A short description..."
                />
              </div>

              <button
                type="submit"
                disabled={loading || !file}
                className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {loading ? 'Uploading...' : 'Upload & Import'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleGithubSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">GitHub Repository URL</label>
                <div className="relative">
                  <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="url"
                    required
                    value={repoUrl}
                    onChange={(e) => {
                      setRepoUrl(e.target.value);
                      const parts = e.target.value.split('/');
                      if (parts.length > 0 && !repoName) {
                        setRepoName(parts[parts.length - 1] || '');
                      }
                    }}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl pl-10 pr-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-green-500 transition-colors text-sm"
                    placeholder="https://github.com/user/my-android-app"
                  />
                </div>
                <p className="text-xs text-gray-600 mt-1">Public repositories only (private requires OAuth)</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Project name</label>
                <input
                  type="text"
                  required
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-green-500 transition-colors text-sm"
                  placeholder="My Android App"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">
                  Description <span className="text-gray-600">(optional)</span>
                </label>
                <input
                  type="text"
                  value={repoDesc}
                  onChange={(e) => setRepoDesc(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-green-500 transition-colors text-sm"
                  placeholder="A short description..."
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Github className="w-4 h-4" />}
                {loading ? 'Cloning repository...' : 'Import from GitHub'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
