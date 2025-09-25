// Service Worker with Storage - 包含storage模块的版本
console.log('[worker-with-storage] Service Worker starting...');

// 导入storage模块
importScripts('storage-non-module.js');

// 等待storage模块加载
let storageReady = false;

// 检查storage模块是否可用
function checkStorageReady() {
  if (typeof self.storage !== 'undefined') {
    storageReady = true;
    console.log('[worker-with-storage] Storage module loaded');
  } else {
    console.log('[worker-with-storage] Waiting for storage module...');
    setTimeout(checkStorageReady, 100);
  }
}

// 初始化数据库
async function initializeDatabase() {
  try {
    console.log('[worker-with-storage] Initializing database...');
    await self.storage.init();
    console.log('[worker-with-storage] Database initialized successfully');
  } catch (error) {
    console.error('[worker-with-storage] Database initialization failed:', error);
  }
}

// 启动初始化
checkStorageReady();

// 消息处理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[worker-with-storage] Received message:', message.type);
  
  try {
    switch (message.type) {
      case 'test':
        sendResponse({ ok: true, message: 'Worker with storage is working', storageReady });
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
        if (storageReady) {
          // 使用真实的storage模块
          self.storage.getStats().then(stats => {
            sendResponse({ ok: true, stats });
          }).catch(error => {
            sendResponse({ ok: false, error: error.message });
          });
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
        
      case 'debug/test':
        sendResponse({ 
          ok: true, 
          debug: {
            databaseConnected: storageReady,
            stats: null,
            timestamp: new Date().toISOString(),
            workerType: 'with-storage'
          }
        });
        break;
        
      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  } catch (error) {
    console.error('[worker-with-storage] Error handling message:', error);
    sendResponse({ ok: false, error: error.message });
  }
  
  return true; // 保持消息通道开放
});

console.log('[worker-with-storage] Service Worker ready');
