const COLORS = { High: 'var(--bad)', Medium: 'var(--warn)', Low: 'var(--good)' };

const shortDate = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Stacked weekly bars (High at the base). Accessible: summary label + visually-hidden data table. */
export function WeeklyChart({ trend }) {
  const W = 680, H = 240, padL = 34, padB = 28, padT = 10, padR = 8;
  const totals = trend.map((t) => t.High + t.Medium + t.Low);
  const max = Math.max(4, ...totals);
  const niceMax = Math.ceil(max / 4) * 4;
  const bw = (W - padL - padR) / trend.length;
  const y = (v) => padT + (H - padT - padB) * (1 - v / niceMax);
  const ticks = [0, 1, 2, 3, 4].map((i) => Math.round((niceMax / 4) * i));
  const sum = totals.reduce((a, b) => a + b, 0);

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Weekly offers checked over the last ${trend.length} weeks, ${sum} in total, split by risk level.`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="grid" />
            <text x={padL - 6} y={y(t) + 4} textAnchor="end" className="axis">{t}</text>
          </g>
        ))}
        {trend.map((t, i) => {
          let acc = 0;
          return (
            <g key={t.weekStart}>
              {['High', 'Medium', 'Low'].map((lvl) => {
                const v = t[lvl];
                if (!v) return null;
                const y0 = y(acc), y1 = y(acc + v);
                acc += v;
                return <rect key={lvl} x={padL + i * bw + bw * 0.16} width={bw * 0.68} y={y1} height={Math.max(0, y0 - y1) - 1} fill={COLORS[lvl]} rx="2"><title>{`${shortDate(t.weekStart)}: ${v} ${lvl}`}</title></rect>;
              })}
              {(i % 2 === 0 || trend.length < 7) && <text x={padL + i * bw + bw / 2} y={H - 8} textAnchor="middle" className="axis">{shortDate(t.weekStart)}</text>}
            </g>
          );
        })}
      </svg>
      <figcaption className="legend">
        {['High', 'Medium', 'Low'].map((l) => <span key={l}><i style={{ background: COLORS[l] }} />{l}</span>)}
        <span className="muted">Weeks start on Monday (UTC)</span>
      </figcaption>
      <table className="sr-only">
        <caption>Offers checked per week</caption>
        <thead><tr><th>Week starting</th><th>High</th><th>Medium</th><th>Low</th></tr></thead>
        <tbody>{trend.map((t) => <tr key={t.weekStart}><td>{t.weekStart}</td><td>{t.High}</td><td>{t.Medium}</td><td>{t.Low}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

/** Horizontal bar list. items: [{label, count, pct?}] */
export function BarList({ items, total, color = 'var(--accent)', emptyText = 'No data yet.' }) {
  if (!items.length || items.every((i) => !i.count)) return <p className="muted small">{emptyText}</p>;
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <ul className="barlist">
      {items.map((i) => (
        <li key={i.label}>
          <div className="barlist-top">
            <span>{i.label}</span>
            <span className="num">{i.count}{total ? <span className="muted"> · {Math.round((i.count / total) * 100)}%</span> : null}</span>
          </div>
          <div className="bar-track" aria-hidden="true"><div className="bar-fill" style={{ width: `${(i.count / max) * 100}%`, background: color }} /></div>
        </li>
      ))}
    </ul>
  );
}
