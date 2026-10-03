# Web client

The React application derives deposit addresses, displays ENS pricing, and reads activity and
flow state through the public API. Executors can use the renewal contracts without this client.

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `src/App.tsx` | Page state, browser history and shared page shell |
| `src/lib/namepass.ts` | ENS normalization and universal wallet derivation |
| `src/lib/chains.ts` | Shared chain and deployment registry |
| `src/lib/publicApi.ts` | Typed HTTP reads and activation |
| `src/lib/readModel.ts` | Presentation adapters for stored facts |
| `src/lib/flowPresentation.ts` | Flow labels that preserve origin-chain meaning |
| `src/lib/oracle.ts`, `pricing.ts`, `fees.ts` | Validated chain configuration and exact pricing |
| `src/lib/ens.ts` | Shared, cached ENS profile requests |

Components do not query Neon or perform public balance polling through RPC.

## Pricing and addresses

Normalize labels before derivation and show payment addresses in full. Helper selection and
configuration reads use one block. Unknown helper code or invalid oracle configuration prevents
pricing. The gateway provides the fixed executor allowance. Only price-dependent content waits
for these reads; the rest of the page can render immediately.

Use integer arithmetic and exact amount formatting where rounding would hide a discount boundary.
There are no default oracle rates. See [ENGINEERING_CONSTRAINTS.md](ENGINEERING_CONSTRAINTS.md)
for pricing and shared-request constraints.

## Activity and flow state

Balances stay separate by chain. Missing data remains unavailable. Canonical renewals supply
completed totals; a deposit is not a renewal. Sender and executor are distinct evidence fields.
The browser renders server flow identity without merging rows by name, amount or transaction hash.
After a source-chain burn, an unclaimed payment is not a spendable source-wallet balance.

## Interface conventions

`/docs` is a standalone, lazy documentation application with its own header and responsive navigation
in `src/components/docs.css`. It shares font, text, action and border tokens with the homepage in
`src/styles/site.css`. The documentation landing page has a resource directory and
copyable API examples. Guides use a persistent sidebar and table of contents. The four endpoint
pages come from OpenAPI. Search, page navigation and focus
changes do not read pricing, account or chain state.

`docs/content/` owns guide Markdown and navigation. `npm run generate:docs` produces the shared
catalog, public Markdown, downloadable skill, `llms.txt` and `llms-full.txt`. `npm run check:docs`
checks freshness and links. The quote guide is titled Calculate renewal duration. Page actions copy Markdown, open plain text and prepare context for
an existing agent. Public docs do not include GitHub edit links. Examples, copied prompts and
Markdown use the published `docsOrigin` from the generated catalog (`https://beta.namepass.com`),
including in local previews. In-page navigation
uses relative paths. The skill uses the public HTTP flow.

The footer, navigation and integration call-to-action open `/docs`. Homepage navigation
uses `Rates` for the pricing simulator. The 64px sticky header has Product and Resources
dropdowns, a direct Docs link and Get Started. Product opens Protocol, Explorer and Rates.
Resources opens Supported networks and Leaderboard. Mobile navigation uses the same centered shadcn
Dialog popup as docs, with grouped links, focus management and closure after choosing a destination.
Docs and public pages share the 40px bordered hamburger control. The public header hides Get Started
on mobile; the action remains inside the popup. The footer also lists
these destinations and the legal pages. Public activity labels identify the testnet deployment.

