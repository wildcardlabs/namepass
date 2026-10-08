import NameAvatar from "./NameAvatar";

/** Retain Feature Page 03's composition and marquee with Namepass identities. */
const ecosystem = [
  // Source artboards and lettering bounds measured from the supplied SVGs.
  // Align the main letter bodies; ascenders and symbols must not shift the row.
  {
    name: "Arc",
    key: "arc",
    canvas: [500, 171],
    left: 0,
    width: 500,
    textHeight: 149.767,
    wordCenterY: 110.8615,
    target: 18,
  },
  {
    name: "Goldsky",
    key: "goldsky",
    canvas: [94, 24],
    left: 0,
    width: 94,
    textHeight: 11.055,
    wordCenterY: 12.1825,
    target: 15.2,
  },
  {
    name: "Arbitrum",
    key: "arbitrum",
    canvas: [1317.08, 516.24],
    left: 121.27,
    width: 1074.68,
    textHeight: 70.36,
    wordCenterY: 258.11,
    target: 11.2,
  },
  {
    name: "Circle",
    key: "circle",
    canvas: [324.2, 83],
    left: 0,
    width: 324.2,
    textHeight: 45.903,
    wordCenterY: 41.6515,
    target: 16,
  },
  {
    name: "ENS",
    key: "ens",
    canvas: [300, 94],
    left: 0,
    width: 300,
    textHeight: 70.334,
    wordCenterY: 47.2327,
    target: 16,
  },
  {
    name: "Ethereum",
    key: "ethereum",
    canvas: [1920, 1080],
    left: 420,
    width: 1080,
    textHeight: 147.7,
    wordCenterY: 560.85,
    target: 20,
  },
  {
    name: "Base",
    key: "base",
    canvas: [1280, 323.84],
    left: 0,
    width: 1280,
    textHeight: 323.83,
    wordCenterY: 202.04,
    target: 20,
  },
  {
    name: "USDC",
    key: "usdc",
    canvas: [486, 141],
    left: 0,
    width: 486,
    textHeight: 86.754,
    wordCenterY: 70.1861,
    target: 16,
  },
  {
    name: "Resolvio",
    key: "resolvio",
    canvas: [1112, 193],
    left: 0,
    width: 1112,
    textHeight: 167.67,
    wordCenterY: 117.8226,
    target: 20,
  },
];
export function HeroCommunity({
  names,
  trackedNames,
}: {
  names: string[];
  trackedNames: string | null;
}) {
  return (
    <div className="hero-community flex items-center rounded-full border p-1.5">
      {names.length > 0 && (
        <span
          data-slot="avatar-group"
          className="flex -space-x-2"
          aria-hidden="true"
        >
          {names.slice(0, 4).map((name) => (
            <span
              key={name}
              data-slot="avatar"
              className="hero-template-avatar relative flex size-8 shrink-0 select-none rounded-full ring-2 ring-white"
            >
              <NameAvatar
                name={name}
                className="hero-ens-avatar aspect-square size-full rounded-full object-cover"
              />
            </span>
          ))}
        </span>
      )}
      <span className="hero-community-copy px-2">
        {trackedNames === null ? (
          <>ENS names tracked</>
        ) : (
          <>
            <span>
              {trackedNames} ENS {trackedNames === "1" ? "name" : "names"}
            </span>{" "}
            tracked
          </>
        )}
      </span>
    </div>
  );
}

export function HeroCompanyCarousel() {
  return (
    <div
      className="hero-company-carousel relative w-full max-w-3xl"
      role="group"
      aria-label="Technology and infrastructure"
    >
      <p className="hero-ecosystem-label">Built on trusted infrastructure</p>
      <div className="hero-company-marquee group flex gap-(--marquee-gap) overflow-hidden p-3 flex-row *:items-center">
        {[0, 1, 2, 3].map((copy) => (
          <div
            key={copy}
            aria-hidden={copy > 0 ? true : undefined}
            className="hero-company-track flex shrink-0 justify-around gap-(--marquee-gap) flex-row"
          >
            {ecosystem.map((item) => {
              const scale = item.target / item.textHeight;
              return (
                <div
                  key={item.key}
                  className="hero-ecosystem-mark"
                  style={{ width: item.width * scale }}
                >
                  <img
                    src={`/logos/infrastructure/${item.key}.svg`}
                    alt={copy === 0 ? item.name : ""}
                    style={{
                      width: item.canvas[0] * scale,
                      height: item.canvas[1] * scale,
                      left: -item.left * scale,
                      top: 32 - item.wordCenterY * scale,
                    }}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
