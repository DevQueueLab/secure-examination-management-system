import { notFound } from 'next/navigation';

/** Any unknown URL under the app: hand it to the (app) not-found, so a signed-in 404 keeps the shell. */
export default function MissingPage() {
  notFound();
}
