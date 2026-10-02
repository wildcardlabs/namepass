/** ECG geometry and ripple animation from the supplied Pulse Core illustration. */
export default function CoverPulse() {
  return (
    <div className="cover-pulse" aria-hidden="true">
      <div className="cover-pulse-rings">
        {[0, 1, 2, 3].map((ring) => (
          <span className="cover-pulse-ring" key={ring} />
        ))}
      </div>
      <svg viewBox="0 0 100 24" className="cover-pulse-ecg">
        <polyline
          points="0,12 20,12 26,3 32,21 38,12 100,12"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength="100"
          strokeDasharray="20 120"
          className="cover-pulse-trace"
        />
      </svg>
    </div>
  );
}
