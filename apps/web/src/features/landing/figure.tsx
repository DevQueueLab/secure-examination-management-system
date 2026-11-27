'use client';

import { useState } from 'react';
import CountUp from './bits/CountUp';

/**
 * A figure the live draw computes, in tabular numerals. It starts on its server-rendered value and
 * counts from the old value to the new one each time the papers are drawn again.
 */
export function Figure({ value, className }: { value: number; className?: string }) {
  const [first] = useState(value);
  return <CountUp from={first} to={Math.round(value * 10) / 10} decimals={1} duration={0.9} easing="easeOut" trigger="load" className={className} />;
}
