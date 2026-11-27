import { Fingerprint } from 'lucide-react';
import Link from 'next/link';
import { Button, type ButtonProps } from '@/components/ui/button';

/** Opens the leak tracer, optionally remembering which exam the reviewer came from. */
export function TraceLeakButton({
  examId,
  variant = 'tinted',
  size = 'md',
  label = 'Trace a leak',
  className,
}: {
  examId?: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  label?: string;
  className?: string;
}) {
  const href = examId ? `/integrity/leak-tracer?exam=${encodeURIComponent(examId)}` : '/integrity/leak-tracer';
  return (
    <Button asChild variant={variant} size={size} className={className}>
      <Link href={href}>
        <Fingerprint />
        {label}
      </Link>
    </Button>
  );
}
