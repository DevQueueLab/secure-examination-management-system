'use client';

import { Presentation } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

/** Opens the exam room's projector view of this monitor. */
export function HallDisplayLink({ examId }: { examId: string }) {
  return (
    <Button asChild variant="gray" size="sm">
      <Link href={`/exams/${examId}/monitor/hall`}>
        <Presentation aria-hidden />
        Hall display
      </Link>
    </Button>
  );
}
