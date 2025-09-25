// 推荐算法模块
// 基于用户阅读历史进行内容推荐

import storage from './storage.js';

/**
 * 获取已点击的推荐帖子列表
 * @returns {Promise<Set<string>>} - 已点击的帖子ID集合
 */
async function getClickedRecommendations() {
  try {
    const clickedKey = 'clicked_recommendations';
    const result = await chrome.storage.local.get([clickedKey]);
    const clickedList = result[clickedKey] || [];
    return new Set(clickedList);
  } catch (error) {
    console.error('[recommender] Error getting clicked recommendations:', error);
    return new Set();
  }
}

/**
 * 清除已点击的推荐帖子列表
 * @returns {Promise<void>}
 */
async function clearClickedRecommendations() {
  try {
    const clickedKey = 'clicked_recommendations';
    await chrome.storage.local.remove([clickedKey]);
    console.log('[recommender] Cleared clicked recommendations');
  } catch (error) {
    console.error('[recommender] Error clearing clicked recommendations:', error);
  }
}

/**
 * 简单的 TF-IDF 相似度计算
 * @param {string} text1 - 文本1
 * @param {string} text2 - 文本2
 * @returns {number} - 相似度分数 (0-1)
 */
function calculateTFIDFSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;
  
  // 简单的分词（按空格和标点符号分割）
  const words1 = text1.toLowerCase().split(/[\s\p{P}]+/u).filter(w => w.length > 1);
  const words2 = text2.toLowerCase().split(/[\s\p{P}]+/u).filter(w => w.length > 1);
  
  if (words1.length === 0 || words2.length === 0) return 0;
  
  // 计算词频
  const freq1 = {};
  const freq2 = {};
  
  words1.forEach(word => {
    freq1[word] = (freq1[word] || 0) + 1;
  });
  
  words2.forEach(word => {
    freq2[word] = (freq2[word] || 0) + 1;
  });
  
  // 计算交集
  const intersection = new Set(words1.filter(word => words2.includes(word)));
  
  if (intersection.size === 0) return 0;
  
  // 简单的相似度计算：交集词汇数 / 并集词汇数
  const union = new Set([...words1, ...words2]);
  return intersection.size / union.size;
}

/**
 * 计算新鲜度衰减分数
 * @param {string} publishedAt - 发布时间
 * @returns {number} - 新鲜度分数 (0-1)
 */
function calculateFreshnessScore(publishedAt) {
  const now = new Date();
  const published = new Date(publishedAt);
  const daysDiff = (now - published) / (1000 * 60 * 60 * 24);
  
  // 7天内线性衰减，7天后为0
  if (daysDiff > 7) return 0;
  return Math.max(0, 1 - daysDiff / 7);
}

/**
 * 计算作者亲和度分数
 * @param {Array} readEvents - 用户阅读事件
 * @param {string} authorId - 作者ID
 * @returns {number} - 作者亲和度分数 (0-1)
 */
function calculateAuthorAffinity(readEvents, authorId) {
  if (!authorId || !readEvents || readEvents.length === 0) return 0;
  
  // 统计用户阅读该作者帖子的次数
  const authorReadCount = readEvents.filter(event => 
    event.authorId === authorId && event.completed === 1
  ).length;
  
  // 简单的亲和度计算：阅读次数 / 总阅读次数
  const totalReadCount = readEvents.filter(event => event.completed === 1).length;
  if (totalReadCount === 0) return 0;
  
  return Math.min(1, authorReadCount / totalReadCount);
}

/**
 * 获取用户阅读历史文本
 * @param {Array} readEvents - 阅读事件
 * @param {Array} threads - 帖子数据
 * @returns {string} - 合并的阅读历史文本
 */
function getUserReadingHistory(readEvents, threads) {
  const completedEvents = readEvents.filter(event => event.completed === 1);
  const threadMap = new Map(threads.map(thread => [thread.threadId, thread]));
  
  const historyTexts = completedEvents.map(event => {
    const thread = threadMap.get(event.threadId);
    if (!thread) return '';
    
    return `${thread.title} ${thread.category} ${(thread.tags || []).join(' ')}`;
  }).filter(Boolean);
  
  return historyTexts.join(' ');
}

/**
 * 生成推荐列表
 * @param {number} limit - 推荐数量限制
 * @param {string} forum - 论坛过滤 ('all', 'linux.do', 'nodeseek.com')
 * @param {boolean} forceRefresh - 是否强制刷新推荐
 * @returns {Array} - 推荐帖子列表
 */
