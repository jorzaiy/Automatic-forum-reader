// Background Service Worker - 主服务工作者
// 处理来自 content script 的事件，管理 IndexedDB，调度增量抓取

import storage from './storage.js';
import fetcherManager from './fetcher.js';
import recommender from './recommender.js';

// 全局状态
let currentSessionId = null;
let sessionTimeout = null;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30分钟

// 初始化数据库
async function initializeDatabase() {
  try {
    await storage.init();
    console.log('[background] Database initialized successfully');
  } catch (error) {
    console.error('[background] Failed to initialize database:', error);
  }
}

// 生成新的会话ID
function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 获取或创建当前会话
function getCurrentSession() {
  const now = Date.now();
  
  // 如果当前会话超时，创建新会话
  if (!currentSessionId || (sessionTimeout && now > sessionTimeout)) {
    currentSessionId = generateSessionId();
    sessionTimeout = now + SESSION_TIMEOUT_MS;
    
    // 保存新会话到数据库
    storage.saveSession({
      sessionId: currentSessionId,
      startedAt: new Date(now).toISOString(),
      endedAt: null
    });
    
    console.log('[background] Created new session:', currentSessionId);
  }
  
  return currentSessionId;
}

// 处理阅读事件
async function handleReaderEvent(message, sender, sendResponse) {
  try {
    const { type, thread, metrics, at } = message;
    
    if (!thread?.threadId) {
      console.warn('[background] Invalid reader event: missing threadId');
      sendResponse({ ok: false, error: 'Missing threadId' });
      return;
    }
    
    const sessionId = getCurrentSession();
    
    switch (type) {
      case 'reader/open':
        console.log('[background] Reader opened:', thread.threadId);
        // 保存帖子信息
        const forumId = thread.threadId.startsWith('nodeseek:') ? 'nodeseek.com' : 'linux.do';
        await storage.upsertThread({
          threadId: thread.threadId,
          forumId: forumId,
          url: thread.url,
          title: thread.title,
          category: thread.category || '',
          tags: thread.tags || [],
          publishedAt: thread.publishedAt || new Date().toISOString(),
          isNew: false
        });
        sendResponse({ ok: true });
        break;
        
      case 'reader/heartbeat':
        // 更新阅读事件
        console.log('[background] Heartbeat received:', {
          threadId: thread.threadId,
          activeMsDelta: metrics.activeMsDelta,
          maxScrollPct: metrics.maxScrollPct,
          isVisible: metrics.isVisible,
          isFocused: metrics.isFocused,
          idle: metrics.idle
        });
        await storage.updateReadEvent({
          sessionId,
          threadId: thread.threadId,
          url: thread.url,
          activeMsDelta: metrics.activeMsDelta || 0,
          maxScrollPct: metrics.maxScrollPct || 0,
          isVisible: metrics.isVisible,
          isFocused: metrics.isFocused,
          idle: metrics.idle,
          at
        });
        sendResponse({ ok: true });
        break;
        
      case 'reader/close':
        console.log('[background] Reader closed:', thread.threadId);
        // 最终结算阅读事件
        await storage.finalizeReadEvent({
          sessionId,
          threadId: thread.threadId,
          url: thread.url,
          activeMsDelta: metrics.activeMsDelta || 0,
          maxScrollPct: metrics.maxScrollPct || 0,
          at
        });
        sendResponse({ ok: true });
        break;
        
      default:
        console.warn('[background] Unknown reader event type:', type);
        sendResponse({ ok: false, error: 'Unknown reader event type' });
    }
    
  } catch (error) {
    console.error('[background] Error handling reader event:', error);
    sendResponse({ ok: false, error: error.message });
  }
}

