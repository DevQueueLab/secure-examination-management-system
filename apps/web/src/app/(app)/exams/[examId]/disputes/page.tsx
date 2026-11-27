import type { Metadata } from 'next';
import { ExamDisputes } from '@/features/disputes/components/exam-disputes';

export const metadata: Metadata = { title: 'Disputes' };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ examId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { examId } = await params;
  const sp = await searchParams;
  return <ExamDisputes examId={examId} remedyQuestionId={one(sp.remedy) ?? null} disputeId={one(sp.dispute) ?? null} />;
}
