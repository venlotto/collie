import { expect, type Locator } from "@playwright/test";

/** Inspect the real CSS transition on an extra visit if the engine skipped its
 * intermediate animation frames. Never seek the transition used to measure jitter. */
export async function botMotionMidpoint(element: Locator, action: () => Promise<unknown>) {
  await expect.poll(() => element.evaluate(el => el.getAnimations().length)).toBe(0);
  const probe = await element.evaluateHandle(el => {
    const stack = el.closest(".bot-layout")!;
    const sample = { value: null as { x: number; scale: number; composerHeight: number } | null };
    const observer = new MutationObserver(() => {
      const slide = el.getAnimations().find(animation =>
        animation instanceof CSSTransition && animation.transitionProperty === "transform");
      if (!slide?.effect) return;
      slide.pause();
      slide.currentTime = Number(slide.effect.getTiming().duration) / 2;
      const rect = el.getBoundingClientRect();
      sample.value = {
        x: rect.x - stack.getBoundingClientRect().x,
        scale: rect.width / el.clientWidth,
        composerHeight: stack.querySelector('[data-slot="composer-box"]')?.getBoundingClientRect().height ?? 0,
      };
      observer.disconnect();
      slide.play();
    });
    observer.observe(stack, { childList: true, subtree: true, attributes: true,
      attributeFilter: ["open", "data-detail", "data-leaving"] });
    return sample;
  });
  await action();
  await expect.poll(() => probe.evaluate(held => held.value)).not.toBeNull();
  const sample = await probe.evaluate(held => held.value!);
  await probe.dispose();
  return sample;
}
