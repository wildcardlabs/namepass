import NameAvatar from "./NameAvatar";
import { IS_TESTNET, TOKEN_CHAINS } from "../lib/chains";

/** Retain Feature Page 03's composition and marquee with Namepass identities. */
const ecosystem = [
  { name: "ENS", src: "/logos/ens-mark-dark-blue.svg" },
  { name: "USDC", src: "/logos/usdc.svg" },
  ...TOKEN_CHAINS.map((chain) => ({
    name: chain.name,
    src: `/logos/${chain.logo}`,
  })),
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
      aria-label={
        IS_TESTNET
          ? "ENS, USDC and supported testnets"
          : "ENS, USDC and supported networks"
      }
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
            {ecosystem.map((item) => (
              <div key={item.name} className="hero-ecosystem-mark">
                <img src={item.src} alt="" />
                <span>{item.name}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
