import { Text, View } from '@react-pdf/renderer';
import { base, pdfText } from './theme';

/** A line of metadata as separate pieces held apart by space, rather than joined with separator characters. */
export function MetaRow({ items }: { items: (string | null | undefined | false)[] }) {
  const shown = items.filter((i): i is string => typeof i === 'string' && i.length > 0);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
      {shown.map((t, i) => (
        <Text key={i} style={[base.muted, { marginRight: i < shown.length - 1 ? 14 : 0 }]}>
          {pdfText(t)}
        </Text>
      ))}
    </View>
  );
}
