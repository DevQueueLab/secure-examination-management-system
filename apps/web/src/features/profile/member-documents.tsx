'use client';

import { useQuery } from '@tanstack/react-query';
import { GroupedList } from '@/components/ui/grouped-list';
import { api } from '@/lib/api';
import { DocumentRow, type UserDocument } from './documents-section';

/**
 * A member's documents for their organization's administrators, read-only, inside the People sheet.
 * The API answers 404 to anyone else, and then this renders nothing.
 */
export function MemberDocuments({ userId }: { userId: string }) {
  const list = useQuery({
    queryKey: ['files', 'member-documents', userId],
    queryFn: () => api.get<{ items: UserDocument[]; max: number }>(`/files/users/${encodeURIComponent(userId)}/documents`),
    retry: false,
  });
  if (!list.isSuccess) return null;
  const items = list.data.items;

  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <div className="min-w-0">
        <p className="text-callout font-medium text-label">Documents</p>
        <p className="text-footnote text-label-secondary">
          {items.length === 0 ? 'They haven’t uploaded any documents.' : 'Files they uploaded from their profile. Downloads are recorded in the audit log.'}
        </p>
      </div>
      {items.length > 0 && (
        <GroupedList className="[&>div]:bg-fill-secondary">
          {items.map((doc) => (
            <DocumentRow key={doc.id} doc={doc} />
          ))}
        </GroupedList>
      )}
    </div>
  );
}
