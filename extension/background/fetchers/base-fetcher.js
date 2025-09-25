// 抓取器基类
export class BaseFetcher {
  constructor(forumId, minFetchIntervalMs = 5 * 60 * 1000) {
    this.forumId = forumId;
    this.minFetchIntervalMs = minFetchIntervalMs;
    this.lastFetch = null;
    this.lastSuccessfulFetch = null;
    this.fetchCount = 0;
  }

  updateFetchStats() {
    this.lastFetch = new Date().toISOString();
    this.fetchCount++;
  }

  isInCooldown() {
    if (!this.lastFetch) return false;
    const timeSinceLastFetch = new Date() - new Date(this.lastFetch);
    return timeSinceLastFetch < this.minFetchIntervalMs;
  }

  getFetchStats() {
    return {
      forumId: this.forumId,
      lastFetch: this.lastFetch,
      lastSuccessfulFetch: this.lastSuccessfulFetch,
      fetchCount: this.fetchCount,
    };
  }

  async performIncrementalFetch(force = false) {
    throw new Error('performIncrementalFetch must be implemented by subclasses');
  }
}





