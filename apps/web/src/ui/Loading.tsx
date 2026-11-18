// What a screen looks like while its figures load: the shape of the page, shimmering, instead of "…".
export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skel" aria-busy="true" aria-label="Loading">
      <div className="skel-h" />
      <div className="skel-kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="skel-k" />)}</div>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skel-card" />)}
    </div>
  );
}
