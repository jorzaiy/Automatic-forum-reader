// NodeSeek 论坛抓取器
import { BaseFetcher } from './base-fetcher.js';
import storage from '../storage.js';

export default class NodeSeekFetcher extends BaseFetcher {
  constructor() {
    super('nodeseek.com');
    this.baseUrl = 'https://www.nodeseek.com';
    this.categories = ['info', 'tech', 'daily', 'review', 'trade', 'dev'];
    this.categoryNames = {
      'info': '情报',
      'tech': '技术',
      'daily': '日常',
      'review': '测评',
      'trade': '交易',
      'dev': 'Dev'
    };
  }

  async performIncrementalFetch(force = false) {
    this.updateFetchStats();
    if (!force && this.isInCooldown()) {
      console.log(`[${this.forumId}-fetcher] Skipping fetch due to cooldown.`);
      return { success: false, reason: 'cooldown', forumId: this.forumId };
    }

    try {
      const posts = await this.fetchLatestPosts();
      if (!posts || posts.length === 0) {
        return { success: true, newTopics: 0, posts: [], forumId: this.forumId };
      }

      const newTopics = await this.markNewTopics(posts);
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

  async fetchLatestPosts() {
    const allPosts = [];
    for (const category of this.categories) {
      try {
        const posts = await this.fetchCategoryPosts(category);
        allPosts.push(...posts);
      } catch (error) {
        console.error(`[${this.forumId}-fetcher] Failed to fetch category ${category}:`, error);
      }
    }
    return allPosts;
  }

  async fetchCategoryPosts(category, page = 1) {
    const url = `${this.baseUrl}/categories/${category}/page-${page}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const html = await response.text();
    return this.parsePostList(html, category);
  }

  parsePostList(html, category) {
    const posts = [];
    const postItemRegex = /<li[^>]*class="[^"]*post-list-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    let match;
    while ((match = postItemRegex.exec(html)) !== null) {
      const post = this.extractPostFromHtml(match[1], category);
      if (post) {
        posts.push(post);
      }
    }
    return posts;
  }

  extractPostFromHtml(itemHtml, category) {
    const titleLinkRegex = /<div[^>]*class="[^"]*post-title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/i;
    const titleMatch = itemHtml.match(titleLinkRegex);
    if (!titleMatch) return null;

    let url = titleMatch[1];
    const title = titleMatch[2].trim();
    
    // 匹配 NodeSeek 的帖子ID，支持多种URL格式
    let idMatch = url.match(/\/post-(\d+)-1/);
    if (!idMatch) {
      // 尝试匹配不带斜杠的格式：post-123456-1
      idMatch = url.match(/post-(\d+)-1/);
    }
    if (!idMatch) return null;

    // 确保URL是完整的绝对路径
    if (url.startsWith('/')) {
      url = this.baseUrl + url;
    } else if (!url.startsWith('http')) {
      // 如果URL不包含协议，添加基础URL
      if (url.startsWith('post-')) {
        // NodeSeek的帖子URL格式：post-123456-1，需要添加斜杠
        url = this.baseUrl + '/' + url;
      } else {
        url = this.baseUrl + '/' + url;
      }
    }
    
    // 最终验证URL格式 - 确保是完整的绝对URL
    if (!url.startsWith('http')) {
      console.warn(`[${this.forumId}-fetcher] Invalid URL format: ${url}, fixing...`);
      url = this.baseUrl + '/' + url;
    }
    
    console.log(`[${this.forumId}-fetcher] Final URL: ${url}`);

    return {
      threadId: `nodeseek:${idMatch[1]}`,
      forumId: this.forumId,
      url,
      title,
      category: this.categoryNames[category] || category,
      tags: [], // NodeSeek列表页不显示标签
      publishedAt: new Date().toISOString(), // 无法从列表页获取准确时间
      isNew: true,
    };
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
