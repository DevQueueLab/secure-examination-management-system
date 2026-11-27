import type { Metadata } from 'next';
import { DisputePage } from '@/features/disputes/components/candidate-dispute';

export const metadata: Metadata = { title: 'Dispute' };

export default async function Page({ params }: { params: Promise<{ disputeId: string }> }) {
  const { disputeId } = await params;
  return <DisputePage id={disputeId} from="staff" />;
}
