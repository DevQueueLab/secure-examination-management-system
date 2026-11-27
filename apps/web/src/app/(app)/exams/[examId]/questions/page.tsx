import type { Metadata } from 'next';
import { ListChecks } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

export const metadata: Metadata = { title: "No questions in this exam" };

export default function Page() {
  return (
    <EmptyState
      icon={<ListChecks />}
      title="No questions in this exam"
      description="Pick questions from the bank or write new ones. Randomized papers are balanced for difficulty."
    />
  );
}
