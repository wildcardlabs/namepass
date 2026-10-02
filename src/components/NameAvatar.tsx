import { useEffect, useState } from "react";
import { fetchProfile } from "../lib/ens";

function dicebearUrl(name: string) {
  return `https://api.dicebear.com/10.x/voxel-bot/svg?tags=animation&seed=${encodeURIComponent(name)}`;
}

interface Props {
  name: string;
  className?: string;
}

/** ENS avatar via the resolvio profile API, falling back to a universal DiceBear voxel-bot avatar. */
export default function NameAvatar({ name, className = "" }: Props) {
  const fallback = dicebearUrl(name);
  const [src, setSrc] = useState(() => fallback);

  useEffect(() => {
    let cancelled = false;
    setSrc(fallback);
    fetchProfile(name).then((profile) => {
      if (!cancelled && profile?.avatar) setSrc(profile.avatar);
    });
    return () => {
      cancelled = true;
    };
  }, [name, fallback]);

  return (
    <img
      src={src}
      alt=""
      className={className}
      onError={(e) => {
        const image = e.currentTarget;
        if (image.getAttribute("src") !== fallback) image.src = fallback;
      }}
    />
  );
}