The public pages share `Navbar` and the `public-ui` theme in `src/styles/site.css`.
The theme uses a layered pastel blue/lilac page wash, white cards, neutral text, green actions,
6px control corners and 12px panel corners. Protocol and docs resource cards use 16px corners.
Public section cards, activity tables and name panels use the saved Circle pricing card's
four-layer shadow instead of visible outer borders. The GitHub source action and explorer
search use Circle's lighter floating-search shadow. Internal data separators and keyboard
focus indicators remain visible. Transparent borders preserve control sizes and card geometry.
Public action buttons match the existing docs buttons: 38px tall with 13px horizontal padding,
14px/20px text and 14px icons. Header actions are 36px tall with 12px padding and 13px icons.
Explorer's search bar is 46px tall around a 38px input and square search button.
Content is capped at 1180px; the surrounding frame
and header are capped at 1280px. Reading columns stay narrower. The hero uses the
existing heading and description with Get Started and Read the docs. The cover centers its
content in the viewport space below the renewal strip and 65px navigation header.
Like main, phones use `100svh` and screens from 768px use `100vh`; longer content can
expand the section on short screens. Symmetric vertical padding centers the content
in the cover below the strip and navigation. The continuous page wash replaces
the separate green cover glow; the original faint Flow grid remains over the wash. The video, illustrative
renewal overlay and hero Explorer shortcut are removed. Leaderboard remains available through
Resources and the footer. The protocol keeps its four-card bento arrangement and existing beam. The other three cards
contain text with a slow, neutral background fade. The fade stops outside the viewport, in
a hidden tab and for reduced-motion preferences. The renewal card also uses the supplied
Pulse Core illustration's four radiating rings. They sit at the top right as a clipped
280px forest-green background (240px on mobile), with a slow six-second cycle and
staggered 1.5-second delays. Group opacity is 24% (20% on mobile), while the original
ring animation peaks at 55% opacity. The heart, central circle and ECG are omitted.
The rings do not move card content. They use the same visibility pause and show one
stationary faint ring with reduced motion.
The four bento cards have unnumbered category labels.
All homepage sections share one continuous page wash, including their outer gutters.
A white overlay quiets the top and bottom and reduces the peak colour in the middle:
white opacity is 20% at the top, 30% at 16% of the page, 40% at 38% and 50%,
50% at 62%, 65% at 84%, and 75% at the bottom. The original Circle SVG retains its colours and geometry below
this overlay. Protocol and pricing have no separate white section bands.
The integration CTA uses its previous white card and faint green Vanta topology texture,
with the copy on the left and docs action on the right. Its canvas and fallback are white.
Outer padding gives the CTA 64px above and 88px below on desktop, and 48px above and
64px below on mobile.
Secondary pages retain the softened wash. Outer gutters have no diagonal stripes or visible frame
side borders. Transparent 1px borders preserve existing widths and logo alignment.
Content and the shared footer's inner wrapper keep the existing 1280px maximum width. The responsive
outer gutters remain 16px on phones, 24px on tablets and 32px on desktop. Inner mobile
section padding is 16px. Documentation uses a full-width white shell, including its outer
gutters, with no decorative header dot grid. The documentation navigation and reading
columns retain their existing positions. The public header is transparent at the top,
sharing the hero's page wash. Its full-viewport background gradually becomes white over
the first 180px of scroll. Scroll updates use animation frames without rerendering navigation.
The documentation header stays white through the viewport edges.
Neither header has a grey bottom separator; docs retain their active-tab underline.
`public/assets/circle/page-wash.svg` retains the four gradient layers and geometry
from the saved Circle CCTP page, including its original blue/lilac stops and white
radial highlight. The shared app uses the reference's top-centred, non-repeating cover sizing under the white overlay.
Page frames and section surfaces are transparent; white cards, controls and tables
remain distinct. The cover grid retains its saved cell geometry, 40% cell opacity and
radial fade. Its first 112px also fade in from transparent below the header. There is no
separate white colour overlay at that edge. The shared footer spans the viewport with Circle's deep
`#1f1a30` background, `#a7a3b5` links and supporting text, and `#e1dfe8` category
labels. Navigation links use 14px Geist at weight 400 and brighten on hover.
Font smoothing is inherited from the document root across all pages and portals
(`antialiased` on WebKit and `grayscale` on macOS Firefox). Rendering remains browser-dependent.
Explorer name links use Geist weight 450; name-view headings use 500. Calculator payment
amounts and breakdown values use 400, the main duration uses 450, and tab labels remain 500.
Length-tab rates and the amount suggestion's supporting line use 400 rather than inheriting
button weight. These weight changes, rather than smoothing alone, reduce the bulky text feel.
The footer content keeps the site's width and gutters,
including on mobile. The brand actions elsewhere remain green.
`HeroSocial` retains Feature Page 03's overlapping avatar group and four-track
marquee. The cover reads distinct names with completed renewals from the public
activity API once per mount. Up to four names supply the 32px pill avatars;
pending flows are excluded. The surrounding floating portraits are removed.
`NameAvatar` uses the existing cached ENS profile resolver and the leaderboard's
name-seeded DiceBear voxel-bot fallback. Image errors cannot retry the fallback
indefinitely. Unavailable activity omits pill avatars and keeps the cover actions
and community text visible.
The pill reads “Used by 685+ users” (user-supplied copy, not an API-derived count).
It has the Built for ENS v2 badge's faint green border and white-to-pale-green
background, without an outer shadow. Text is 13px, with medium-weight green emphasis.
The marquee uses nine exact user-supplied SVG wordmarks in their supplied
order: Arc, Goldsky, Arbitrum, Circle, ENS, Ethereum, Base, USDC and Resolvio. They are stored
locally in `public/logos/infrastructure`; its README records the source URLs.
The statement “Built on trusted infrastructure” encompasses all nine. Wordmarks
replace the previous icon-plus-text treatments. Sizing uses measured lettering
bounds: a 16px target for capitals and short lowercase marks, with optical adjustments
to 18px for Arc and 20px for Ethereum, Base and Resolvio to account for their thin lettering
or taller ascenders. Goldsky uses 15.2px (a 5% reduction) and Arbitrum uses 11.2px
(a 30% reduction). All wordmarks align their main letter bodies' vertical midpoint at 32px
in a 64px track row. Mixed-case marks use the lowercase body bounds rather than
tall ascenders or dots; these otherwise make Ethereum and Base appear lower. Each wrapper clips only the original SVG's transparent artboard; source paths
and symbol-to-letter proportions remain unchanged. Monochrome filtering and 70%
opacity match the site. The supplied four
repeated tracks retain a 64px gap, 60px transparent edge masks, slower 40-second reverse
motion and a 768px maximum width. Hover pauses the marquee and reduced motion
keeps it still. First-track logos have accessible names; duplicate tracks are hidden.
The saved template portraits and unrelated company assets remain available in
`public/assets/feature-page-03` but are no longer rendered by the cover.
The entire stack from Built for ENS v2 through the carousel is centered below the
strip and header: the space above the badge within the cover equals the space below
the carousel. The pill has a 56px gap after the actions.
The carousel uses 32px mobile, 64px tablet and 96px desktop gaps. Mobile retains
`100svh` sizing.
Landing-page section rules and the template's T ornaments are omitted. Spacing separates major areas over the continuous wash. The footer uses Circle's deep purple
background. Existing inner surface colors remain: `--site-subtle` is `#F5F5F5`, table
details use `#FAFAFA`, and docs retain their code and resource surfaces on a white shell.
Navigation widths and logo positions stay unchanged. Row separators and keyboard focus
indicators remain. Decoration is hidden from assistive technology and cannot intercept clicks.
Content and payment behavior are unchanged.
Explorer uses the page wash. Protocol cards are white with soft shadows. The activity table
has one frame, a quiet toolbar, 12px column labels and 14px row text. The column-title
row uses a shifting white and pale-green gradient on a 14-second alternating cycle.
Reduced motion keeps it stationary. The toolbar stays white and shares the
column row’s 16px left inset. Explorer does not add a
second enclosing panel. Individual name details retain two shadcn Card panels with soft shadows for
expiry and profile, and the renewal funding destination, stacked below 900px. The selected name
is the main heading; the feed introduction is shown only in the feed. The funding panel is titled
Send USDC to renew, identifies the name being renewed and leads with the full Universal deposit
address and visible Copy address and Show QR actions. The readable deposit name follows as a
secondary destination, with its copy icon immediately beside the value. Expiry and profile labels
both use 12px regular text and 14px outline icons; Profile uses title case. Profile record links
change only color on hover, so their width and neighbours remain stable. The funding panel ends
with a compact USDC heading, Token contracts action and aligned network list, in two columns
on small phones. Ethereum is listed first in the name view; the Base logo is visually 14px
within the same 16px icon slot. QR opens in an accessible shadcn Dialog. The name view omits lifetime totals. Activity shows only its event rows and their details. Expanded renewal amounts
and transactions use rows and rules without nested cards. Payment amounts use a compact
USDC breakdown with the exact applied amount emphasized. Neutral full participant addresses
have adjacent copy controls. Recorded transactions form a numbered trail with chain labels
and green explorer links without hover underlines. The two detail columns stack below 900px. Pending balances retain their
existing states and actions; exceptional flows use a narrow notice rule. The name-view heading and back icon share a
centered row. The pricing calculator groups name length, amount and discount controls in its
left panel. Renewal time and the cost breakdown occupy the white right panel. The result uses
a 32px time value and consistent 14px label/value rows with light dividers. The panels stack
below 1024px. The loading state uses the same layout.
Existing controls and exact math are retained.
Name-length and discount-year options share the same faint border and pale selected fill.
Name-length options show only character count and annual price; example ENS names are omitted
from both loaded options and loading placeholders.
Selected options have a transparent border without an extra outline or shadow. Hover changes
only the faint border; keyboard focus retains its visible ring.
The next-tier suggestion is one two-line button: Add amount → extra renewal months,
with the next rate and discount below. A fine vertical rule separates it from the payment
amount on wider screens. Below 480px it sits on its own row without the rule. The full
suggestion has a 44px touch target and applies the suggested amount in one tap. The rate
is always visible and associated through `aria-describedby`; no hover or tooltip is needed.
All docs tabs use the same 1280px outer frame, header and tab bar. Guide pages retain
their sidebar, sticky table of contents and readable article width. Horizontal overflow is
clipped without creating an ancestor scroll container, so navigation sticks to the viewport.
The table of contents sticky offset matches its initial position, including the wider-screen
article inset, so it does not shift upward when scrolling starts.
All routes, including docs and monitoring, render the shared footer with working product and
legal navigation. The live testnet renewal strip is mounted once in the shared app shell,
so route changes preserve its data, polling subscription and marquee position.
Its solid muted forest background is `#2B4034`. ENS names use `#EDF3EF` at weight
500, renewal details use `#C3D1C8` at weight 400, and separators use `#809889`.
The renewal strip sticks above the public and docs headers. Headers, docs navigation and
anchor offsets account for its 32px mobile and 36px desktop height. Docs and public logos
share exact positioning and dimensions, including the 64px header height on mobile.
The docs logo returns home through the app router. Route transitions keep the current view
visible while a lazy page loads, preventing an intermediate header disappearance.
Legal sections use fine dividers, 32px/40px titles (28px/36px on mobile),
18px/26px section headings and 15px/24px paragraphs.