async function generateRecommendations(limit = 10, forum = 'all', forceRefresh = false) {
  try {
    console.log('[recommender] Starting recommendation generation...');
    
    // 获取用户阅读历史、所有帖子和不感兴趣的帖子
    const [readEvents, allThreads, dislikedThreads] = await Promise.all([
      storage.getAllReadEvents(),
      storage.getAllThreads(),
      storage.getAllDislikedThreads()
    ]);
    
    console.log('[recommender] Data loaded:', {
      readEventsCount: readEvents.length,
      allThreadsCount: allThreads.length,
      dislikedThreadsCount: dislikedThreads.length
    });
    
    if (readEvents.length === 0 || allThreads.length === 0) {
      console.log('[recommender] No reading history or threads available');
      return [];
    }
    
    // 获取用户阅读历史文本
    const userHistory = getUserReadingHistory(readEvents, allThreads);
    
    // 获取新帖子（最近30天），并根据论坛过滤
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let recentThreads = allThreads.filter(thread => 
      new Date(thread.publishedAt || thread.createdAt) > thirtyDaysAgo
    );
    
    // 如果最近30天的帖子太少，扩展到所有帖子
    if (recentThreads.length < 10) {
      console.log('[recommender] Not enough recent threads, using all threads');
      recentThreads = allThreads;
    }
    
    // 根据论坛过滤帖子
    if (forum !== 'all') {
      recentThreads = recentThreads.filter(thread => thread.forumId === forum);
      console.log(`[recommender] Filtered by forum ${forum}: ${recentThreads.length} threads`);
    } else {
      console.log(`[recommender] Found ${recentThreads.length} recent threads from all forums`);
    }
    
    if (recentThreads.length === 0) {
      console.log('[recommender] No recent threads available');
      return [];
    }
    
    // 获取已读帖子、不感兴趣帖子和已点击帖子的ID集合
    const readThreadIds = new Set(readEvents.map(event => event.threadId));
    const dislikedThreadIds = new Set(dislikedThreads.map(thread => thread.threadId));
    const clickedThreadIds = await getClickedRecommendations();
    
    console.log('[recommender] Debug info:', {
      totalReadEvents: readEvents.length,
      readThreadIds: Array.from(readThreadIds),
      totalDislikedThreads: dislikedThreads.length,
      dislikedThreadIds: Array.from(dislikedThreadIds),
      clickedThreadIds: Array.from(clickedThreadIds),
      recentThreadsCount: recentThreads.length,
      completedEvents: readEvents.filter(e => e.completed === 1).length
    });
    
    console.log('[recommender] Clicked threads details:', {
      clickedCount: clickedThreadIds.size,
      clickedList: Array.from(clickedThreadIds),
      recentThreadIds: recentThreads.map(t => t.threadId).slice(0, 5)
    });
    
    // 计算每个帖子的推荐分数，主要排除已读帖子
    const scoredThreads = recentThreads
      .filter(thread => {
        const isRead = readThreadIds.has(thread.threadId);
        const isDisliked = dislikedThreadIds.has(thread.threadId);
        const isClicked = clickedThreadIds.has(thread.threadId);
        
        // 主要过滤已读帖子，其他条件更宽松
        if (isRead) {
          console.log(`[recommender] Filtering out read thread ${thread.threadId}`);
          return false;
        }
        
        // 如果不感兴趣的帖子太多，只过滤部分
        if (isDisliked && !forceRefresh) {
          console.log(`[recommender] Filtering out disliked thread ${thread.threadId}`);
          return false;
        }
        
        // 已点击的帖子在强制刷新时重新显示
        if (isClicked && !forceRefresh) {
          console.log(`[recommender] Filtering out clicked thread ${thread.threadId}`);
          return false;
        }
        
        return true;
      })
      .map(thread => {
        const threadText = `${thread.title} ${thread.category} ${(thread.tags || []).join(' ')}`;
        
        // 内容相似度 (50%)
        const contentSimilarity = calculateTFIDFSimilarity(userHistory, threadText);
        
        // 新鲜度分数 (30%)
        const freshnessScore = calculateFreshnessScore(thread.publishedAt || thread.createdAt);
        
        // 作者亲和度 (20%) - 暂时设为0，因为当前数据中没有作者信息
        const authorAffinity = 0;
        
        // 综合分数
        const finalScore = 0.5 * contentSimilarity + 0.3 * freshnessScore + 0.2 * authorAffinity;
        
        return {
          ...thread,
          recommendationScore: finalScore,
          contentSimilarity,
          freshnessScore,
          authorAffinity
        };
      });
    
    // 按分数排序并去重
    let sortedThreads = scoredThreads
      .filter(thread => thread.recommendationScore > 0.01) // 降低分数阈值
      .sort((a, b) => b.recommendationScore - a.recommendationScore);
    
    // 如果过滤后帖子太少，进一步降低阈值
    if (sortedThreads.length < 5) {
      console.log('[recommender] Too few high-score threads, lowering threshold');
      sortedThreads = scoredThreads
        .filter(thread => thread.recommendationScore > 0) // 只过滤负分帖子
        .sort((a, b) => b.recommendationScore - a.recommendationScore);
    }
    
    // 如果强制刷新，添加一些随机性来展示不同的内容
    if (forceRefresh && sortedThreads.length > limit) {
      // 保留前50%的高分帖子，其余随机排序
      const topCount = Math.ceil(sortedThreads.length * 0.5);
      const topThreads = sortedThreads.slice(0, topCount);
      const remainingThreads = sortedThreads.slice(topCount);
      
      // 随机打乱剩余帖子
      for (let i = remainingThreads.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [remainingThreads[i], remainingThreads[j]] = [remainingThreads[j], remainingThreads[i]];
      }
      
      sortedThreads = [...topThreads, ...remainingThreads];
    }
    
    sortedThreads = sortedThreads.slice(0, limit);
    
    console.log(`[recommender] Generated ${sortedThreads.length} recommendations`);
    console.log('[recommender] Final recommendations:', sortedThreads.map(t => ({
      threadId: t.threadId,
      title: t.title,
      score: t.recommendationScore
    })));
    
    // 如果推荐内容太少，添加一些新帖子作为备选
    if (sortedThreads.length < 3) {
      console.log('[recommender] Too few recommendations, adding new threads as fallback');
      const newThreads = recentThreads
        .filter(thread => !readThreadIds.has(thread.threadId))
        .sort((a, b) => new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt))
        .slice(0, 5);
      
      // 合并推荐和新帖子，去重
      const allRecs = [...sortedThreads, ...newThreads];
      const uniqueRecs = allRecs.filter((thread, index, self) => 
        index === self.findIndex(t => t.threadId === thread.threadId)
      );
      
      console.log(`[recommender] Added ${uniqueRecs.length - sortedThreads.length} fallback recommendations`);
      return uniqueRecs.slice(0, limit);
    }
    
    return sortedThreads;
    
  } catch (error) {
    console.error('[recommender] Failed to generate recommendations:', error);
    return [];
  }
}

