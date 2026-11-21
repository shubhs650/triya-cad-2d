// An icon of the ribbon's set (icons.ts) as inline SVG in the text colour, so it follows the
// theme and the disabled state. Decorative: the button it sits in carries the name.
import { iconArt, type IconName } from './icons';

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const art = iconArt(name);
  return (
    <svg
      className="icon"
      data-icon={name}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
    >
      {art.kind === 'fluent' ? (
        <path d={art.d} fill="currentColor" />
      ) : (
        <>
          <path
            d={art.d}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {art.dots?.map(([x, y]) => (
            <circle key={`${x},${y}`} cx={x} cy={y} r={1.25} fill="currentColor" />
          ))}
        </>
      )}
    </svg>
  );
}
