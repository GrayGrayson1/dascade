/**
 * Record tabs: a compact row of the shelf's records (plus "All records") as toggle buttons. The Room DJ tab
 * uses it to browse any record for the room without changing the listener's own record.
 * Renders nothing with a single record.
 */
import type { JukeboxRecord } from '@dascade/shared';
import { ALL_RECORDS, hasShelf } from '../audio/jukebox/index.ts';

export function RecordTabs({
  records,
  value,
  onChange,
  label,
}: {
  records: readonly JukeboxRecord[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  if (!hasShelf(records)) return null;
  const options = [...records.map((r) => ({ id: r.id, title: r.title })), { id: ALL_RECORDS, title: 'All records' }];
  return (
    <div className="jb-record-tabs" role="group" aria-label={label} data-part="record-tabs">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className="jb-record-tab"
          data-record={o.id}
          aria-pressed={o.id === value}
          onClick={() => onChange(o.id)}
        >
          {o.title}
        </button>
      ))}
    </div>
  );
}
