// Optional scheduled start / end — shared by New Test and Test Details.
// `value` holds { startAt, endAt } as ISO strings (or null); `onChange` receives the changed fields.

// ISO → the "YYYY-MM-DDTHH:mm" a datetime-local input wants, in the teacher's own time zone
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// datetime-local value (local time) → ISO, or null when cleared
const fromLocalInput = (text) => (text ? new Date(text).toISOString() : null);

export function formatWhen(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function TestScheduleFields({ value, onChange }) {
  return (
    <>
      <div className="schedule-fields">
        <div className="form-group">
          <label>Opens at (optional)</label>
          <input
            type="datetime-local"
            className="form-control"
            value={toLocalInput(value.startAt)}
            onChange={(e) => onChange({ startAt: fromLocalInput(e.target.value) })}
          />
        </div>
        <div className="form-group">
          <label>Closes at (optional)</label>
          <input
            type="datetime-local"
            className="form-control"
            value={toLocalInput(value.endAt)}
            min={toLocalInput(value.startAt) || undefined}
            onChange={(e) => onChange({ endAt: fromLocalInput(e.target.value) })}
          />
        </div>
      </div>
      <p className="text-muted form-hint" style={{ marginTop: -8, marginBottom: 16 }}>
        At the opening time a PENDING test switches to RUNNING by itself; at the closing time it is marked
        COMPLETED and answers sent after that are refused. Leave both empty to start and end the test by hand.
      </p>
    </>
  );
}
