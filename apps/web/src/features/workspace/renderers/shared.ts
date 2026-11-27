import { contentSchemas, type AttemptItemView, type QuestionContent, type QuestionType } from '@athena/shared';
import { useCallback, useRef } from 'react';
import type { TextEdit } from '../sync/engine';

export type Response = Record<string, unknown> | null;

export interface RendererProps<T extends QuestionType> {
  item: AttemptItemView;
  content: QuestionContent<T>;
  response: Response;
  disabled: boolean;
  /** The question's id prefix for element ids and labels. */
  idBase: string;
  onChange: (response: Response, edit?: TextEdit) => void;
  /** Digit shortcuts (1–9) for the current question; pass null to stop handling them. */
  registerDigits?: (handler: ((digit: number) => void) | null) => void;
}

/**
 * Typed, defaulted content for a renderer. Fields that fail to parse fall back to the raw value, so an
 * unusual question still renders instead of disappearing.
 */
export function parseContent<T extends QuestionType>(type: T, raw: Record<string, unknown>): QuestionContent<T> {
  const parsed = contentSchemas[type].safeParse(raw);
  if (parsed.success) return { ...(parsed.data as QuestionContent<T>), stem: typeof raw.stem === 'string' ? raw.stem : '' };
  return raw as QuestionContent<T>;
}

export function optionLetter(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : String(index + 1);
}

/** Tracks whether the next change to a text field came from a paste, for authorship provenance. */
export function usePasteTracker() {
  const pasted = useRef(false);
  const onPaste = useCallback(() => {
    pasted.current = true;
  }, []);
  const take = useCallback(() => {
    const value = pasted.current;
    pasted.current = false;
    return value;
  }, []);
  return { onPaste, take };
}

export function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
