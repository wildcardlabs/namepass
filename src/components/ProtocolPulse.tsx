/** Radiating rings and animation from the supplied Pulse Core HTML. */
export default function ProtocolPulse() {
  return (
    <div className="protocol-pulse" aria-hidden="true">
      <div className="protocol-pulse-rings">
        {[0, 1, 2, 3].map((ring) => (
          <span className="protocol-pulse-ring" key={ring} />
        ))}
      </div>
    </div>
  );
}
