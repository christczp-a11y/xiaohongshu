import { describe, expect, it } from 'vitest';
import { HALF, LAKE, LAKE_R, WL_MAX, WL_MIN, distRiver, heightAt } from './terrain';

describe('terrain', () => {
  it('lake bed sits below the lowest water level', () => {
    expect(heightAt(LAKE.x, LAKE.z)).toBeLessThan(WL_MIN);
  });

  it('land outside the lake disc and away from the river stays above the highest water level', () => {
    // the water surface is a disc of radius LAKE_R; anything lower outside it would look dry but sit underwater
    for (let x = -HALF; x <= HALF; x += 0.1) {
      for (let z = -HALF; z <= HALF; z += 0.1) {
        if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE_R || distRiver(x, z) < 0.45) continue;
        expect(heightAt(x, z)).toBeGreaterThan(WL_MAX);
      }
    }
  });

  it('the river runs downhill from source to mouth', () => {
    expect(heightAt(-0.7, -2.7)).toBeGreaterThan(heightAt(1.0, 1.4));
  });
});
