// Timing mode, total time and shuffle settings — shared by New Test and Test Details.
// `value` holds { timingMode, totalTimeMinutes, shuffle }; `onChange` receives the changed fields.
export default function TestTimingFields({ value, onChange }) {
  const timingMode = value.timingMode || 'PER_QUESTION';
  return (
    <>
      <div className="row row-2">
        <div className="form-group">
          <label>Timing</label>
          <select className="form-control" value={timingMode} onChange={(e) => onChange({ timingMode: e.target.value })}>
            <option value="PER_QUESTION">Per question (each question&apos;s own time limit)</option>
            <option value="TOTAL">Total time for the whole test</option>
          </select>
        </div>
        {timingMode === 'TOTAL' && (
          <div className="form-group">
            <label>Total time (minutes)</label>
            <input
              type="number"
              min="1"
              max="600"
              className="form-control"
              value={value.totalTimeMinutes ?? 30}
              onChange={(e) => onChange({ totalTimeMinutes: e.target.value === '' ? '' : Number(e.target.value) })}
              required
            />
          </div>
        )}
      </div>
      {timingMode === 'TOTAL' && (
        <p className="text-muted" style={{ fontSize: '0.85rem', marginTop: -8 }}>
          One countdown for the whole test. Questions still come one at a time with no going back, and students
          can skip a question. The per-question time limits are ignored.
        </p>
      )}
      <label className="form-check">
        <input type="checkbox" checked={value.shuffle !== false} onChange={(e) => onChange({ shuffle: e.target.checked })} />
        <span>Shuffle questions and options for each student</span>
      </label>
    </>
  );
}
