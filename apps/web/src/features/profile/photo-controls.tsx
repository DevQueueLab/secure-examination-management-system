'use client';

import { useQuery } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toaster';
import { api, errorMessage } from '@/lib/api';
import { avatarUrl, bumpAvatarVersion, useAvatarVersion } from './avatar-photo';

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const OUTPUT_SIZE = 256;

/**
 * Centre-crops to a square and re-encodes to 256x256 WebP on a canvas. Drawing to a canvas keeps only
 * pixels, so EXIF and GPS data never leave the device.
 */
async function toSquareWebp(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const sx = Math.round((bitmap.width - side) / 2);
    const sy = Math.round((bitmap.height - side) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser can’t prepare the photo. Try another browser.');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
    if (!blob) throw new Error('This browser can’t prepare the photo. Try another browser.');
    return blob;
  } finally {
    bitmap.close();
  }
}

/** Whether this person has a photo right now (the photo endpoint answers 204 when not). */
function useHasPhoto(userId: string) {
  const v = useAvatarVersion();
  return useQuery({
    queryKey: ['files', 'avatar', userId, v],
    queryFn: async () => {
      const res = await fetch(avatarUrl(userId, v), { credentials: 'include' });
      return res.status === 200;
    },
    staleTime: 60_000,
  });
}

/** The "Photo" row of the Account group. The buttons wrap under the text on narrow screens. */
export function PhotoRow({ userId }: { userId: string }) {
  return (
    <div role="listitem" className="relative flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2" style={{ '--inset': '1rem' } as CSSProperties}>
      <span className="flex min-w-[13rem] flex-1 flex-col py-0.5">
        <span className="text-body text-label">Photo</span>
        <span className="text-subheadline text-label-secondary">Proctors use it to confirm who is sitting an exam. JPEG, PNG or WebP, up to 5 MB.</span>
      </span>
      <PhotoControls userId={userId} />
    </div>
  );
}

/** "Upload photo" and "Remove photo" for the signed-in person. */
export function PhotoControls({ userId }: { userId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const hasPhoto = useHasPhoto(userId).data === true;

  async function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      toast.error('Choose a JPEG, PNG or WebP image for your photo.');
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      toast.error('That image is larger than 5 MB. Choose a smaller one.');
      return;
    }
    setBusy('upload');
    try {
      const blob = await toSquareWebp(file);
      await api.put('/files/avatar', blob, { headers: { 'Content-Type': blob.type || 'image/webp' } });
      bumpAvatarVersion(userId);
      toast.success('Your new photo is saved.');
    } catch (err) {
      toast.error(err instanceof DOMException ? 'Athena couldn’t read that image. Try another file.' : errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function onRemove() {
    setBusy('remove');
    try {
      await api.del('/files/avatar');
      bumpAvatarVersion(userId);
      toast.success('Your photo has been removed.');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input ref={input} type="file" accept={ACCEPTED.join(',')} className="sr-only" tabIndex={-1} aria-hidden onChange={onPick} />
      <Button size="sm" variant="gray" loading={busy === 'upload'} disabled={busy !== null} onClick={() => input.current?.click()}>
        Upload photo
      </Button>
      {hasPhoto && (
        <Button size="sm" variant="destructive-tinted" loading={busy === 'remove'} disabled={busy !== null} onClick={() => void onRemove()}>
          Remove photo
        </Button>
      )}
    </div>
  );
}