All application surfaces use self-hosted Geist Variable from `@fontsource-variable/geist`.
The public site and docs share softer neutral text roles: `#303030` for major headings and
key values, `#3f3f3f` at weight 500 for card titles, `#666666` at weight 400 for body copy,
and `#737373` for supporting labels. Major headings retain weight 600. White surfaces and
green actions remain unchanged.
Public section descriptions use 18px/28px at weight 400. Docs prose uses 16px/26px. The
integration CTA paragraph uses 14px/22px. Footer link rows use a compact 4px gap. Controls use 14px/500,
and card headings use 24px/32px at weight 600 with normal tracking. Docs resource cards use
22px/30px headings and 15px/22px links. Compact protocol paragraphs
use 14–14.5px/24px on desktop, 15px/24px on tablet and 14px/22px on mobile. Mobile card
headings use 20px/28px, below the section title and subtitle scale; the desktop alias paragraph
fits three lines. Body and table text remain 16px
and 14px where density matters. Text uses the shared neutral roles above, with green action roles. Code and contract
addresses retain monospace.
Mobile calculator results use 28px/36px type below 640px to keep long renewal durations readable.
Docs titles use 32px/40px below 761px. API tables keep a 480px minimum width and scroll inside
their container. Endpoint paths stay on one line, with the copy action wrapping below on narrow screens. The documentation flow labels `alice.eth` and `alice.namepass.eth`
share one font family, size and weight. Docs header labels share the public navigation’s
14px Geist type and 20px line height; mobile tabs use 13px. The Docs label centers beside the
wordmark. The header supplies a full-width white background behind both the navigation
and tab rows; tab content keeps the shared page inset. Previous/next cards use 15px page titles and 12px direction labels. The docs flow
illustration renders the Base logo at 16px, centered in its unchanged network node. API
example endpoint titles use regular-weight 15px/22px (14px on mobile), method badges use
regular-weight 11px, and the
endpoint selector stacks into one column below 640px. No premium template source or assets are included.
Reuse existing visual primitives, tooltips and chain labels. Keep keyboard focus indicators
visible. The public shell and portaled navigation controls override shadcn primary, accent and
focus colors to green; monitoring retains its separate semantic palette.
Small public section labels share the Explorer's 8px round green dot. These shared markers
stay static; the Explorer's live activity marker retains its existing pulse.

