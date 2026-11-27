import type { Metadata } from 'next';
import { DashboardSwitch } from '@/features/candidate/dashboard-switch';

export const metadata: Metadata = { title: 'Home' };

export default function DashboardPage() {
  return <DashboardSwitch />;
}
