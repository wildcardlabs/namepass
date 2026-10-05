# Cover infrastructure wordmarks

Exact SVG assets supplied by the user. Source geometry and colours are retained.
The cover applies monochrome styling and optical sizing in CSS.

| File | Source |
| --- | --- |
| arc.svg | https://imglink.cc/cdn/L-LEdBwPA_.svg |
| goldsky.svg | https://goldsky.com/brand/goldsky-combomark-color-dark.svg |
| arbitrum.svg | https://imglink.cc/cdn/rBAsb3CDsy.svg |
| circle.svg | https://cdn.brandfetch.io/iduqAVaA_O/theme/dark/logo.svg?c=1dxbfHSJFAPEGdCLU4o5B |
| ens.svg | https://ens.domains/assets/brand/logo/ens-logo-Blue.svg |
| ethereum.svg | https://cdn.brandfetch.io/idhZINDHvW/theme/dark/id9VvSS_lP.svg?c=1dxbfHSJFAPEGdCLU4o5B |
| base.svg | https://cdn.brandfetch.io/id6XsSOVVS/theme/dark/logo.svg?c=1dxbfHSJFAPEGdCLU4o5B |
| resolvio.svg | https://www.resolvio.xyz/assets/logo-BiRlS7rY.svg |
| usdc.svg | https://cdn.brandfetch.io/idVdsaOxtz/theme/dark/logo.svg?c=1dxbfHSJFAPEGdCLU4o5B |

The four Brandfetch assets were exported from the browser's observed image assets
because their CDN rejects automated downloads. All nine are served locally.
Lettering bounds were measured from the rendered SVGs. The cover scales each asset
using its wordmark rather than symbol height, aligns the main letter bodies' vertical midpoints, and
clips transparent artboard padding using CSS without editing the SVG.

For mixed-case marks, the alignment uses the lowercase body bounds (x-height),
excluding tall ascenders and dots. This keeps Ethereum, Base, Arc and Resolvio
visually centred with the capital-only marks. Scaling retains each full wordmark
height and the original symbol-to-letter proportions.