/**
 * 获取基于标签的推荐
 * @param {number} limit - 推荐数量限制
 * @param {string} forum - 论坛过滤 ('all', 'linux.do', 'nodeseek.com')
 * @param {boolean} forceRefresh - 是否强制刷新，忽略已点击的帖子
 * @returns {Array} - 推荐帖子列表
 */
async function getTagBasedRecommendations(limit = 5, forum = 'all', forceRefresh = false) {
  try {
    const [readEvents, allThreads, dislikedThreads] = await Promise.all([
      storage.getAllReadEvents(),
      storage.getAllThreads(),
      storage.getAllDislikedThreads()
    ]);
    
    if (readEvents.length === 0) return [];
    
    // 统计用户最常阅读的标签
    const tagCounts = {};
    const completedEvents = readEvents.filter(event => event.completed === 1);
    
    completedEvents.forEach(event => {
      const thread = allThreads.find(t => t.threadId === event.threadId);
      if (thread && thread.tags) {
        thread.tags.forEach(tag => {
          tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
      }
    });
    
    // 获取最受欢迎的标签
    const popularTags = Object.entries(tagCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([tag]) => tag);
    
    if (popularTags.length === 0) return [];
    
    // 获取已读帖子、不感兴趣帖子和已点击帖子的ID集合
    const readThreadIds = new Set(readEvents.map(event => event.threadId));
    const dislikedThreadIds = new Set(dislikedThreads.map(thread => thread.threadId));
    const clickedThreadIds = await getClickedRecommendations();
    
    console.log('[recommender] Tag-based debug info:', {
      totalReadEvents: readEvents.length,
      readThreadIds: Array.from(readThreadIds),
      clickedThreadIds: Array.from(clickedThreadIds),
      popularTags,
      allThreadsCount: allThreads.length
    });
    
    // 基于标签推荐帖子，主要排除已读帖子
    let tagBasedThreads = allThreads.filter(thread => {
      const hasMatchingTag = thread.tags && thread.tags.some(tag => popularTags.includes(tag));
      const isRead = readThreadIds.has(thread.threadId);
      const isDisliked = dislikedThreadIds.has(thread.threadId);
      const isClicked = clickedThreadIds.has(thread.threadId);
      
      if (!hasMatchingTag) return false;
      
      // 主要过滤已读帖子
      if (isRead) {
        console.log(`[recommender] Tag-based filtering out read thread ${thread.threadId}`);
        return false;
      }
      
      // 其他条件更宽松
      if (isDisliked && !forceRefresh) {
        console.log(`[recommender] Tag-based filtering out disliked thread ${thread.threadId}`);
        return false;
      }
      
      if (isClicked && !forceRefresh) {
        console.log(`[recommender] Tag-based filtering out clicked thread ${thread.threadId}`);
        return false;
      }
      
      return true;
    });
    
    // 根据论坛过滤帖子
    if (forum !== 'all') {
      tagBasedThreads = tagBasedThreads.filter(thread => thread.forumId === forum);
      console.log(`[recommender] Tag-based filtered by forum ${forum}: ${tagBasedThreads.length} threads`);
    } else {
      console.log(`[recommender] Tag-based found ${tagBasedThreads.length} threads from all forums`);
    }
    
    // 按发布时间排序，返回最新的
    let sortedThreads = tagBasedThreads
      .sort((a, b) => new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt));
    
    // 如果强制刷新，添加一些随机性
    if (forceRefresh && sortedThreads.length > limit) {
      // 保留前50%的最新帖子，其余随机排序
      const topCount = Math.ceil(sortedThreads.length * 0.5);
      const topThreads = sortedThreads.slice(0, topCount);
      const remainingThreads = sortedThreads.slice(topCount);
      
      // 随机打乱剩余帖子
      for (let i = remainingThreads.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [remainingThreads[i], remainingThreads[j]] = [remainingThreads[j], remainingThreads[i]];
      }
      
      sortedThreads = [...topThreads, ...remainingThreads];
    }
    
    return sortedThreads.slice(0, limit);
    
  } catch (error) {
    console.error('[recommender] Failed to get tag-based recommendations:', error);
    return [];
  }
}

/**
 * 获取混合推荐（内容相似度 + 标签推荐）
 * @param {number} limit - 推荐数量限制
 * @param {string} forum - 论坛过滤 ('all', 'linux.do', 'nodeseek.com')
 * @param {boolean} forceRefresh - 是否强制刷新，忽略已点击的帖子
 * @returns {Array} - 推荐帖子列表
 */
async function getMixedRecommendations(limit = 10, forum = 'all', forceRefresh = false) {
  try {
    // 如果强制刷新，先清除已点击的推荐记录
    if (forceRefresh) {
      console.log('[recommender] Force refresh: clearing clicked recommendations');
      await clearClickedRecommendations();
    }
    
    const [contentRecs, tagRecs] = await Promise.all([
      generateRecommendations(Math.ceil(limit * 0.7), forum, forceRefresh),
      getTagBasedRecommendations(Math.ceil(limit * 0.3), forum, forceRefresh)
    ]);
    
    // 合并推荐，去重
    const allRecs = [...contentRecs, ...tagRecs];
    const uniqueRecs = allRecs.filter((thread, index, self) => 
      index === self.findIndex(t => t.threadId === thread.threadId)
    );
    
    console.log(`[recommender] Mixed recommendations for ${forum}: ${uniqueRecs.length} unique threads (forceRefresh: ${forceRefresh})`);
    return uniqueRecs.slice(0, limit);
    
  } catch (error) {
    console.error('[recommender] Failed to get mixed recommendations:', error);
    return [];
  }
}

export default {
  generateRecommendations,
  getTagBasedRecommendations,
  getMixedRecommendations,
  calculateTFIDFSimilarity,
  calculateFreshnessScore
};

