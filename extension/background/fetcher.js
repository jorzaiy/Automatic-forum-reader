// 抓取管理器模块
import LinuxDoFetcher from './fetchers/linuxdo-fetcher.js';
import NodeSeekFetcher from './fetchers/nodeseek-fetcher.js';

class FetcherManager {
  constructor() {
    this.fetchers = [
      new LinuxDoFetcher(),
      new NodeSeekFetcher(),
    ];
  }

  async performIncrementalFetch(force = false) {
    console.log('[FetcherManager] Starting incremental fetch for all forums...');
    const results = await Promise.all(
      this.fetchers.map(fetcher => fetcher.performIncrementalFetch(force))
    );
    return results;
  }

  getFetchStats() {
    return this.fetchers.map(fetcher => fetcher.getFetchStats());
  }
}

const fetcherManager = new FetcherManager();
export default fetcherManager;
