import { useState } from 'react';
import { useStore } from '../store';

export function QuizScene() {
  const quiz = useStore((s) => s.inst!.bench?.quiz ?? []);
  const pass = useStore((s) => s.inst!.bench?.quizPass ?? quiz.length);
  const flags = useStore((s) => s.world!.flags);
  const dispatch = useStore((s) => s.dispatch);
  const answered = quiz.map((_, i) => (flags[`quiz:${i}:correct`] ? 'right' : flags[`quiz:${i}:wrong`] ? 'wrong' : null));
  const firstOpen = answered.findIndex((a) => a === null);
  const [idx, setIdx] = useState(firstOpen < 0 ? quiz.length : firstOpen);
  const [picked, setPicked] = useState<number | null>(null);
  const right = answered.filter((a) => a === 'right').length;
  if (idx >= quiz.length)
    return (
      <div className="bench">
        <div className="quiz card" style={{ textAlign: 'center' }}>
          <h2>
            {right}/{quiz.length} correct
          </h2>
          <p className={right >= pass ? 'pill-ok' : 'pill-bad'}>{right >= pass ? '✓ Passed. Hit "Finish & review".' : `You needed ${pass}. Review the answers, then retry with a new variation.`}</p>
          {quiz.map((q, i) => (
            <div key={i} style={{ textAlign: 'left', marginTop: 10, fontSize: 13 }}>
              <b>
                {answered[i] === 'right' ? '✓' : '✗'} {q.q}
              </b>
              <div className="muted">
                → {q.options[q.answer]}. {q.why}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  const q = quiz[idx];
  return (
    <div className="bench">
      <div className="quiz">
        <div className="row">
          <span className="tag">
            Question {idx + 1} / {quiz.length}
          </span>
          <div className="spacer" />
          <span className="muted">{right} correct so far</span>
        </div>
        <h2 style={{ margin: '14px 0' }}>{q.q}</h2>
        {q.options.map((o, i) => (
          <button
            key={i}
            className={`qopt ${picked !== null && i === q.answer ? 'right' : ''} ${picked === i && i !== q.answer ? 'wrong' : ''}`}
            disabled={picked !== null}
            onClick={() => {
              setPicked(i);
              dispatch({ type: 'setFlag', name: `quiz:${idx}:${i === q.answer ? 'correct' : 'wrong'}` });
            }}
          >
            {String.fromCharCode(65 + i)}. {o}
          </button>
        ))}
        {picked !== null && (
          <div className="card" style={{ marginTop: 10 }}>
            <b className={picked === q.answer ? 'pill-ok' : 'pill-bad'}>{picked === q.answer ? 'Correct.' : 'Not quite.'}</b> {q.why}
            <div className="row" style={{ marginTop: 10 }}>
              <div className="spacer" />
              <button
                className="btn primary"
                onClick={() => {
                  setPicked(null);
                  setIdx(idx + 1);
                }}
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
