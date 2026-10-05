/** Static cell grid from the supplied Flow HTML; CSS retains its saved geometry. */
export default function CoverGrid() {
  return (
    <div className="site-cover-grid" aria-hidden="true">
      <div className="site-cover-grid-cells">
        {Array.from({ length: 27 * 8 }, (_, index) => (
          <div className="site-cover-grid-cell" key={index} />
        ))}
      </div>
    </div>
  );
}
