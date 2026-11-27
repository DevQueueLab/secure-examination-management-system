/**
 * Props that run a kit `Table` edge to edge on the page ground: no card, a hairline above and below,
 * and the first and last columns flush with the page content.
 */
export const edgeTable = {
  containerClassName: 'rounded-none bg-transparent ring-0 border-y border-separator',
  className: '[&_tr>*:first-child]:pl-0 [&_tr>*:last-child]:pr-0',
} as const;
