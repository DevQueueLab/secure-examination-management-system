import type { Metadata } from 'next';
import { CertificateView } from '@/features/results/certificate/certificate-view';

export const metadata: Metadata = { title: 'Certificate' };

export default async function Page({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  return <CertificateView attemptId={attemptId} />;
}
