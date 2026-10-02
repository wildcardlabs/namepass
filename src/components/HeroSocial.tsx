/** Avatar and marquee markup adapted from the user-supplied Feature Page 03 HTML.
 * Portraits and logos are the exact embedded assets; no remote image requests.
 */
const communityAvatars = [
  {
    name: "Olivia Sparks",
    src: "/assets/feature-page-03/olivia-sparks-6be44cd4.webp",
  },
  {
    name: "Howard Lloyd",
    src: "/assets/feature-page-03/howard-lloyd-c270acaa.webp",
  },
  {
    name: "Hallie Richards",
    src: "/assets/feature-page-03/hallie-richards-a5f09b99.webp",
  },
  {
    name: "Jenny Wilson",
    src: "/assets/feature-page-03/jenny-wilson-de27b418.webp",
  },
];
const companies = [
  {
    name: "University of Mississippi",
    src: "/assets/feature-page-03/university-of-mississippi-72eb2ab1.webp",
    className: "h-7.5 w-auto shrink-0 object-contain opacity-60 invert",
  },
  {
    name: "Star Health",
    src: "/assets/feature-page-03/star-health-46a12bce.webp",
    className: "h-9 w-auto shrink-0 object-contain opacity-60 invert",
  },
  {
    name: "DHL",
    src: "/assets/feature-page-03/dhl-aa547b1a.webp",
    className: "h-4 w-auto shrink-0 object-contain opacity-60 invert",
  },
  {
    name: "Sense Arena",
    src: "/assets/feature-page-03/sense-arena-a8f56da7.webp",
    className: "h-11 w-auto shrink-0 object-contain opacity-60 invert",
  },
  {
    name: "Shemaroo",
    src: "/assets/feature-page-03/shemaroo-e45ceab3.webp",
    className: "h-10 w-auto shrink-0 object-contain opacity-60 invert",
  },
  {
    name: "Mercedes Benz",
    src: "/assets/feature-page-03/mercedes-benz-1542b127.webp",
    className: "h-7.5 w-auto shrink-0 object-contain opacity-60 invert",
  },
];
const floatingAvatars = [
  {
    name: "Jenny Wilson",
    src: "/assets/feature-page-03/jenny-wilson-de27b418.webp",
    position: "absolute -top-14 left-50",
    size: "size-16",
  },
  {
    name: "Olivia Sparks",
    src: "/assets/feature-page-03/olivia-sparks-6be44cd4.webp",
    position: "absolute top-0 left-8",
    size: "size-20.5",
  },
  {
    name: "Emma Martinez",
    src: "/assets/feature-page-03/emma-martinez-3f9e2036.webp",
    position: "absolute top-40 left-42",
    size: "size-16",
  },
  {
    name: "Howard Lloyd",
    src: "/assets/feature-page-03/howard-lloyd-c270acaa.webp",
    position: "absolute bottom-36 -left-1",
    size: "size-13",
  },
  {
    name: "Sarah Chen",
    src: "/assets/feature-page-03/sarah-chen-d181cf42.webp",
    position: "absolute -top-14 right-50",
    size: "size-16",
  },
  {
    name: "Michael Thompson",
    src: "/assets/feature-page-03/michael-thompson-50c8a546.webp",
    position: "absolute top-0 right-8",
    size: "size-20.5",
  },
  {
    name: "Alex Davis",
    src: "/assets/feature-page-03/alex-davis-2a976781.webp",
    position: "absolute top-40 right-42",
    size: "size-16",
  },
  {
    name: "Hallie Richards",
    src: "/assets/feature-page-03/hallie-richards-fc5fbca4.webp",
    position: "absolute -right-1 bottom-36",
    size: "size-13",
  },
];

export function HeroCommunity() {
  return (
    <div className="hero-community bg-white flex items-center rounded-full border p-1.5 shadow-sm">
      <div data-slot="avatar-group" className="flex -space-x-2">
        {communityAvatars.map((avatar) => (
          <span
            key={avatar.src}
            data-slot="avatar"
            className="hero-template-avatar relative flex size-10 shrink-0 select-none rounded-full ring-2 ring-white"
          >
            <img
              data-slot="avatar-image"
              src={avatar.src}
              alt=""
              width={200}
              height={200}
              className="aspect-square size-full rounded-full object-cover"
            />
          </span>
        ))}
      </div>
      <p className="px-2">
        Loved by <span>23</span> more people
      </p>
    </div>
  );
}

export function HeroPortraits() {
  return (
    <div
      className="hero-portraits pointer-events-none absolute inset-0 max-lg:hidden"
      aria-hidden="true"
    >
      {floatingAvatars.map((avatar) => (
        <div key={avatar.src} className={avatar.position}>
          <span
            data-slot="avatar"
            className={`hero-template-avatar relative flex shrink-0 select-none rounded-full ring-2 ring-white ${avatar.size}`}
          >
            <img
              data-slot="avatar-image"
              src={avatar.src}
              alt=""
              width={200}
              height={200}
              className="aspect-square size-full rounded-full object-cover"
            />
          </span>
        </div>
      ))}
    </div>
  );
}

export function HeroCompanyCarousel() {
  return (
    <div
      className="hero-company-carousel relative w-full max-w-5xl"
      role="group"
      aria-label="Company logos"
    >
      <div className="hero-company-fade hero-company-fade-left pointer-events-none absolute inset-y-0 left-0 z-1 w-15" />
      <div className="hero-company-fade hero-company-fade-right pointer-events-none absolute inset-y-0 right-0 z-1 w-15" />
      <div className="hero-company-marquee group flex gap-(--marquee-gap) overflow-hidden p-3 flex-row *:items-center">
        {[0, 1, 2, 3].map((copy) => (
          <div
            key={copy}
            aria-hidden={copy > 0 ? true : undefined}
            className="hero-company-track flex shrink-0 justify-around gap-(--marquee-gap) flex-row"
          >
            {companies.map((company) => (
              <img
                key={company.src}
                src={company.src}
                alt={copy === 0 ? company.name : ""}
                className={company.className}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
