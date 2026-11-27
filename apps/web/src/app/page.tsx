import { redirect } from 'next/navigation';

/** The proxy sends visitors without a session to /sign-in; everyone else starts at their home. */
export default function RootPage() {
  redirect('/dashboard');
}
