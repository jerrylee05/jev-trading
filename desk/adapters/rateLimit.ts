/** Simple token-bucket rate limiter (e.g. Alpaca 200 REST/min). */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly refillPerMs: number,
  ) {
    this.tokens = capacity;
  }

  static perMinute(n: number): TokenBucket {
    return new TokenBucket(n, n / 60_000);
  }

  async take(n = 1): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= n) {
        this.tokens -= n;
        return;
      }
      const need = n - this.tokens;
      const waitMs = Math.ceil(need / this.refillPerMs);
      await Bun.sleep(Math.min(Math.max(waitMs, 5), 1000));
    }
  }

  private refill() {
    const now = Date.now();
    const elapsed = now - this.last;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
    this.last = now;
  }
}
