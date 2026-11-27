'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { errorMessage, isApiError } from '@/lib/api';
import { useCategories, useCreateCategory } from '../../api';

const NONE = '__none';
const NEW = '__new';

/** Category picker that can create a category in place, without leaving the editor. */
export function CategoryField({ value, onChange, error, disabled }: { value: string | null; onChange: (id: string | null) => void; error?: string; disabled?: boolean }) {
  const categories = useCategories();
  const create = useCreateCategory();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>();

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Give the category a name');
      return;
    }
    create.mutate(
      { name: trimmed },
      {
        onSuccess: (c) => {
          onChange(c.id);
          setAdding(false);
          setName('');
          toast.success(`Category “${c.name}” created`);
        },
        onError: (e) => setNameError(isApiError(e) ? (e.fields.name ?? e.message) : errorMessage(e)),
      },
    );
  };

  if (adding) {
    return (
      <Field label="New category" error={nameError}>
        <div className="flex gap-2">
          <Input
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setNameError(undefined);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
              if (e.key === 'Escape') setAdding(false);
            }}
            placeholder="Thermodynamics"
            maxLength={80}
            containerClassName="flex-1"
          />
          <Button variant="tinted" onClick={submit} loading={create.isPending}>
            Add
          </Button>
          <Button variant="plain" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      </Field>
    );
  }

  return (
    <Field label="Category" error={error}>
      <Select
        value={value ?? NONE}
        disabled={disabled}
        onValueChange={(v) => {
          if (v === NEW) setAdding(true);
          else onChange(v === NONE ? null : v);
        }}
        options={[
          { value: NONE, label: 'No category' },
          ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name })),
          { value: NEW, label: (
            <span className="flex items-center gap-1.5 text-accent-text">
              <Plus aria-hidden className="size-3.5" /> New category…
            </span>
          ) },
        ]}
      />
    </Field>
  );
}