Use `surface-selected` for pricing selections and `surface-table` for Explorer headers.
Use `inset-panel` for shaded information and renewal hints. Explorer address fields and
transaction evidence use flat rows.
It owns the opaque `surface-inset` fill, 8px corners and 12px/16px padding. Add `inset-action`
only when the whole panel is a button or link. Keep its fill steady on hover and press.
Use `primary-action` for filled public actions. These controls share a fine border and inset
highlight; keyboard focus stays visible. Error and warning surfaces retain their meaning.
Reserve the green `savings` and `savings-soft` pair for discount badges.
Text colors use the shared `ink-*` theme roles in `src/index.css`: `primary` for headings
and key values, `secondary` for descriptions and supporting data, `label` for small labels,
and `action` for links and controls. Public pages map these roles to the shared `site-*` tokens.
Use `decorative` only for nonessential numbering. Dark surfaces use `inverse` and
`inverse-secondary`. Section labels use `tracking-section`.
Keep error, warning, chart-series and network-brand colors distinct where they convey meaning.
Monitoring is a separately loaded, GitHub-authenticated page built with the existing shadcn
components. Its snapshot and manual gas-read behavior are defined in [MONITORING.md](MONITORING.md).

Deposit details show separate copy targets for `<label>.namepass.eth` and the full deposit
address. The QR dialog encodes the address. Static QR codes use one SVG path. Full address values wrap
at a readable font size on narrow screens; do not shrink them to fit one line. Public copy actions
use `useCopyFeedback`: show success only after the clipboard write succeeds, report failures,
keep icon geometry stable, and clear obsolete feedback timers.

The amount slider keeps a native range input for touch and keyboard behavior. `amount-slider`
owns the track and thumb styles for WebKit/Blink and Firefox; do not replace it with
`accent-color`. The thumb and filled track keep one opaque color in every interaction state.
The range has a 44px interaction area and exposes the actual USDC amount through `aria-valuetext`.
Update renewal results in place during dragging. Public tooltip triggers support focus, touch
toggle, outside dismissal and Escape, and link to their description with `aria-describedby`.

The Explorer keeps its content region in place and renders only the active view. The detail view fades and
slides in over 400 ms; its ENS profile fields show inline loading skeletons. The parent retains the
last feed response and page so Back restores them immediately and resumes polling.
Pricing refreshes keep validated views mounted. Only the initial load and a retry after failed
validation use the loading state. A validation failure still disables pricing. Price calculations
must update when the validated configuration changes, without resetting user input.
The explicit ENS refresh still precedes the activity refresh. The CTA effect runs only
while visible in an active tab. Reduced-motion users do not start the effect.

Build and verification commands are in [CONTRIBUTING.md](../CONTRIBUTING.md). Deployment facts
belong in [DEPLOYMENTS.md](DEPLOYMENTS.md).
