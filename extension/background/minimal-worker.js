// 最小化Service Worker - 绝对基础版本
console.log('[minimal-worker] Service Worker starting...');

// 最简单的消息处理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[minimal-worker] Received message:', message.type);
  
  try {
    switch (message.type) {
      case 'test':
        sendResponse({ ok: true, message: 'Minimal worker is working', timestamp: new Date().toISOString() });
        break;
      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  } catch (error) {
    console.error('[minimal-worker] Error:', error);
    sendResponse({ ok: false, error: error.message });
  }
  
  return true;
});

console.log('[minimal-worker] Service Worker ready');
