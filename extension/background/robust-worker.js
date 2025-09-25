// 可靠的Service Worker - 简化但功能完整
console.log('[robust-worker] Service Worker starting...');

// 全局状态
let isInitialized = false;
let storageModule = null;
let fetcherModule = null;
let recommenderModule = null;

// 初始化函数
async function initialize() {
  if (isInitialized) {
    console.log('[robust-worker] Already initialized');
    return;
  }

  try {
    console.log('[robust-worker] Starting initialization...');
    
    // 等待模块加载
    await waitForModules();
    
    // 初始化数据库
    if (storageModule) {
      await storageModule.init();
      console.log('[robust-worker] Database initialized');
    }
    
    isInitialized = true;
    console.log('[robust-worker] Initialization complete');
  } catch (error) {
    console.error('[robust-worker] Initialization failed:', error);
  }
}

// 等待模块加载
async function waitForModules() {
  return new Promise((resolve) => {
    const checkModules = () => {
      if (typeof self.storage !== 'undefined') {
        storageModule = self.storage;
        console.log('[robust-worker] Storage module loaded');
      }
      if (typeof self.fetcherManager !== 'undefined') {
        fetcherModule = self.fetcherManager;
        console.log('[robust-worker] FetcherManager module loaded');
      }
      if (typeof self.recommender !== 'undefined') {
        recommenderModule = self.recommender;
        console.log('[robust-worker] Recommender module loaded');
      }
      
      // 至少storage模块必须可用
      if (storageModule) {
        resolve();
      } else {
        setTimeout(checkModules, 100);
      }
    };
    checkModules();
  });
}

// 消息处理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[robust-worker] Received message:', message.type);
  
  // 异步处理消息
  (async () => {
    try {
      // 确保已初始化
      if (!isInitialized) {
        await initialize();
      }
      
      switch (message.type) {
        case 'test':
          sendResponse({ 
            ok: true, 
            message: 'Robust worker is working',
            initialized: isInitialized,
            timestamp: new Date().toISOString()
          });
          break;
          
        case 'fetch/stats':
          if (fetcherModule && fetcherModule.getFetchStats) {
            const stats = fetcherModule.getFetchStats();
            sendResponse({ ok: true, stats });
          } else {
            sendResponse({ 
              ok: true, 
              stats: {
                timeSinceLastFetch: null,
                timeSinceLastSuccess: null,
                totalFetches: 0,
                successfulFetches: 0,
                forums: []
              }
            });
          }
          break;
          
        case 'stats/get':
          if (storageModule && storageModule.getStats) {
            const stats = await storageModule.getStats();
            sendResponse({ ok: true, stats });
          } else {
            sendResponse({ 
              ok: true, 
              stats: {
                totalEvents: 0,
                totalThreads: 0,
                newThreads: 0,
                todayEvents: 0,
                completedToday: 0,
                dislikedThreads: 0
              }
            });
          }
          break;
          
        case 'recommend/generate':
          if (recommenderModule && recommenderModule.generateRecommendations) {
            const { limit = 5, forum = 'all' } = message;
            const recommendations = await recommenderModule.generateRecommendations(limit, forum);
            sendResponse({ ok: true, recommendations });
          } else {
            sendResponse({ ok: true, recommendations: [] });
          }
          break;
          
        case 'debug/test':
          sendResponse({ 
            ok: true, 
            debug: {
              databaseConnected: isInitialized,
              storageAvailable: !!storageModule,
              fetcherAvailable: !!fetcherModule,
              recommenderAvailable: !!recommenderModule,
              timestamp: new Date().toISOString(),
              workerType: 'robust'
            }
          });
          break;
          
        default:
          sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('[robust-worker] Error handling message:', error);
      sendResponse({ ok: false, error: error.message });
    }
  })();
  
  return true; // 保持消息通道开放
});

// 扩展启动事件
chrome.runtime.onStartup.addListener(() => {
  console.log('[robust-worker] Extension startup');
  initialize();
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[robust-worker] Extension installed');
  initialize();
});

// 立即初始化
initialize();

console.log('[robust-worker] Service Worker ready');
