// M7-02's acceptance: snapshot tests per breakpoint. Each file under ribbon-snapshots/ pins what
// every tab shows at one breakpoint: each panel's items with their size and icon, then, step by
// step, how the unprotected panels give up room (what a compressed panel keeps and lists, or the
// one button a collapsed panel becomes). `ribbon.spec.ts` checks the app draws exactly the layout
// of its breakpoint and step. Rewrite with `pnpm vitest run apps/web/test/ribbon-snapshots -u`
// and review the diff: it is the ribbon's change as a drafter sees it.
import { describe, expect, it } from 'vitest';
import { BREAKPOINTS, compressionOrder, layoutTab, type PanelLayout } from '../src/ribbon/layout';
import { RIBBON_TABS, type RibbonItem } from '../src/ribbon/ribbon.config';

const entry = (i: RibbonItem): string =>
  i.menu
    ? `${i.id}<${i.icon}> ▾ [${i.menu.map((e) => `${e.id}<${e.icon}>`).join(', ')}]`
    : `${i.id}<${i.icon}>`;

function panelText(p: PanelLayout): string[] {
  const head = `${p.panel.label} (${p.protected ? 'protected' : p.state})`;
  if (p.state === 'expanded')
    return [head, ...p.shown.map((s) => `  ${s.size.padEnd(11)} ${entry(s.item)}`)];
  return [
    head,
    ...p.shown.map((s) => `  ${s.size.padEnd(11)} ${entry(s.item)}`),
    `  ▾ ${p.overflow.map((i) => i.id).join(', ')}`,
  ];
}

describe('ribbon snapshots per breakpoint', () => {
  for (const bp of BREAKPOINTS)
    it(`pins the ${bp} ribbon`, async () => {
      const out: string[] = [`# ${bp}`];
      for (const tab of RIBBON_TABS) {
        out.push('', `## ${tab.label}`);
        for (const p of layoutTab(tab, bp, 0).panels) out.push(...panelText(p));
        const order = compressionOrder(tab);
        for (let step = 1; step <= order.length; step++) {
          const p = layoutTab(tab, bp, step).panels.find((x) => x.panel === order[step - 1])!;
          out.push('', `### step ${step}`, ...panelText(p));
        }
      }
      await expect(`${out.join('\n')}\n`).toMatchFileSnapshot(`ribbon-snapshots/${bp}.txt`);
    });
});