// 处理数据库操作请求
async function handleDatabaseRequest(message, sender, sendResponse) {
  try {
    const { type, data } = message;
    
    switch (type) {
      case 'db/export':
        const exportData = await storage.exportAllData();
        const jsonString = JSON.stringify(exportData, null, 2);
        const bytes = new TextEncoder().encode(jsonString);
        sendResponse({ ok: true, bytes: Array.from(bytes) });
        break;
        
      case 'db/export-reading':
        const exportReadingData = await storage.exportReadingData();
        const readingJsonString = JSON.stringify(exportReadingData, null, 2);
        const readingBytes = new TextEncoder().encode(readingJsonString);
        sendResponse({ ok: true, bytes: Array.from(readingBytes) });
        break;
        
      case 'db/export-fetch':
        const exportFetchData = await storage.exportFetchData();
        const fetchJsonString = JSON.stringify(exportFetchData, null, 2);
        const fetchBytes = new TextEncoder().encode(fetchJsonString);
        sendResponse({ ok: true, bytes: Array.from(fetchBytes) });
        break;
        
      case 'db/clear':
        await storage.clearAllData();
        sendResponse({ ok: true });
        break;
        
      case 'db/clear-reading':
        const clearReadingResult = await storage.clearReadingData();
        sendResponse({ ok: true, result: clearReadingResult });
        break;
        
      case 'db/clear-fetch':
        const clearFetchResult = await storage.clearFetchData();
        sendResponse({ ok: true, result: clearFetchResult });
        break;
        
      case 'db/import':
        const result = await storage.importData(data);
        sendResponse({ ok: true, result });
        break;
      case 'db/deduplicate':
        const deduplicateResult = await storage.deduplicateReadEvents();
        sendResponse({ ok: true, result: deduplicateResult });
        break;
      
        
      default:
        sendResponse({ ok: false, error: 'Unknown database operation' });
    }
  } catch (error) {
    console.error('[background] Database operation failed:', error);
    sendResponse({ ok: false, error: error.message });
  }
}

// 处理抓取请求
async function handleFetchRequest(message, sender, sendResponse) {
  try {
    const { type } = message;
    
    if (type === 'fetch/trigger') {
      const results = await fetcherManager.performIncrementalFetch(true);
      const summary = results.reduce((acc, result) => {
        acc.totalNewTopics += result.newTopics || 0;
        if (result.success) acc.successfulForums++;
        return acc;
      }, { totalNewTopics: 0, successfulForums: 0 });

      if (summary.totalNewTopics > 0) {
        console.log(`[background] Fetch complete, found ${summary.totalNewTopics} new topics, refreshing recommendations.`);
        await recommender.getMixedRecommendations(10, 'all');
      }

      sendResponse({
        ok: true,
        result: {
          success: summary.successfulForums > 0,
          newTopics: summary.totalNewTopics,
          results,
          summary: { ...summary, totalForums: results.length },
        },
      });
    } else if (type === 'fetch/stats') {
      const stats = fetcherManager.getFetchStats();
      sendResponse({ ok: true, stats });
    } else {
      sendResponse({ ok: false, error: 'Unknown fetch operation' });
    }
  } catch (error) {
    console.error('[background] Fetch operation failed:', error);
    sendResponse({ ok: false, error: error.message });
  }
}

// 处理推荐点击事件
async function handleRecommendationClick(threadId, title) {
  try {
    console.log('[background] Marking recommendation as clicked:', threadId, title);
    
    // 将点击的帖子添加到已点击列表（使用chrome.storage.local）
    const clickedKey = 'clicked_recommendations';
    
    // 获取现有的已点击列表
    const result = await chrome.storage.local.get([clickedKey]);
    const existingClicked = result[clickedKey] || [];
    
    // 检查是否已经存在
    if (!existingClicked.includes(threadId)) {
      existingClicked.push(threadId);
      await chrome.storage.local.set({ [clickedKey]: existingClicked });
      console.log('[background] Added to clicked recommendations:', threadId);
    } else {
      console.log('[background] Already in clicked recommendations:', threadId);
    }
    
  } catch (error) {
    console.error('[background] Error handling recommendation click:', error);
  }
}

// 清除已点击推荐列表
async function clearClickedRecommendations() {
  try {
    console.log('[background] Clearing clicked recommendations list');
    await chrome.storage.local.remove(['clicked_recommendations']);
    console.log('[background] Clicked recommendations list cleared');
  } catch (error) {
    console.error('[background] Error clearing clicked recommendations:', error);
  }
}

// 处理推荐请求
async function handleRecommendationRequest(message, sender, sendResponse) {
  try {
    const { type, limit = 10, forum = 'all', forceRefresh = false } = message;
    
    let recommendations = [];
    
    switch (type) {
      case 'recommend/content':
        recommendations = await recommender.generateRecommendations(limit, forum);
        break;
      case 'recommend/tags':
        recommendations = await recommender.getTagBasedRecommendations(limit, forum);
        break;
      case 'recommend/mixed':
        recommendations = await recommender.getMixedRecommendations(limit, forum, forceRefresh);
        break;
      case 'recommend/clicked':
        // 处理推荐点击事件
        const { threadId, title } = message;
        console.log('[background] Recommendation clicked:', threadId, title);
        await handleRecommendationClick(threadId, title);
        sendResponse({ ok: true });
        return;
      case 'recommend/clear-clicked':
        // 清除已点击推荐列表
        await clearClickedRecommendations();
        sendResponse({ ok: true });
        return;
      default:
        sendResponse({ ok: false, error: 'Unknown recommendation type' });
        return;
    }
    
    sendResponse({ ok: true, recommendations });
    
  } catch (error) {
    console.error('[background] Recommendation request failed:', error);
    sendResponse({ ok: false, error: error.message });
  }
}

