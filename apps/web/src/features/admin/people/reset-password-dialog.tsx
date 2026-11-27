'use client';

import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { useConfirm } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { CredentialCard } from '../components/credentials';
import type { Person } from '../types';

/** Shows a freshly issued temporary password once. Closing without copying asks first. */
export function ResetPasswordDialog({
  result,
  onClose,
}: {
  result: { person: Person; password: string } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const confirm = useConfirm();

  const close = async () => {
    if (!copied) {
      const ok = await confirm({
        title: 'Close without copying?',
        description: 'This password can’t be shown again. You would need to reset it once more.',
        confirmLabel: 'Close',
        destructive: true,
      });
      if (!ok) return;
    }
    setCopied(false);
    onClose();
  };

  return (
    <Dialog open={!!result} onOpenChange={(open) => !open && void close()}>
      {result && (
        <DialogContent
          size="md"
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            void close();
          }}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader
            title={`New password for ${result.person.name}`}
            description="Give it to them privately. They’ll choose their own password when they sign in."
          />
          <DialogBody className="flex flex-col gap-4">
            <CredentialCard
              credential={{
                name: result.person.name,
                email: result.person.email,
                temporaryPassword: result.password,
              }}
              onCopied={() => setCopied(true)}
            />
            <p className="flex items-center gap-2 text-footnote text-label-secondary">
              <LogOut aria-hidden className="size-3.5" /> {result.person.name} was signed out on
              every device.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="filled" onClick={() => void close()}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}
