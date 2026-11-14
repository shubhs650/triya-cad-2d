// M2-45 part 2: a drawing PUBLISH opens in the background plots once its canvas exists, which
// React makes a moment after the drawing opens; `whenRegistered` waits for it.
import { describe, expect, it } from 'vitest';
import type { CanvasController } from '../src/canvas/controller';
import { controllerOf, register, whenRegistered } from '../src/canvas/registry';

const fake = (name: string) => ({ name }) as unknown as CanvasController;

describe('whenRegistered', () => {
  it('settles with a controller already registered', async () => {
    const c = fake('model');
    const done = register(901, '1F', c);
    await expect(whenRegistered(901, '1F')).resolves.toBe(c);
    done();
    expect(controllerOf(901, '1F')).toBeUndefined();
  });

  it('waits for the space’s controller to be registered', async () => {
    const waiting = whenRegistered(902, '1F');
    const other = register(902, '58', fake('layout'));
    const c = fake('model');
    const done = register(902, '1F', c);
    await expect(waiting).resolves.toBe(c);
    done();
    other();
  });

  it('settles undefined when none is registered in time', async () => {
    await expect(whenRegistered(903, '1F', 10)).resolves.toBeUndefined();
  });
});
