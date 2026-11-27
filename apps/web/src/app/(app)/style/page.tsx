import type { Metadata } from 'next';
import { StyleGuide } from './style-guide';

export const metadata: Metadata = { title: 'Style guide' };

export default function StylePage() {
  return <StyleGuide />;
}
