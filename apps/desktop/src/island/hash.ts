/** Small deterministic integer hash, so "random" patterns repeat identically every time. */
export function hash(n: number): number {
  let x = Math.imul(n | 0, 0x9e3779b1) ^ 0x85ebca6b;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  return (x ^ (x >>> 15)) >>> 0;
}
