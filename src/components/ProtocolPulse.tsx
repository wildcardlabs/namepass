/** Heartbeat illustration geometry and animations from the supplied Pulse Core HTML. */
export default function ProtocolPulse() {
  return (
    <div className="protocol-pulse" aria-hidden="true">
      <div className="protocol-pulse-rings">
        {[0, 1, 2, 3].map((ring) => (
          <span className="protocol-pulse-ring" key={ring} />
        ))}
      </div>
      <div className="protocol-pulse-center">
        <span className="protocol-pulse-heart">
          <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" />
          </svg>
        </span>
        <svg viewBox="0 0 100 24" className="protocol-pulse-ecg">
          <polyline
            points="0,12 20,12 26,3 32,21 38,12 100,12"
            fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            pathLength="100" strokeDasharray="20 120"
            className="protocol-pulse-trace"
          />
        </svg>
      </div>
    </div>
  );
}
