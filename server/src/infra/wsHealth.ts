export class WsHealth {
  lastMarketTs = 0;
  lastPrivateTs = 0;

  markMarket() {
    this.lastMarketTs = Date.now();
  }

  markPrivate() {
    this.lastPrivateTs = Date.now();
  }

  isMarketStale(thresholdMs: number) {
    return Date.now() - this.lastMarketTs > thresholdMs;
  }

  isPrivateStale(thresholdMs: number) {
    return Date.now() - this.lastPrivateTs > thresholdMs;
  }
}
