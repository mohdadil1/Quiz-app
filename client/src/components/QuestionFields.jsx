import RichTextEditor from './RichTextEditor';
import { QUESTION_TYPES, typeOf } from './questionTypes';

const LETTERS = ['a', 'b', 'c', 'd'];

// The question form shared by Add Question and the Edit Question dialog.
// `value` holds the question fields; `onChange` receives just the changed ones.
export default function QuestionFields({ value, onChange }) {
  const type = typeOf(value);
  const correct = String(value.correctAns || '');

  const changeType = (next) => {
    const changes = { type: next };
    // Keep the correct answer valid for the new type
    if (next === 'MCQ') changes.correctAns = correct[0] || 'a';
    if (next === 'MULTI') changes.correctAns = correct || 'a';
    if (next === 'TRUE_FALSE') changes.correctAns = correct === 'b' ? 'b' : 'a';
    onChange(changes);
  };

  const toggleCorrect = (letter) => {
    const set = new Set(correct.split('').filter(Boolean));
    if (set.has(letter)) set.delete(letter); else set.add(letter);
    onChange({ correctAns: [...set].sort().join('') });
  };

  return (
    <>
      <div className="form-group">
        <label>Question type</label>
        <select className="form-control" value={type} onChange={(e) => changeType(e.target.value)}>
          {QUESTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      <div className="form-group">
        <label>Question</label>
        <RichTextEditor value={value.title} onChange={(title) => onChange({ title })} />
      </div>

      {(type === 'MCQ' || type === 'MULTI') && (
        <>
          <div className="row row-2">
            {LETTERS.map((l) => (
              <div className="form-group" key={l}>
                <label>Option {l.toUpperCase()}</label>
                <input
                  className="form-control"
                  value={value[`option${l.toUpperCase()}`] ?? ''}
                  onChange={(e) => onChange({ [`option${l.toUpperCase()}`]: e.target.value })}
                  required
                />
              </div>
            ))}
          </div>
          {type === 'MCQ' ? (
            <div className="form-group">
              <label>Correct answer</label>
              <select className="form-control" value={correct[0] || 'a'} onChange={(e) => onChange({ correctAns: e.target.value })}>
                {LETTERS.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
              </select>
            </div>
          ) : (
            <div className="form-group">
              <label>Correct answers (tick every correct option)</label>
              <div className="choice-row">
                {LETTERS.map((l) => (
                  <label className="form-check" key={l}>
                    <input type="checkbox" checked={correct.includes(l)} onChange={() => toggleCorrect(l)} />
                    <span>{l.toUpperCase()}</span>
                  </label>
                ))}
              </div>
              <p className="text-muted form-hint">Students get the marks only if they tick exactly these options.</p>
            </div>
          )}
        </>
      )}

      {type === 'TRUE_FALSE' && (
        <div className="form-group">
          <label>Correct answer</label>
          <div className="choice-row">
            {[['a', 'True'], ['b', 'False']].map(([l, text]) => (
              <label className="form-check" key={l}>
                <input type="radio" name="tf-correct" checked={(correct || 'a') === l} onChange={() => onChange({ correctAns: l })} />
                <span>{text}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {type === 'NUMERIC' && (
        <div className="row row-2">
          <div className="form-group">
            <label>Correct answer (number)</label>
            <input
              type="number"
              step="any"
              className="form-control"
              value={value.correctNumber ?? ''}
              onChange={(e) => onChange({ correctNumber: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label>Accept answers within ±</label>
            <input
              type="number"
              step="any"
              min="0"
              className="form-control"
              value={value.tolerance ?? 0}
              onChange={(e) => onChange({ tolerance: e.target.value })}
            />
            <p className="text-muted form-hint">0 means the answer must match exactly.</p>
          </div>
        </div>
      )}

      <div className="row row-2">
        <div className="form-group">
          <label>Marks</label>
          <input
            type="number"
            min="0.5"
            step="0.5"
            className="form-control"
            value={value.score}
            onChange={(e) => onChange({ score: e.target.value })}
            required
          />
        </div>
        <div className="form-group">
          <label>Time limit (minutes)</label>
          <input
            type="number"
            min="0.25"
            step="0.25"
            className="form-control"
            value={value.timeLimit}
            onChange={(e) => onChange({ timeLimit: e.target.value })}
            required
          />
        </div>
      </div>
    </>
  );
}
