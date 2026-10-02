import NameAvatar from "./NameAvatar";

/** Retain Feature Page 03's composition and marquee with Namepass identities. */
const ecosystem = [
  // Source artboard, visible artwork bounds and lettering baseline, measured
  // from the supplied SVGs. Size the lettering, not the surrounding symbol.
  {
    name: "Arc",
    key: "arc",
    canvas: [500, 171],
    left: 0,
    width: 500,
    textHeight: 149.767,
    baseline: 164.77,
    target: 18,
  },
  {
    name: "Goldsky",
    key: "goldsky",
    canvas: [94, 24],
    left: 0,
    width: 94,
    textHeight: 11.055,
    baseline: 17.71,
    target: 15.2,
  },
  {
    name: "Arbitrum",
    key: "arbitrum",
    canvas: [1317.08, 516.24],
    left: 121.27,
    width: 1074.68,
    textHeight: 70.36,
    baseline: 293.29,
    target: 11.2,
  },
  {
    name: "Circle",
    key: "circle",
    canvas: [324.2, 83],
    left: 0,
    width: 324.2,
    textHeight: 45.903,
    baseline: 64.603,
    target: 16,
  },
  {
    name: "ENS",
    key: "ens",
    canvas: [300, 94],
    left: 0,
    width: 300,
    textHeight: 70.334,
    baseline: 82.4,
    target: 16,
  },
  {
    name: "Ethereum",
    key: "ethereum",
    canvas: [1920, 1080],
    left: 420,
    width: 1080,
    textHeight: 147.7,
    baseline: 602.4,
    target: 20,
  },
  {
    name: "Base",
    key: "base",
    canvas: [1280, 323.84],
    left: 0,
    width: 1280,
    textHeight: 323.83,
    baseline: 323.83,
    target: 20,
  },
  {
    name: "USDC",
    key: "usdc",
    canvas: [486, 141],
    left: 0,
    width: 486,
    textHeight: 86.754,
    baseline: 113.563,
    target: 16,
  },
];
const portraitPositions = [
  { position: "absolute -top-14 left-50", size: "size-16" },
  { position: "absolute top-0 left-8", size: "size-20.5" },
  { position: "absolute top-40 left-42", size: "size-16" },
  { position: "absolute bottom-36 left-8", size: "size-13" },
  { position: "absolute -top-14 right-50", size: "size-16" },
  { position: "absolute top-0 right-8", size: "size-20.5" },
  { position: "absolute top-40 right-42", size: "size-16" },
  { position: "absolute right-8 bottom-36", size: "size-13" },
];

export function HeroCommunity({ names }: { names: string[] }) {
  return (
    <div className="hero-community flex items-center rounded-full border p-1.5">
      {names.length > 0 && (
        <div
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
        </div>
      )}
      <p className="px-2">
        Used by <span>685+ users</span>
      </p>
    </div>
  );
}

export function HeroPortraits({ names }: { names: string[] }) {
  return (
    <div
      className="hero-portraits pointer-events-none absolute inset-0 max-lg:hidden"
      aria-hidden="true"
    >
      {portraitPositions.map(({ position, size }, index) => {
        const name = index === 7 ? "stevegachau.eth" : names[index];
        if (!name) return null;
        return (
          <div
            key={index}
            className={`${position} hero-identity ${size} ${index === 0 || index === 4 ? "hero-identity-upper" : ""}`}
          >
            <span
              data-slot="avatar"
              className={`hero-template-avatar relative flex shrink-0 select-none rounded-full ring-2 ring-white ${size}`}
            >
              <NameAvatar
                name={name}
                className="hero-ens-avatar aspect-square size-full rounded-full object-cover"
              />
            </span>
          </div>
        );
      })}
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
      <div className="hero-company-fade hero-company-fade-left pointer-events-none absolute inset-y-0 left-0 z-1 w-15" />
      <div className="hero-company-fade hero-company-fade-right pointer-events-none absolute inset-y-0 right-0 z-1 w-15" />
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
                      top: 32 - (item.baseline - item.textHeight / 2) * scale,
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
