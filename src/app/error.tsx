'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section className="empty">
      <h1>Something interrupted the flow.</h1>
      <p>Try loading this page again.</p>
      <button className="button" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
