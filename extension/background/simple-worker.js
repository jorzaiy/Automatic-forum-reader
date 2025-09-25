// 简化的Service Worker - 用于测试
console.log('[simple-worker] Service Worker starting...');

// 保持Service Worker活跃
let keepAliveInterval;

// 启动保持活跃机制
function startKeepAlive() {
  keepAliveInterval = setInterval(() => {
    console.log('[simple-worker] Keep alive ping');
  }, 20000); // 每20秒ping一次
}

// 停止保持活跃机制
function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

// 简单的消息处理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[simple-worker] Received message:', message.type);
  
  // 启动保持活跃机制
  if (!keepAliveInterval) {
    startKeepAlive();
  }
  
  try {
    switch (message.type) {
      case 'test':
        sendResponse({ ok: true, message: 'Simple worker is working', timestamp: new Date().toISOString() });
        break;
        
      case 'fetch/stats':
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
        break;
        
      case 'stats/get':
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
        break;
        
      case 'debug/test':
        sendResponse({ 
          ok: true, 
          debug: {
            databaseConnected: false,
            stats: null,
            timestamp: new Date().toISOString(),
            workerType: 'simple',
            keepAliveActive: !!keepAliveInterval
          }
        });
        break;
        
      case 'ping':
        sendResponse({ ok: true, pong: new Date().toISOString() });
        break;
        
      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  } catch (error) {
    console.error('[simple-worker] Error handling message:', error);
    sendResponse({ ok: false, error: error.message });
  }
  
  return true; // 保持消息通道开放
});

// 扩展启动时启动保持活跃
chrome.runtime.onStartup.addListener(() => {
  console.log('[simple-worker] Extension startup');
  startKeepAlive();
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[simple-worker] Extension installed');
  startKeepAlive();
});

// 启动保持活跃机制
startKeepAlive();

console.log('[simple-worker] Service Worker ready');
