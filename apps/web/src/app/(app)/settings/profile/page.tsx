import type { Metadata } from 'next';
import { ProfileView } from '@/features/admin/profile/profile-view';

export const metadata: Metadata = { title: 'Profile & preferences' };

export default function ProfilePage() {
  return <ProfileView />;
}
