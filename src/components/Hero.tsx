import HeroBadge from "./HeroBadge";
import { ArrowRight } from "lucide-react";
import { Button } from "./ui/button";
import CoverGrid from "./CoverGrid";
import { useEffect, useState } from "react";
import { getActivity } from "../lib/publicApi";
import { HeroCommunity, HeroCompanyCarousel } from "./HeroSocial";

/** Shared type, framing and actions introduce the public application. */
export default function Hero({
  onExplore,
  onDocs,
}: {
  onExplore: () => void;
  onDocs: () => void;
}) {
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    getActivity(1, 40)
      .then((activity) => {
        if (!alive) return;
        const renewed = activity.items
          .filter(
            (item) =>
              BigInt(item.renewal.durationSeconds.split(".")[0] || "0") > 0n,
          )
          .map((item) => item.name.displayName);
        setNames([...new Set(renewed)].slice(0, 4));
      })
      .catch(() => {
        // Leave decorative identities empty when public activity is unavailable.
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="home-hero">
      <CoverGrid />
      <div className="home-hero-content">
        <div className="home-hero-copy">
          <HeroBadge />

          <h1 className="text-ink-primary">
            Give a name <span className="text-ink-action">more time</span>
          </h1>

          <p className="text-ink-secondary">
            Send USDC to an ENS name’s deposit address. Watch it turn into
            renewal time.
          </p>
          <div className="home-hero-actions">
            <Button className="primary-action" onClick={onExplore}>
              Get Started
              <ArrowRight size={16} aria-hidden="true" />
            </Button>
            <Button variant="outline" onClick={onDocs}>
              Read the docs
              <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </div>
          <HeroCommunity names={names} />
        </div>
        <HeroCompanyCarousel />
      </div>
    </section>
  );
}
