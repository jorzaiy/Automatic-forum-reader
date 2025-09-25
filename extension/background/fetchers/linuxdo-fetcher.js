// Linux.do 论坛抓取器
import { BaseFetcher } from './base-fetcher.js';
import storage from '../storage.js';

export default class LinuxDoFetcher extends BaseFetcher {
  constructor() {
    super('linux.do');
    this.baseUrl = 'https://linux.do';
    this.latestJsonUrl = `${this.baseUrl}/latest.json`;
  }

  async performIncrementalFetch(force = false) {
    this.updateFetchStats();
    if (!force && this.isInCooldown()) {
      console.log(`[${this.forumId}-fetcher] Skipping fetch due to cooldown.`);
      return { success: false, reason: 'cooldown', forumId: this.forumId };
    }

    try {
      const topics = await this.fetchLatestTopics();
      if (!topics || topics.length === 0) {
        return { success: true, newTopics: 0, posts: [], forumId: this.forumId };
      }

      const newTopics = await this.markNewTopics(topics);
      this.lastSuccessfulFetch = new Date().toISOString();

      return {
        success: true,
        newTopics: newTopics.length,
        posts: newTopics,
        forumId: this.forumId,
      };
    } catch (error) {
      console.error(`[${this.forumId}-fetcher] Incremental fetch failed:`, error);
      return { success: false, error: error.message, forumId: this.forumId };
    }
  }

  async fetchLatestTopics() {
    const response = await fetch(this.latestJsonUrl, {
      credentials: 'include',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const jsonData = await response.json();
    return this.parseTopicListFromJson(jsonData);
  }

  parseTopicListFromJson(jsonData) {
    if (!jsonData?.topic_list?.topics) {
      return [];
    }
    const { topics } = jsonData.topic_list;
    const categories = jsonData.topic_list.categories || [];
    const categoryMap = new Map(categories.map(c => [c.id, c.name]));

    return topics.map(topic => ({
      threadId: `linuxdo:${topic.id}`,
      forumId: this.forumId,
      url: `${this.baseUrl}/t/topic/${topic.id}`,
      title: topic.title,
      category: categoryMap.get(topic.category_id) || '',
      tags: topic.tags || [],
      publishedAt: topic.created_at,
      isNew: true,
    }));
  }

  async markNewTopics(fetchedTopics) {
    const existingThreads = await storage.getAllThreads();
    const existingThreadIds = new Set(existingThreads.map(t => t.threadId));
    const newTopics = fetchedTopics.filter(topic => !existingThreadIds.has(topic.threadId));

    for (const topic of newTopics) {
      await storage.upsertThread(topic);
    }
    return newTopics;
  }
}