'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, FolderOpen, Image as ImageIcon, Trash2 } from 'lucide-react';
import { useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/alert-dialog';
import { GroupedList, GroupedListItem, IconTile } from '@/components/ui/grouped-list';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toaster';
import { API_BASE, api, errorMessage } from '@/lib/api';

export type DocumentCategory = 'identity' | 'accommodation' | 'other';

export interface UserDocument {
  id: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  category: DocumentCategory;
  createdAt: string;
}

interface DocumentList {
  items: UserDocument[];
  max: number;
}

export const CATEGORY_LABEL: Record<DocumentCategory, string> = {
  identity: 'Identity document',
  accommodation: 'Accommodation request',
  other: 'Other',
};

const CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABEL) as DocumentCategory[]).map((value) => ({ value, label: CATEGORY_LABEL[value] }));
const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX = 10;

const TYPE_LABEL: Record<string, string> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Day first, so the date reads cleanly inside the comma-separated details line.
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** One row per document: name, then category, type, size and date in one line under it. */
export function DocumentRow({ doc, onDelete, deleting }: { doc: UserDocument; onDelete?: () => void; deleting?: boolean }) {
  const isPdf = doc.mime === 'application/pdf';
  return (
    <GroupedListItem
      icon={<IconTile tone="gray">{isPdf ? <FileText /> : <ImageIcon />}</IconTile>}
      title={doc.filename}
      description={`${CATEGORY_LABEL[doc.category] ?? 'Other'}, ${TYPE_LABEL[doc.mime] ?? 'File'}, ${formatBytes(doc.sizeBytes)}, ${dateFormat.format(new Date(doc.createdAt))}`}
      accessory={
        <span className="flex items-center gap-1">
          <Button asChild size="icon-sm" variant="ghost">
            <a href={`${API_BASE}/files/documents/${encodeURIComponent(doc.id)}`} download={doc.filename} aria-label={`Download ${doc.filename}`}>
              <Download aria-hidden />
            </a>
          </Button>
          {onDelete && (
            <Button size="icon-sm" variant="ghost" loading={deleting} aria-label={`Delete ${doc.filename}`} onClick={onDelete}>
              <Trash2 aria-hidden />
            </Button>
          )}
        </span>
      }
    />
  );
}

const DOCUMENTS_KEY = ['files', 'documents'] as const;

/** The signed-in person's own documents: upload, list, download and delete. */
export function DocumentsSection() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const input = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<DocumentCategory>('identity');
  const list = useQuery({ queryKey: DOCUMENTS_KEY, queryFn: () => api.get<DocumentList>('/files/documents') });
  const items = list.data?.items ?? [];
  const max = list.data?.max ?? DEFAULT_MAX;
  const full = items.length >= max;

  const upload = useMutation({
    mutationFn: (file: File) =>
      api.post<{ document: UserDocument }>('/files/documents', file, {
        query: { filename: file.name, category },
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        timeoutMs: 120_000,
      }),
    onSuccess: ({ document }) => {
      toast.success(`${document.filename} is uploaded.`);
      void queryClient.invalidateQueries({ queryKey: DOCUMENTS_KEY });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (doc: UserDocument) => api.del(`/files/documents/${encodeURIComponent(doc.id)}`),
    onSuccess: (_data, doc) => {
      toast.success(`${doc.filename} is deleted.`);
      void queryClient.invalidateQueries({ queryKey: DOCUMENTS_KEY });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.type && !ACCEPTED.includes(file.type)) {
      toast.error('Upload a PDF, JPEG, PNG or WebP file.');
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error('That file is larger than 5 MB. Upload a smaller copy.');
      return;
    }
    upload.mutate(file);
  }

  async function onDelete(doc: UserDocument) {
    const ok = await confirm({
      title: `Delete ${doc.filename}?`,
      description: 'Administrators in your organization will no longer be able to see it.',
      confirmLabel: 'Delete document',
      destructive: true,
    });
    if (ok) remove.mutate(doc);
  }

  return (
    <section id="documents" aria-labelledby="documents-title" className="flex max-w-2xl scroll-mt-24 flex-col gap-2">
      <h2 id="documents-title" className="flex items-center gap-2 px-1 text-footnote font-semibold text-label-secondary">
        <FolderOpen aria-hidden className="size-3.5" /> Documents
      </h2>
      <GroupedList
        footer={`PDF, JPEG, PNG or WebP, up to 5 MB each. Administrators in your organization can see these. You’ve used ${items.length} of ${max}.`}
      >
        {list.isPending ? (
          <div role="listitem" className="relative flex min-h-11 items-center gap-3 px-4 py-2 text-callout text-label-secondary">
            <Spinner size={15} label={null} /> Loading your documents
          </div>
        ) : list.isError ? (
          <GroupedListItem title="Your documents didn’t load." description={errorMessage(list.error)} accessory={<Button size="sm" onClick={() => void list.refetch()}>Try again</Button>} />
        ) : items.length === 0 ? (
          <GroupedListItem title="You haven’t added any documents." description="Add an identity document or an accommodation request for your organization to review." />
        ) : (
          items.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} deleting={remove.isPending && remove.variables?.id === doc.id} onDelete={() => void onDelete(doc)} />
          ))
        )}
        <div role="listitem" className="relative flex flex-wrap items-center gap-2 px-4 py-2.5" style={{ '--inset': '1rem' } as CSSProperties}>
          <input ref={input} type="file" accept={ACCEPTED.join(',')} className="sr-only" tabIndex={-1} aria-hidden onChange={onPick} />
          <div className="min-w-[11rem] flex-1 sm:max-w-[15rem]">
            <Select
              aria-label="Document category"
              size="sm"
              value={category}
              onValueChange={(v) => setCategory(v as DocumentCategory)}
              options={CATEGORY_OPTIONS}
            />
          </div>
          <Button size="sm" variant="gray" loading={upload.isPending} disabled={full || upload.isPending} onClick={() => input.current?.click()}>
            Upload document
          </Button>
          {full && <span className="text-footnote text-label-secondary">Delete a document to add another.</span>}
        </div>
      </GroupedList>
    </section>
  );
}
