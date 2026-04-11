'use client';
import { useState } from 'react';
import { ChevronDown, ChevronRight, FileCode, Plus, Minus, Hash } from 'lucide-react';

interface FilePatch {
  file:   string;
  before: string;
  after:  string;
  diff:   string;
}

interface DiffViewerProps {
  patches: FilePatch[];
  attempt: number;
  description: string;
  success: boolean;
}

type ViewMode = 'split' | 'unified';

export function DiffViewer({ patches, attempt, description, success }: DiffViewerProps) {
  const [expanded, setExpanded] = useState(true);
  const [mode, setMode] = useState<ViewMode>('unified');
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set(patches.map((p) => p.file)));

  const toggleFile = (file: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file); else next.add(file);
      return next;
    });
  };

  const totalAdditions = patches.reduce((s, p) => s + countLines(p.diff, '+'), 0);
  const totalDeletions = patches.reduce((s, p) => s + countLines(p.diff, '-'), 0);

  return (
    <div className={`rounded-xl border ${success ? 'border-orange-500/30 bg-orange-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
      {/* Header */}
      <button
        className="w-full flex items-center gap-3 p-4 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${success ? 'bg-orange-500/20 text-orange-400' : 'bg-red-500/10 text-red-400'}`}>
              Fix #{attempt}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded ${success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
              {success ? 'Applied' : 'Failed'}
            </span>
          </div>
          <p className="text-sm text-gray-300 mt-1 truncate">{description}</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 text-xs">
          <span className="text-gray-500">{patches.length} file{patches.length !== 1 ? 's' : ''}</span>
          <span className="text-green-400 font-mono">+{totalAdditions}</span>
          <span className="text-red-400 font-mono">-{totalDeletions}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-800">
          {/* View mode toggle */}
          <div className="flex items-center justify-between px-4 py-2 bg-gray-900/50">
            <span className="text-xs text-gray-500">Changed files</span>
            <div className="flex bg-gray-800 rounded-lg p-0.5">
              {(['unified', 'split'] as ViewMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-2 py-0.5 text-xs rounded-md transition-colors ${mode === m ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {patches.map((patch) => (
            <FileDiff
              key={patch.file}
              patch={patch}
              mode={mode}
              expanded={expandedFiles.has(patch.file)}
              onToggle={() => toggleFile(patch.file)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Single file diff ──────────────────────────────────────────────────────────
function FileDiff({ patch, mode, expanded, onToggle }: {
  patch: FilePatch;
  mode: ViewMode;
  expanded: boolean;
  onToggle: () => void;
}) {
  const additions = countLines(patch.diff, '+');
  const deletions = countLines(patch.diff, '-');
  const barWidth  = Math.min(100, additions + deletions);
  const addPct    = barWidth > 0 ? (additions / (additions + deletions)) * 100 : 0;

  return (
    <div className="border-t border-gray-800/50">
      {/* File header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-800/30 transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-gray-500" /> : <ChevronRight className="w-3 h-3 text-gray-500" />}
        <FileCode className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
        <span className="text-blue-300 text-xs font-mono flex-1 truncate">{patch.file}</span>

        {/* Additions/deletions bar */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-green-400 text-xs font-mono">+{additions}</span>
          <span className="text-red-400 text-xs font-mono">-{deletions}</span>
          <div className="w-16 h-2 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full flex">
              <div className="bg-green-500 h-full" style={{ width: `${addPct}%` }} />
              <div className="bg-red-500 h-full" style={{ width: `${100 - addPct}%` }} />
            </div>
          </div>
        </div>
      </button>

      {/* Diff content */}
      {expanded && (
        <div className="overflow-x-auto">
          {mode === 'unified'
            ? <UnifiedDiff diff={patch.diff} />
            : <SplitDiff before={patch.before} after={patch.after} />}
        </div>
      )}
    </div>
  );
}

// ── Unified diff ──────────────────────────────────────────────────────────────
function UnifiedDiff({ diff }: { diff: string }) {
  if (!diff) {
    return <div className="px-4 py-3 text-gray-600 text-xs font-mono">No changes</div>;
  }

  const lines = diff.split('\n');

  return (
    <div className="text-xs font-mono">
      {lines.map((line, i) => {
        const isAdd   = line.startsWith('+') && !line.startsWith('+++');
        const isDel   = line.startsWith('-') && !line.startsWith('---');
        const isHunk  = line.startsWith('@');
        const isHead  = line.startsWith('---') || line.startsWith('+++');

        if (isHead) return null;

        return (
          <div
            key={i}
            className={`flex min-w-0 ${
              isAdd  ? 'bg-green-500/10' :
              isDel  ? 'bg-red-500/10'  :
              isHunk ? 'bg-blue-500/10' : ''
            }`}
          >
            <span className={`w-8 flex-shrink-0 text-right pr-2 select-none border-r border-gray-800 ${
              isAdd ? 'text-green-600' : isDel ? 'text-red-600' : 'text-gray-700'
            }`}>
              {isAdd ? <Plus className="w-3 h-3 inline" /> : isDel ? <Minus className="w-3 h-3 inline" /> : isHunk ? <Hash className="w-3 h-3 inline" /> : null}
            </span>
            <span className={`pl-3 py-0.5 whitespace-pre overflow-hidden ${
              isAdd  ? 'text-green-300' :
              isDel  ? 'text-red-300'   :
              isHunk ? 'text-blue-400'  : 'text-gray-400'
            }`}>
              {isHunk ? line : line.slice(1)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Split diff ────────────────────────────────────────────────────────────────
function SplitDiff({ before, after }: { before: string; after: string }) {
  const bLines = before.split('\n');
  const aLines = after.split('\n');
  const maxLen = Math.max(bLines.length, aLines.length);

  return (
    <div className="grid grid-cols-2 divide-x divide-gray-800 text-xs font-mono">
      {/* Before */}
      <div>
        <div className="bg-red-500/10 px-3 py-1 text-red-400 text-xs border-b border-gray-800">Before</div>
        {bLines.map((line, i) => {
          const changed = aLines[i] !== line;
          return (
            <div key={i} className={`flex ${changed ? 'bg-red-500/10' : ''}`}>
              <span className="w-8 text-right pr-2 text-gray-700 select-none border-r border-gray-800 flex-shrink-0">
                {i + 1}
              </span>
              <span className={`pl-2 py-0.5 whitespace-pre ${changed ? 'text-red-300' : 'text-gray-400'}`}>
                {line}
              </span>
            </div>
          );
        })}
      </div>
      {/* After */}
      <div>
        <div className="bg-green-500/10 px-3 py-1 text-green-400 text-xs border-b border-gray-800">After</div>
        {aLines.map((line, i) => {
          const changed = bLines[i] !== line;
          return (
            <div key={i} className={`flex ${changed ? 'bg-green-500/10' : ''}`}>
              <span className="w-8 text-right pr-2 text-gray-700 select-none border-r border-gray-800 flex-shrink-0">
                {i + 1}
              </span>
              <span className={`pl-2 py-0.5 whitespace-pre ${changed ? 'text-green-300' : 'text-gray-400'}`}>
                {line}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function countLines(diff: string, sign: '+' | '-'): number {
  if (!diff) return 0;
  return diff.split('\n').filter(
    (l) => l.startsWith(sign) && !l.startsWith(sign + sign + sign),
  ).length;
}
