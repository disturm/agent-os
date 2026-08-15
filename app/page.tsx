'use client';

import { useState } from 'react';

type Review = {
  verdict: 'approve' | 'revise' | 'needs_human_professional';
  score: number;
  issues: string[];
};

type AgentResult = { plan: string; review: Review; rounds: number };

type State =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'result'; result: AgentResult }
  | { status: 'error'; message: string };

export default function Page() {
  const [task, setTask] = useState('');
  const [state, setState] = useState<State>({ status: 'idle' });

  async function runAgent() {
    setState({ status: 'running' });
    try {
      const response = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `Ошибка ${response.status}`);
      setState({ status: 'result', result: data as AgentResult });
    } catch (err: unknown) {
      setState({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  const running = state.status === 'running';

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
      <h1>Wellness-агент</h1>
      <p style={{ color: '#666' }}>
        Коуч по питанию, тренировкам и восстановлению с обязательной проверкой безопасности. Это не медицинский продукт.
      </p>

      <textarea
        value={task}
        onChange={(e) => setTask(e.target.value)}
        disabled={running}
        rows={4}
        placeholder="Например: составь план питания на завтра"
        style={{ width: '100%', padding: 8, fontFamily: 'inherit', fontSize: 16, boxSizing: 'border-box' }}
      />

      <button
        onClick={runAgent}
        disabled={running || !task.trim()}
        style={{ marginTop: 12, padding: '8px 16px', fontSize: 16, cursor: running ? 'default' : 'pointer' }}
      >
        Run Agent
      </button>

      {running && <p style={{ marginTop: 24 }}>Агент работает…</p>}

      {state.status === 'error' && (
        <p style={{ marginTop: 24, color: '#b00020' }}>Ошибка: {state.message}</p>
      )}

      {state.status === 'result' && <Result result={state.result} />}
    </main>
  );
}

function Result({ result }: { result: AgentResult }) {
  const { plan, review, rounds } = result;
  const needsProfessional = review.verdict === 'needs_human_professional';

  return (
    <section style={{ marginTop: 24, borderTop: '1px solid #ddd', paddingTop: 24 }}>
      {needsProfessional && (
        <p
          style={{
            padding: 16,
            border: '2px solid #b00020',
            background: '#fff2f2',
            color: '#b00020',
            fontWeight: 600,
            fontSize: 18,
          }}
        >
          Этот запрос требует консультации специалиста
        </p>
      )}

      {!needsProfessional && (
        <>
          <h2>План</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', background: '#f6f6f6', padding: 16 }}>{plan}</pre>
        </>
      )}

      <h2>Safety review</h2>
      <p>
        Verdict: <strong>{review.verdict}</strong>
        <br />
        Score: <strong>{review.score}/10</strong>
        <br />
        Раундов: <strong>{rounds}</strong>
      </p>

      <h3>Issues</h3>
      {review.issues.length === 0 ? <p>Замечаний нет.</p> : <ul>{review.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
    </section>
  );
}
