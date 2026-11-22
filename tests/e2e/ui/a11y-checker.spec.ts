// M7-10: the accessibility check (tests/e2e/app/a11y.ts) finds each rule it checks: a page with one
// violation of each, and the same page put right, which it passes.
import { expect, test } from '@playwright/test';
import { checkA11y } from '../app/a11y';

const BROKEN = `
<main>
  <button id="b1"></button>
  <input type="submit" value="">
  <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
  <input id="t1" type="text">
  <select id="s1"><option>One</option></select>
  <div role="buton">x</div>
  <div role="region" aria-labeledby="x">misspelt attribute</div>
  <div role="checkbox" tabindex="0">no state</div>
  <div role="tablist" aria-label="Tabs"><button>not a tab</button></div>
  <div role="tab" aria-selected="false" tabindex="0">orphan tab</div>
  <div role="button" tabindex="0" aria-pressed="maybe">bad value</div>
  <ul aria-checked="true"><li>not allowed</li></ul>
  <div role="slider" aria-valuenow="1" tabindex="0"></div>
  <a href="#x"></a>
  <div role="dialog" aria-modal="false"><p>unnamed dialog</p></div>
  <div aria-hidden="true"><button>hidden but focusable</button></div>
  <div role="button" tabindex="0">outer<button>inner</button></div>
  <div role="img"></div>
  <svg role="img" width="4" height="4"></svg>
  <div role="menuitem" tabindex="0"></div>
</main>`;

const FIXED = `
<main>
  <button id="b1">Save</button>
  <input type="submit" value="Send">
  <img alt="Logo" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
  <label>Name <input id="t1" type="text"></label>
  <label for="s1">Size</label><select id="s1"><option>One</option></select>
  <div role="button" tabindex="0">x</div>
  <div role="region" aria-labelledby="t1">spelt right</div>
  <div role="checkbox" aria-checked="false" tabindex="0">state</div>
  <div role="tablist" aria-label="Tabs"><button role="tab" aria-selected="true">a tab</button></div>
  <div role="tablist" aria-label="More"><div role="tab" aria-selected="false" tabindex="0">tab</div></div>
  <div role="button" tabindex="0" aria-pressed="mixed">good value</div>
  <ul><li>allowed</li></ul>
  <div role="slider" aria-label="Zoom" aria-valuenow="1" tabindex="0"></div>
  <a href="#x">Link</a>
  <div role="dialog" aria-modal="false" aria-label="Named"><p>named dialog</p></div>
  <div aria-hidden="true"><span>hidden text</span></div>
  <div role="button" tabindex="0">outer</div>
  <div role="img" aria-label="Picture"></div>
  <svg role="img" aria-label="Icon" width="4" height="4"></svg>
  <div role="menu" aria-label="Menu"><div role="menuitem" tabindex="0">Copy</div></div>
  <div role="list"></div>
</main>`;

test('the accessibility check finds each rule it checks', async ({ page }) => {
  await page.setContent(BROKEN);
  const rules = (await checkA11y(page)).map((v) => v.rule).sort();
  expect(rules).toEqual(
    [
      'aria-allowed-attr',
      'aria-command-name',
      'aria-dialog-name',
      'aria-hidden-focus',
      'aria-input-field-name',
      'aria-required-attr',
      'aria-required-children',
      'aria-required-parent',
      'aria-required-parent',
      'aria-roles',
      'aria-valid-attr',
      'aria-valid-attr-value',
      'button-name',
      'image-alt',
      'input-button-name',
      'label',
      'link-name',
      'nested-interactive',
      'role-img-alt',
      'select-name',
      'svg-img-alt',
    ].sort(),
  );
});

test('the accessibility check passes the same page put right', async ({ page }) => {
  await page.setContent(FIXED);
  expect(await checkA11y(page)).toEqual([]);
});
