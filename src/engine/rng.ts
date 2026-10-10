// Small seeded PRNG (mulberry32) so every scenario is reproducible from its seed.
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  int(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  hex(len: number): string {
    let s = '';
    for (let i = 0; i < len; i++) s += '0123456789ABCDEF'[this.int(0, 15)];
    return s;
  }
  alnum(len: number): string {
    const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
    let s = '';
    for (let i = 0; i < len; i++) s += c[this.int(0, c.length - 1)];
    return s;
  }
  mac(prefix = '7C:C2:55'): string {
    return `${prefix}:${this.hex(2)}:${this.hex(2)}:${this.hex(2)}`;
  }
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}
