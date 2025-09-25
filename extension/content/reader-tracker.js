// 阅读行为追踪器 - Content Script
// 监听页面行为，发送阅读事件到 background script

(function() {
  'use strict';
  
  console.log('[reader-tracker] Content script loaded');
  
  // 状态管理
  let isActive = false;
  let isVisible = true;
  let isFocused = true;
  let lastActivityTime = Date.now();
  let lastScrollTime = Date.now();
  let maxScrollPercent = 0;
  let activeTimeStart = null;
  let accumulatedActiveTime = 0;
  let heartbeatInterval = null;
  let currentThread = null;
  let extensionContextValid = true;
  let isShuttingDown = false;
  
  // 配置
  const IDLE_THRESHOLD_MS = 60 * 1000; // 60秒无交互视为空闲
  const HEARTBEAT_INTERVAL_MS = 10 * 1000; // 10秒心跳间隔
  const SCROLL_DEBOUNCE_MS = 100; // 滚动防抖
  
  // 初始化
  function init() {
    if (!isSupportedForumPage()) {
      console.log('[reader-tracker] Not a supported forum page, skipping initialization');
      return;
    }
    
    // 检查扩展上下文是否有效
    if (!chrome.runtime || !chrome.runtime.id) {
      console.warn('[reader-tracker] Extension context invalidated during init, disabling tracking');
      extensionContextValid = false;
      return;
    }
    
    // 如果已经在追踪状态，不要重复初始化
    if (isActive) {
      console.log('[reader-tracker] Already active, skipping re-initialization');
      return;
    }
    
    console.log('[reader-tracker] Initializing on supported forum page');
    
    // 启动扩展上下文监控（只在第一次初始化时）
    if (!contextMonitorInterval) {
      startExtensionContextMonitoring();
    }
    
    // 检测当前页面类型
    if (isThreadPage()) {
      console.log('[reader-tracker] Detected thread page, starting tracking');
      startTracking();
    } else {
      console.log('[reader-tracker] Not a thread page, waiting for navigation');
      // 监听页面变化（SPA导航）
      observePageChanges();
    }
  }
  
  // 检查是否是支持的论坛页面
  function isSupportedForumPage() {
    return window.location.hostname === 'linux.do' || window.location.hostname === 'www.nodeseek.com';
  }
  
  // 启动扩展上下文监控 - 简化版本
  let contextMonitorInterval = null;
  
  function startExtensionContextMonitoring() {
    // 如果已经有监控器在运行，先清除
    if (contextMonitorInterval) {
      clearInterval(contextMonitorInterval);
    }
    
    // 每30秒检查一次扩展上下文，如果失效则尝试重新初始化
    contextMonitorInterval = setInterval(() => {
      if (!chrome.runtime || !chrome.runtime.id) {
        if (extensionContextValid) {
          console.warn('[reader-tracker] Extension context invalidated, will retry on next page');
          extensionContextValid = false;
        }
      } else {
        // 如果扩展上下文恢复且当前不在追踪状态，重新初始化
        if (!extensionContextValid && !isActive && !isShuttingDown) {
          console.log('[reader-tracker] Extension context restored, reinitializing');
          extensionContextValid = true;
          init();
        }
      }
    }, 30000); // 30秒检查一次
  }
  
  // 检查是否是帖子页面
  function isThreadPage() {
    const path = window.location.pathname;
    const hostname = window.location.hostname;
    
    if (hostname === 'linux.do') {
      return path.includes('/t/') && path.split('/').length >= 4;
    } else if (hostname === 'www.nodeseek.com') {
      return path.includes('/post-') && path.includes('-1');
    }
    
    return false;
  }
  
  // 开始追踪
  function startTracking() {
    if (isActive || !extensionContextValid || isShuttingDown) return;
    
    isActive = true;
    currentThread = extractThreadInfo();
    
    if (!currentThread) {
      console.warn('[reader-tracker] Could not extract thread info');
      return;
    }
    
    console.log('[reader-tracker] Starting tracking for thread:', currentThread.threadId);
    
    // 发送开始事件
    sendReaderEvent('reader/open', currentThread, getCurrentMetrics());
    
    // 开始心跳
    startHeartbeat();
    
    // 绑定事件监听器
    bindEventListeners();
    
    // 重置状态
    resetTrackingState();
  }
  
  // 停止追踪
  function stopTracking(skipEvent = false) {
    if (!isActive || isShuttingDown) return;
    
    console.log('[reader-tracker] Stopping tracking');
    
    // 立即停止心跳，防止继续触发
    stopHeartbeat();
    
    // 发送结束事件（除非跳过）
    if (!skipEvent && currentThread && extensionContextValid && !isShuttingDown) {
      sendReaderEvent('reader/close', currentThread, getCurrentMetrics());
    }
    
    // 清理
    unbindEventListeners();
    
    isActive = false;
    currentThread = null;
  }
  
  // 完全关闭追踪器
  function shutdown() {
    if (isShuttingDown) return;
    
    console.log('[reader-tracker] Shutting down tracker');
    isShuttingDown = true;
    extensionContextValid = false;
    
    // 停止所有活动
    stopTracking(true);
    
    // 清理所有定时器
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    
    if (contextMonitorInterval) {
      clearInterval(contextMonitorInterval);
      contextMonitorInterval = null;
    }
  }
  
  // 提取帖子信息
  function extractThreadInfo() {
    try {
      const url = window.location.href;
      const hostname = window.location.hostname;
      const pathParts = window.location.pathname.split('/');
      
      // 从URL提取threadId
      let threadId = null;
      
      if (hostname === 'linux.do') {
        // Linux.do URL 格式: /t/topic/123456
        // Linux.do URL 格式: /t/some-slug/12345 or /t/12345
        if (pathParts[1] === 't' && pathParts.length >= 3) {
          // 最后一个部分通常是 ID
          const potentialId = pathParts[pathParts.length - 1];
          if (/^\d+$/.test(potentialId)) {
            threadId = `linuxdo:${potentialId}`;
          }
        }
      } else if (hostname === 'www.nodeseek.com') {
        // NodeSeek URL 格式: /post-123456-1
        const postMatch = window.location.pathname.match(/\/post-(\d+)-1/);
        if (postMatch) {
          threadId = `nodeseek:${postMatch[1]}`;
        }
      }
      
      if (!threadId) {
        console.warn('[reader-tracker] Could not extract threadId from URL:', url);
        return null;
      }
      
      // 提取标题
      let title = '';
      if (hostname === 'linux.do') {
        const titleEl = document.querySelector('h1, .topic-title, .post-title, [data-topic-title]');
        if (titleEl) {
          title = titleEl.textContent.trim();
        } else {
          title = document.title.replace(/ - Linux.do$/, '').trim();
        }
      } else if (hostname === 'www.nodeseek.com') {
        const titleEl = document.querySelector('h1, .post-title, .topic-title');
        if (titleEl) {
          title = titleEl.textContent.trim();
        } else {
          title = document.title.replace(/ - NodeSeek$/, '').trim();
        }
      }
      
      // 提取分类
      let category = '';
      if (hostname === 'linux.do') {
        const categoryEl = document.querySelector('.category-name, .breadcrumb a, .topic-category');
        if (categoryEl) {
          category = categoryEl.textContent.trim();
        }
      } else if (hostname === 'www.nodeseek.com') {
        // NodeSeek 的分类信息可能需要从其他地方提取
        const categoryEl = document.querySelector('.category, .breadcrumb a');
        if (categoryEl) {
          category = categoryEl.textContent.trim();
        }
      }
      
      // 提取标签
      let tags = [];
      if (hostname === 'linux.do') {
        const tagEls = document.querySelectorAll('.tag, .topic-tag, [data-tag]');
        tagEls.forEach(el => {
          const tag = el.textContent.trim();
          if (tag && !tags.includes(tag)) {
            tags.push(tag);
          }
        });
      } else if (hostname === 'www.nodeseek.com') {
        const tagEls = document.querySelectorAll('.tag, .badge, .nsk-badge');
        tagEls.forEach(el => {
          const tag = el.textContent.trim();
          if (tag && !tags.includes(tag) && tag !== '只读') {
            tags.push(tag);
          }
        });
      }
      
      return {
        threadId,
        url,
        title,
        category,
        tags
      };
      
    } catch (error) {
      console.error('[reader-tracker] Error extracting thread info:', error);
      return null;
    }
  }
  
  // 获取当前指标
  function getCurrentMetrics() {
    const now = Date.now();
    const isIdle = (now - lastActivityTime) > IDLE_THRESHOLD_MS;
    
    return {
      activeMsDelta: accumulatedActiveTime,
      maxScrollPct: maxScrollPercent,
      isVisible,
      isFocused,
      idle: isIdle
    };
  }
  
  // 重置追踪状态
  function resetTrackingState() {
    lastActivityTime = Date.now();
    lastScrollTime = Date.now();
    maxScrollPercent = 0;
    activeTimeStart = Date.now();
    accumulatedActiveTime = 0;
  }
  
  // 开始心跳
  function startHeartbeat() {
    if (heartbeatInterval || isShuttingDown) return;
    
    heartbeatInterval = setInterval(() => {
      // 如果正在关闭或扩展上下文已失效，立即停止心跳
      if (isShuttingDown || !extensionContextValid) {
        stopHeartbeat();
        return;
      }
      
      // 检查扩展上下文是否仍然有效
      // 简化检查，主要依赖 sendReaderEvent 中的错误处理
      
      if (isActive && currentThread && extensionContextValid && !isShuttingDown) {
        updateActiveTime();
        sendReaderEvent('reader/heartbeat', currentThread, getCurrentMetrics());
        accumulatedActiveTime = 0; // 重置累积时间
      }
    }, HEARTBEAT_INTERVAL_MS);
  }
  
  // 停止心跳
  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }
  
  // 更新活跃时间
  function updateActiveTime() {
    if (!isActive || !isVisible || !isFocused || isShuttingDown) {
      activeTimeStart = null;
      return;
    }
    
    const now = Date.now();
    const isIdle = (now - lastActivityTime) > IDLE_THRESHOLD_MS;
    
    if (!isIdle && activeTimeStart) {
      accumulatedActiveTime += now - activeTimeStart;
    }
    
    activeTimeStart = now;
  }
  
  // 更新滚动百分比
  function updateScrollPercent() {
    if (isShuttingDown) return;
    
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
    const percent = scrollHeight > 0 ? Math.round((scrollTop / scrollHeight) * 100) : 0;
    
    if (percent > maxScrollPercent) {
      maxScrollPercent = percent;
    }
  }
  
  // 记录活动
  function recordActivity() {
    if (isShuttingDown) return;
    
    lastActivityTime = Date.now();
    updateActiveTime();
  }
  
  // 发送阅读事件
  // 发送阅读事件（增加重试机制）
  function sendReaderEvent(type, thread, metrics, retryCount = 0) {
    if (isShuttingDown) return;

    if (!chrome.runtime || !chrome.runtime.id) {
      console.warn('[reader-tracker] Extension context is not available.');
      extensionContextValid = false;
      return;
    }

    const message = { type, thread, metrics, at: new Date().toISOString() };
    console.log(`[reader-tracker] Sending event (attempt ${retryCount + 1}):`, type, thread.threadId);

    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          const errorMsg = chrome.runtime.lastError.message || '';
          console.warn(`[reader-tracker] Attempt ${retryCount + 1} failed:`, errorMsg);

          if (retryCount < 1 && (errorMsg.includes('Receiving end does not exist') || errorMsg.includes('Could not establish connection'))) {
            console.log('[reader-tracker] Retrying in 1 second...');
            setTimeout(() => sendReaderEvent(type, thread, metrics, retryCount + 1), 1000);
          } else if (errorMsg.includes('Extension context invalidated')) {
            console.error('[reader-tracker] Extension context invalidated. Shutting down.');
            shutdown();
          }
        } else {
          console.log('[reader-tracker] Message sent successfully:', type);
          extensionContextValid = true; // 成功发送后，重置状态
        }
      });
    } catch (error) {
      console.error('[reader-tracker] Critical error sending message:', error);
      shutdown();
    }
  }
  
  // 绑定事件监听器
  function bindEventListeners() {
    if (isShuttingDown) return;
    
    // 可见性变化
    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    // 窗口焦点变化
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    
    // 滚动事件（防抖）
    let scrollTimeout;
    window.addEventListener('scroll', () => {
      if (isShuttingDown) return;
      
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        updateScrollPercent();
        recordActivity();
      }, SCROLL_DEBOUNCE_MS);
    });
    
    // 用户交互事件
    const interactionEvents = ['click', 'keydown', 'mousemove', 'touchstart'];
    interactionEvents.forEach(eventType => {
      document.addEventListener(eventType, () => {
        if (!isShuttingDown) {
          recordActivity();
        }
      }, { passive: true });
    });
    
    // 页面卸载
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // 页面隐藏
    window.addEventListener('pagehide', handlePageHide);
  }
  
  // 解绑事件监听器
  function unbindEventListeners() {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('focus', handleFocus);
    window.removeEventListener('blur', handleBlur);
    window.removeEventListener('beforeunload', handleBeforeUnload);
    window.removeEventListener('pagehide', handlePageHide);
    
    const interactionEvents = ['click', 'keydown', 'mousemove', 'touchstart'];
    interactionEvents.forEach(eventType => {
      document.removeEventListener(eventType, recordActivity);
    });
  }
  
  // 事件处理器
  function handleVisibilityChange() {
    if (isShuttingDown) return;
    
    isVisible = !document.hidden;
    console.log('[reader-tracker] Visibility changed:', isVisible);
    
    if (isVisible) {
      recordActivity();
    } else {
      updateActiveTime();
    }
  }
  
  function handleFocus() {
    if (isShuttingDown) return;
    
    isFocused = true;
    console.log('[reader-tracker] Window focused');
    recordActivity();
  }
  
  function handleBlur() {
    if (isShuttingDown) return;
    
    isFocused = false;
    console.log('[reader-tracker] Window blurred');
    updateActiveTime();
  }
  
  function handleBeforeUnload() {
    if (isShuttingDown) return;
    
    console.log('[reader-tracker] Page unloading');
    if (isActive && currentThread) {
      updateActiveTime();
      sendReaderEvent('reader/close', currentThread, getCurrentMetrics());
    }
  }
  
  function handlePageHide() {
    if (isShuttingDown) return;
    
    console.log('[reader-tracker] Page hidden');
    stopTracking();
  }
  
  // 监听页面变化（用于SPA导航）
  function observePageChanges() {
    if (isShuttingDown) return;
    
    let currentUrl = window.location.href;
    
    // 监听URL变化
    const observer = new MutationObserver(() => {
      if (isShuttingDown) return;
      
      if (window.location.href !== currentUrl) {
        currentUrl = window.location.href;
        console.log('[reader-tracker] URL changed to:', currentUrl);
        
        // 停止当前追踪
        if (isActive) {
          stopTracking();
        }
        
        // 检查新页面是否需要追踪
        if (isThreadPage()) {
          console.log('[reader-tracker] New thread page detected, starting tracking');
          startTracking();
        }
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
  
  // 启动
  init();
  
})();