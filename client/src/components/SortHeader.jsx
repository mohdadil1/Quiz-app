// Click-to-sort table headers for student lists (USN / Name), shared by View Data and Student Credentials.

export const DEFAULT_SORT = { key: 'rollno', dir: 'asc' };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

// Sort rows by `key` ('rollno' or 'name'). Natural order (CS2 before CS10); blank values always go last.
export function sortStudents(rows, { key, dir }) {
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = (a[key] ?? '').toString().trim();
    const y = (b[key] ?? '').toString().trim();
    if (!x || !y) return !x && !y ? 0 : !x ? 1 : -1;
    return sign * collator.compare(x, y);
  });
}

// Clicking the active column flips the direction; clicking another column sorts it ascending
export function nextSort(current, key) {
  return { key, dir: current.key === key && current.dir === 'asc' ? 'desc' : 'asc' };
}

export default function SortHeader({ label, sortKey, sort, onSort }) {
  const active = sort.key === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{ cursor: 'pointer', userSelect: 'none' }}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      title={`Sort by ${label}`}
    >
      {label} <span className={active ? '' : 'text-muted'}>{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
    </th>
  );
}