// 处理不感兴趣请求
async function handleDislikeRequest(message, sender, sendResponse) {
  try {
    const { type, threadId, title } = message;
    
    switch (type) {
      case 'dislike/add':
        await storage.addDislikedThread(threadId);
        console.log(`[background] Added disliked thread: ${threadId} - ${title}`);
        sendResponse({ ok: true });
        break;
        
      case 'dislike/remove':
        await storage.removeDislikedThread(threadId);
        console.log(`[background] Removed disliked thread: ${threadId} - ${title}`);
        sendResponse({ ok: true });
        break;
        
      case 'dislike/list':
        const dislikedThreads = await storage.getAllDislikedThreads();
        sendResponse({ ok: true, dislikedThreads });
        break;
        
      default:
        sendResponse({ ok: false, error: 'Unknown dislike operation' });
    }
    
  } catch (error) {
    console.error('[background] Dislike request failed:', error);
    sendResponse({ ok: false, error: error.message });
  }
}

// 处理调试请求
async function handleDebugRequest(message, sender, sendResponse) {
  try {
    const { type } = message;
    
    switch (type) {
      case 'debug/check':
        const stats = await storage.getStats();
        sendResponse({ 
          ok: true, 
          debug: {
            currentSessionId,
            sessionTimeout,
            stats,
            timestamp: new Date().toISOString()
          }
        });
        break;
      default:
        sendResponse({ ok: false, error: 'Unknown debug type' });
    }
    
  } catch (error) {
    console.error('[background] Debug request failed:', error);
    sendResponse({ ok: false, error: error.message });
  }
}

// 消息路由
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[background] Received message:', message.type);
  
  // 异步处理，返回 true 表示会异步响应
  (async () => {
    try {
      if (message.type.startsWith('reader/')) {
        await handleReaderEvent(message, sender, sendResponse);
      } else if (message.type.startsWith('db/')) {
        await handleDatabaseRequest(message, sender, sendResponse);
      } else if (message.type.startsWith('fetch/')) {
        await handleFetchRequest(message, sender, sendResponse);
      } else if (message.type.startsWith('recommend/')) {
        await handleRecommendationRequest(message, sender, sendResponse);
      } else if (message.type.startsWith('dislike/')) {
        await handleDislikeRequest(message, sender, sendResponse);
      } else if (message.type.startsWith('debug/')) {
        await handleDebugRequest(message, sender, sendResponse);
      } else {
        console.warn('[background] Unknown message type:', message.type);
        sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('[background] Message handling error:', error);
      try {
        sendResponse({ ok: false, error: error.message });
      } catch (responseError) {
        console.error('[background] Error sending response:', responseError);
      }
    }
  })();
  
  return true; // 保持消息通道开放以进行异步响应
});

// 定时任务：增量抓取
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'incremental-fetch') {
    console.log('[background] Running scheduled incremental fetch for all forums.');
    const results = await fetcherManager.performIncrementalFetch();
    const totalNewTopics = results.reduce((sum, result) => sum + (result.newTopics || 0), 0);

    if (totalNewTopics > 0) {
      console.log(`[background] Scheduled fetch found ${totalNewTopics} new topics.`);
      await recommender.getMixedRecommendations(10, 'all');
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        title: '多论坛新内容',
        message: `发现 ${totalNewTopics} 个新帖子，推荐已更新`,
      });
    }
  }
});

// 扩展安装/启动时的初始化
chrome.runtime.onStartup.addListener(async () => {
  console.log('[background] Extension startup');
  await initializeDatabase();
});

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[background] Extension installed/updated:', details.reason);
  await initializeDatabase();
  
  // 创建定时抓取任务
  chrome.alarms.create('incremental-fetch', {
    delayInMinutes: 1, // 1分钟后开始第一次抓取
    periodInMinutes: 30 // 每30分钟抓取一次
  });
});

// 通知点击处理
chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.tabs.create({ url: 'https://linux.do/latest' });
  chrome.notifications.clear(notificationId);
});

// 初始化
(async () => {
  await initializeDatabase();
  console.log('[background] Background service worker ready');
})();
