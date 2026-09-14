import Link from 'next/link';
export default function NotFound() {
  return (
    <section className="page-heading">
      <p className="muted">404</p>
      <h1>Nothing forged here.</h1>
      <p>This page could not be found.</p>
      <Link className="button" href="/">
        Back to FORGE
      </Link>
    </section>
  );
}
