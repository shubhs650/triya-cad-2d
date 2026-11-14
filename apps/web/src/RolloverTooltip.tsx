// The rollover tooltip (M2-35 part 21, ROLLOVERTIPS; `rollover.ts` decides when): the object
// under a resting cursor, by its type's name, with its Color, Layer and Linetype. It never takes
// the pointer, so the canvas under it keeps its cursor, its rest and its picks.
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { rolloverLines, rolloverPlacement, rollovers } from './rollover';

export function RolloverTooltip({ doc }: { doc: number }) {
  const tip = useSyncExternalStore(rollovers.subscribe, () => rollovers.get(doc));
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | undefined>();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!tip || !el) return setAt(undefined);
    setAt(
      rolloverPlacement(
        { x: tip.clientX, y: tip.clientY },
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [tip]);

  if (!tip) return null;
  const { title, rows } = rolloverLines(tip.sheet);
  return (
    <div
      ref={ref}
      className="rollover-tooltip"
      role="tooltip"
      data-testid="rollover-tooltip"
      style={{
        left: at?.left ?? 0,
        top: at?.top ?? 0,
        // Measured where it is first drawn, then shown where it goes.
        visibility: at ? 'visible' : 'hidden',
      }}
    >
      <div className="rollover-title">{title}</div>
      <dl>
        {rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
