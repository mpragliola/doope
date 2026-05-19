import { useEffect, useState } from 'react';
import type { DuplicateGroup, FileInfo } from '../types';
import { FileCard } from './FileCard';
import { Lightbox } from './Lightbox';
import { useResultsStore } from '../stores/useResultsStore';

interface ComparisonPanelProps {
  group: DuplicateGroup;
}

function commonPathPrefix(paths: string[]): string {
  if (paths.length < 2) return '';
  const tokens = paths.map((p) => p.split(/([\\/])/));
  const first = tokens[0];
  let i = 0;
  while (i < first.length && tokens.every((t) => i < t.length && t[i] === first[i])) {
    i++;
  }
  const prefix = first.slice(0, i);
  while (prefix.length > 0 && /^[\\/]$/.test(prefix[prefix.length - 1])) {
    prefix.pop();
  }
  return prefix.join('');
}

export function ComparisonPanel({ group }: ComparisonPanelProps) {
  const { marks, markFile, unmarkFile } = useResultsStore();
  const [lightboxFile, setLightboxFile] = useState<FileInfo | null>(null);
  const [dims, setDims] = useState<Map<string, { w: number; h: number }>>(new Map());
  const [warnPath, setWarnPath] = useState<string | null>(null);

  useEffect(() => {
    setDims(new Map());
    setWarnPath(null);
  }, [group.id]);

  const maxPx = Math.max(0, ...[...dims.values()].map(({ w, h }) => w * h));
  const imageFiles = group.files.filter((f) => f.media_type === 'image');
  const commonPrefix = commonPathPrefix(group.files.map((f) => f.path));

  function tryDelete(f: FileInfo) {
    const survivors = group.files.filter((fi) => fi.path !== f.path && !marks.has(fi.path)).length;
    if (survivors === 0) {
      setWarnPath(f.path);
    } else {
      markFile(f.path);
      setWarnPath(null);
    }
  }

  return (
    <div className="flex-1 flex flex-row overflow-x-auto gap-[3px] p-1 bg-[#0d0d0d] min-h-0">
      {group.files.map((f) => {
        const dim = dims.get(f.path);
        const px = dim ? dim.w * dim.h : 0;
        return (
          <FileCard
            key={f.path}
            file={f}
            isMarked={marks.has(f.path)}
            dim={dim}
            isBest={maxPx > 0 && px === maxPx}
            isWarn={warnPath === f.path}
            commonPrefix={commonPrefix}
            onLoad={(path, w, h) => setDims((prev) => new Map(prev).set(path, { w, h }))}
            onClickImage={() => setLightboxFile(f)}
            onKeep={() => { unmarkFile(f.path); setWarnPath(null); }}
            onDelete={() => tryDelete(f)}
            onWarnConfirm={() => { markFile(f.path); setWarnPath(null); }}
            onWarnCancel={() => setWarnPath(null)}
          />
        );
      })}

      {lightboxFile && (
        <Lightbox
          imageFiles={imageFiles}
          initialIndex={imageFiles.findIndex((f) => f.path === lightboxFile.path)}
          onClose={() => setLightboxFile(null)}
        />
      )}
    </div>
  );
}
