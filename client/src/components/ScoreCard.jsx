// The student's own score, shown once they have submitted a test
export default function ScoreCard({ result }) {
  if (!result) return null;
  const { score, totalMarks, correctAnswers, totalQuestions, percentage } = result;
  return (
    <div className="score-card" role="status">
      <div className="score-card-label">Your score</div>
      <div className="score-card-value">
        {score}<span className="score-card-total"> / {totalMarks}</span>
      </div>
      <div className="score-card-meter" aria-hidden="true">
        <span style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }} />
      </div>
      <div className="score-card-details">
        <span><strong>{percentage}%</strong></span>
        <span>{correctAnswers} of {totalQuestions} correct</span>
      </div>
    </div>
  );
}
