// IndexedDB 存储模块
// 管理所有数据的存储、查询和导出

const DB_NAME = 'LinuxDoReader';
const DB_VERSION = 5;

let db = null;

// 初始化数据库
async function init(isRetry = false) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[storage] Failed to open database:', request.error);
      if (!isRetry) {
        console.warn('[storage] Attempting to recover by deleting the database.');
        const deleteRequest = indexedDB.deleteDatabase(DB_NAME);
        deleteRequest.onsuccess = () => {
          console.log('[storage] Database deleted. Retrying to open...');
          init(true).then(resolve).catch(reject);
        };
        deleteRequest.onerror = () => {
          console.error('[storage] Failed to delete database.', deleteRequest.error);
          reject(deleteRequest.error);
        };
      } else {
        console.error('[storage] Failed to open database even after retry.');
        reject(request.error);
      }
    };

    request.onsuccess = () => {
      db = request.result;
      console.log('[storage] Database opened successfully');
      resolve();
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      console.log('[storage] Upgrading database to version:', DB_VERSION);

      // 创建 forums ObjectStore
      if (!database.objectStoreNames.contains('forums')) {
        const forumsStore = database.createObjectStore('forums', { keyPath: 'forumId' });
        console.log('[storage] Created forums ObjectStore');
      }

      // 创建 threads ObjectStore
      if (!database.objectStoreNames.contains('threads')) {
        const threadsStore = database.createObjectStore('threads', { keyPath: 'threadId' });
        threadsStore.createIndex('category', 'category', { unique: false });
        threadsStore.createIndex('isNew', 'isNew', { unique: false });
        threadsStore.createIndex('createdAt', 'createdAt', { unique: false });
        console.log('[storage] Created threads ObjectStore');
      }

      // 创建 sessions ObjectStore
      if (!database.objectStoreNames.contains('sessions')) {
        database.createObjectStore('sessions', { keyPath: 'sessionId' });
        console.log('[storage] Created sessions ObjectStore');
      }

      // 创建 read_events ObjectStore
      if (!database.objectStoreNames.contains('read_events')) {
        const eventsStore = database.createObjectStore('read_events', { keyPath: 'eventId' });
        eventsStore.createIndex('threadId', 'threadId', { unique: false });
        eventsStore.createIndex('sessionId', 'sessionId', { unique: false });
        eventsStore.createIndex('createdAt', 'createdAt', { unique: false });
        console.log('[storage] Created read_events ObjectStore');
      }

      // 创建 disliked_threads ObjectStore
      if (!database.objectStoreNames.contains('disliked_threads')) {
        const dislikedStore = database.createObjectStore('disliked_threads', { keyPath: 'threadId' });
        dislikedStore.createIndex('createdAt', 'createdAt', { unique: false });
        console.log('[storage] Created disliked_threads ObjectStore');
      }

      // 初始化论坛数据
      const transaction = event.target.transaction;
      const forumsStore = transaction.objectStore('forums');
      
      // 初始化 Linux.do 论坛
      forumsStore.put({
        forumId: 'linux.do',
        baseUrl: 'https://linux.do',
        createdAt: new Date().toISOString()
      });
      
      // 初始化 NodeSeek 论坛
      forumsStore.put({
        forumId: 'nodeseek.com',
        baseUrl: 'https://www.nodeseek.com',
        createdAt: new Date().toISOString()
      });
    };
  });
}

// 确保数据库已初始化
async function ensureDb() {
  if (!db) {
    await init();
  }
  return db;
}

// 生成唯一ID
function generateId() {
  return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 保存会话
async function saveSession(session) {
  await ensureDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sessions'], 'readwrite');
    const store = transaction.objectStore('sessions');
    const request = store.put(session);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// 保存或更新帖子
async function upsertThread(thread) {
  await ensureDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['threads'], 'readwrite');
    const store = transaction.objectStore('threads');
    
    // 先尝试获取现有记录
    const getRequest = store.get(thread.threadId);
    getRequest.onsuccess = () => {
      const existing = getRequest.result;
      const now = new Date().toISOString();
      
      const threadData = {
        threadId: thread.threadId,
        forumId: thread.forumId || 'linux.do',
        url: thread.url,
        title: thread.title,
        category: thread.category || '',
        tags: thread.tags || [],
        publishedAt: thread.publishedAt || now,
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now,
        lastSeenAt: now,
        isNew: thread.isNew !== undefined ? thread.isNew : (existing ? existing.isNew : true)
      };
      
      const putRequest = store.put(threadData);
      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(putRequest.error);
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

// 获取用户设置的阈值
async function getThresholds() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['thresholdSeconds', 'thresholdScroll'], (result) => {
      resolve({
        thresholdSeconds: result.thresholdSeconds || 20,
        thresholdScroll: result.thresholdScroll || 50
      });
    });
  });
}


// 更新阅读事件
async function updateReadEvent(eventData) {
  await ensureDb();
  const thresholds = await getThresholds();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['read_events'], 'readwrite');
    const store = transaction.objectStore('read_events');
    
    const eventId = `${eventData.sessionId}_${eventData.threadId}`;
    const now = new Date().toISOString();
    
    // 先尝试获取现有记录
    const getRequest = store.get(eventId);
    getRequest.onsuccess = () => {
      const existing = getRequest.result;
      
      // 防止重复记录：如果记录已存在且时间间隔很短，则合并数据
      if (existing) {
        const timeDiff = new Date(now) - new Date(existing.updatedAt);
        const isRecentUpdate = timeDiff < 5000; // 5秒内的更新视为重复
        
        if (isRecentUpdate) {
          console.log(`[storage] Merging recent update for ${eventData.threadId}, time diff: ${timeDiff}ms`);
          
          // 合并数据而不是创建新记录
          const mergedEvent = {
            ...existing,
            leaveAt: now,
            dwellMsEffective: existing.dwellMsEffective + (eventData.activeMsDelta || 0),
            maxScrollPct: Math.max(existing.maxScrollPct, eventData.maxScrollPct || 0),
            updatedAt: now
          };
          
          // 检查是否完成阅读（使用用户设置的阈值）
          const thresholdMs = thresholds.thresholdSeconds * 1000;
          if (mergedEvent.dwellMsEffective >= thresholdMs && mergedEvent.maxScrollPct >= thresholds.thresholdScroll) {
            mergedEvent.completed = 1;
          }
          
          const putRequest = store.put(mergedEvent);
          putRequest.onsuccess = () => resolve();
          putRequest.onerror = () => reject(putRequest.error);
          return;
        }
      }
      
      const event = {
        eventId,
        sessionId: eventData.sessionId,
        threadId: eventData.threadId,
        url: eventData.url,
        enterAt: existing ? existing.enterAt : now,
        leaveAt: now,
        dwellMsEffective: (existing ? existing.dwellMsEffective : 0) + (eventData.activeMsDelta || 0),
        maxScrollPct: Math.max(existing ? existing.maxScrollPct : 0, eventData.maxScrollPct || 0),
        completed: existing ? existing.completed : 0,
        createdAt: existing ? existing.createdAt : now,
        updatedAt: now
      };
      
      // 检查是否完成阅读（使用用户设置的阈值）
      const thresholdMs = thresholds.thresholdSeconds * 1000;
      console.log('[storage] Checking completion:', {
        dwellMsEffective: event.dwellMsEffective,
        thresholdMs,
        maxScrollPct: event.maxScrollPct,
        thresholdScroll: thresholds.thresholdScroll,
        willComplete: event.dwellMsEffective >= thresholdMs && event.maxScrollPct >= thresholds.thresholdScroll
      });
      if (event.dwellMsEffective >= thresholdMs && event.maxScrollPct >= thresholds.thresholdScroll) {
        event.completed = 1;
        console.log('[storage] Marked as completed!');
      }
      
      const putRequest = store.put(event);
      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(putRequest.error);
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

// 最终结算阅读事件
async function finalizeReadEvent(eventData) {
  await ensureDb();
  const thresholds = await getThresholds();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['read_events'], 'readwrite');
    const store = transaction.objectStore('read_events');
    
    const eventId = `${eventData.sessionId}_${eventData.threadId}`;
    const now = new Date().toISOString();
    
    // 先尝试获取现有记录
    const getRequest = store.get(eventId);
    getRequest.onsuccess = () => {
      const existing = getRequest.result;
      
      if (existing) {
        const event = {
          ...existing,
          leaveAt: now,
          dwellMsEffective: existing.dwellMsEffective + (eventData.activeMsDelta || 0),
          maxScrollPct: Math.max(existing.maxScrollPct, eventData.maxScrollPct || 0),
          updatedAt: now
        };
        
        // 最终检查是否完成阅读（使用用户设置的阈值）
        const thresholdMs = thresholds.thresholdSeconds * 1000;
        if (event.dwellMsEffective >= thresholdMs && event.maxScrollPct >= thresholds.thresholdScroll) {
          event.completed = 1;
        }
        
        const putRequest = store.put(event);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      } else {
        // 如果没有现有记录，创建一个新的
        const event = {
          eventId,
          sessionId: eventData.sessionId,
          threadId: eventData.threadId,
          url: eventData.url,
          enterAt: now,
          leaveAt: now,
          dwellMsEffective: eventData.activeMsDelta || 0,
          maxScrollPct: eventData.maxScrollPct || 0,
          completed: 0,
          createdAt: now,
          updatedAt: now
        };
        
        // 检查是否完成阅读（使用用户设置的阈值）
        const thresholdMs = thresholds.thresholdSeconds * 1000;
        if (event.dwellMsEffective >= thresholdMs && event.maxScrollPct >= thresholds.thresholdScroll) {
          event.completed = 1;
        }
        
        const putRequest = store.put(event);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      }
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

// 获取所有帖子
async function getAllThreads() {
  await ensureDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['threads'], 'readonly');
    const store = transaction.objectStore('threads');
    const request = store.getAll();
    
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// 获取新帖子
async function getNewThreads() {
  await ensureDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['threads'], 'readonly');
    const store = transaction.objectStore('threads');
    const index = store.index('isNew');
    const request = index.getAll(true); // 只获取 isNew = true 的记录
    
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// 获取所有阅读事件
async function getAllReadEvents() {
  await ensureDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['read_events'], 'readonly');
    const store = transaction.objectStore('read_events');
    const request = store.getAll();
    
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// 获取所有会话
async function getAllSessions() {
  await ensureDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['sessions'], 'readonly');
    const store = transaction.objectStore('sessions');
    const request = store.getAll();
    
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// 导出所有数据
async function exportAllData() {
  await ensureDb();
  
  const [events, sessions, threads] = await Promise.all([
    getAllReadEvents(),
    getAllSessions(),
    getAllThreads()
  ]);
  
  return {
    events,
    sessions,
    threads,
    exportedAt: new Date().toISOString()
  };
}

// 清空所有数据
async function clearAllData() {
  await ensureDb();
  
  const objectStoreNames = ['forums', 'threads', 'sessions', 'read_events'];
  
  for (const storeName of objectStoreNames) {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  // 重新初始化论坛数据
  await new Promise((resolve, reject) => {
    const transaction = db.transaction(['forums'], 'readwrite');
    const store = transaction.objectStore('forums');
    
    // 初始化 Linux.do 论坛
    const linuxDoRequest = store.put({
      forumId: 'linux.do',
      baseUrl: 'https://linux.do',
      createdAt: new Date().toISOString()
    });
    
    linuxDoRequest.onsuccess = () => {
      // 初始化 NodeSeek 论坛
      const nodeSeekRequest = store.put({
        forumId: 'nodeseek.com',
        baseUrl: 'https://www.nodeseek.com',
        createdAt: new Date().toISOString()
      });
      
      nodeSeekRequest.onsuccess = () => resolve();
      nodeSeekRequest.onerror = () => reject(nodeSeekRequest.error);
    };
    
    linuxDoRequest.onerror = () => reject(linuxDoRequest.error);
  });
}

// 添加不感兴趣的帖子
async function addDislikedThread(threadId) {
  await ensureDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['disliked_threads'], 'readwrite');
    const store = transaction.objectStore('disliked_threads');
    const now = new Date().toISOString();
    
    const dislikedThread = {
      threadId,
      createdAt: now,
      updatedAt: now
    };
    
    const request = store.put(dislikedThread);
    request.onsuccess = () => {
      console.log(`[storage] Added disliked thread: ${threadId}`);
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

// 获取所有不感兴趣的帖子
async function getAllDislikedThreads() {
  await ensureDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['disliked_threads'], 'readonly');
    const store = transaction.objectStore('disliked_threads');
    const request = store.getAll();
    
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// 移除不感兴趣的帖子
async function removeDislikedThread(threadId) {
  await ensureDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['disliked_threads'], 'readwrite');
    const store = transaction.objectStore('disliked_threads');
    const request = store.delete(threadId);
    
    request.onsuccess = () => {
      console.log(`[storage] Removed disliked thread: ${threadId}`);
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

// 导入数据（只导入阅读记录和偏好数据）
async function importData(importData) {
  await ensureDb();
  
  try {
    console.log('[storage] Starting data import...');
    
    let importedCount = 0;
    let skippedCount = 0;
    const errors = [];
    
    // 导入阅读事件
    if (importData.events && Array.isArray(importData.events)) {
      console.log(`[storage] Importing ${importData.events.length} read events...`);
      
      for (const event of importData.events) {
        try {
          // 验证事件数据
          if (!event.eventId || !event.threadId || !event.sessionId) {
            errors.push(`Invalid event data: missing required fields`);
            skippedCount++;
            continue;
          }
          
          // 检查是否已存在
          const existing = await new Promise((resolve) => {
            const transaction = db.transaction(['read_events'], 'readonly');
            const store = transaction.objectStore('read_events');
            const request = store.get(event.eventId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
          });
          
          if (existing) {
            console.log(`[storage] Event ${event.eventId} already exists, skipping`);
            skippedCount++;
            continue;
          }
          
          // 导入事件
          await new Promise((resolve, reject) => {
            const transaction = db.transaction(['read_events'], 'readwrite');
            const store = transaction.objectStore('read_events');
            const request = store.put(event);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
          });
          
          importedCount++;
        } catch (error) {
          console.error(`[storage] Error importing event ${event.eventId}:`, error);
          errors.push(`Event ${event.eventId}: ${error.message}`);
          skippedCount++;
        }
      }
    }
    
    // 导入不感兴趣的帖子
    if (importData.dislikedThreads && Array.isArray(importData.dislikedThreads)) {
      console.log(`[storage] Importing ${importData.dislikedThreads.length} disliked threads...`);
      
      for (const dislikedThread of importData.dislikedThreads) {
        try {
          // 验证数据
          if (!dislikedThread.threadId) {
            errors.push(`Invalid disliked thread data: missing threadId`);
            skippedCount++;
            continue;
          }
          
          // 检查是否已存在
          const existing = await new Promise((resolve) => {
            const transaction = db.transaction(['disliked_threads'], 'readonly');
            const store = transaction.objectStore('disliked_threads');
            const request = store.get(dislikedThread.threadId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
          });
          
          if (existing) {
            console.log(`[storage] Disliked thread ${dislikedThread.threadId} already exists, skipping`);
            skippedCount++;
            continue;
          }
          
          // 导入不感兴趣的帖子
          await new Promise((resolve, reject) => {
            const transaction = db.transaction(['disliked_threads'], 'readwrite');
            const store = transaction.objectStore('disliked_threads');
            const request = store.put(dislikedThread);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
          });
          
          importedCount++;
        } catch (error) {
          console.error(`[storage] Error importing disliked thread ${dislikedThread.threadId}:`, error);
          errors.push(`Disliked thread ${dislikedThread.threadId}: ${error.message}`);
          skippedCount++;
        }
      }
    }
    
    console.log(`[storage] Import completed: ${importedCount} imported, ${skippedCount} skipped`);
    
    return {
      success: true,
      importedCount,
      skippedCount,
      errors: errors.slice(0, 10) // 只返回前10个错误
    };
    
  } catch (error) {
    console.error('[storage] Import failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

// 获取统计信息
async function getStats() {
  await ensureDb();
  
  const [events, threads, newThreads, dislikedThreads] = await Promise.all([
    getAllReadEvents(),
    getAllThreads(),
    getNewThreads(),
    getAllDislikedThreads()
  ]);
  
  const today = new Date().toDateString();
  const todayEvents = events.filter(e => new Date(e.createdAt).toDateString() === today);
  const completedToday = todayEvents.filter(e => e.completed === 1).length;
  
  return {
    totalEvents: events.length,
    totalThreads: threads.length,
    newThreads: newThreads.length,
    todayEvents: todayEvents.length,
    completedToday,
    dislikedThreads: dislikedThreads.length
  };
}


// 去重阅读事件（用于数据清理）
async function deduplicateReadEvents() {
  await ensureDb();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['read_events'], 'readwrite');
    const store = transaction.objectStore('read_events');
    const request = store.getAll();
    
    request.onsuccess = () => {
      const events = request.result;
      const threadGroups = {};
      
      // 按 threadId 分组
      events.forEach(event => {
        if (!threadGroups[event.threadId]) {
          threadGroups[event.threadId] = [];
        }
        threadGroups[event.threadId].push(event);
      });
      
      // 合并重复事件
      const mergedEvents = [];
      const duplicateCount = { total: 0, threads: 0 };
      
      Object.entries(threadGroups).forEach(([threadId, threadEvents]) => {
        if (threadEvents.length > 1) {
          // 合并重复事件
          const sortedEvents = threadEvents.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
          const merged = {
            ...sortedEvents[0],
            eventId: `merged_${threadId}_${Date.now()}`,
            enterAt: sortedEvents[0].enterAt,
            leaveAt: sortedEvents[sortedEvents.length - 1].leaveAt,
            dwellMsEffective: sortedEvents.reduce((sum, e) => sum + (e.dwellMsEffective || 0), 0),
            maxScrollPct: Math.max(...sortedEvents.map(e => e.maxScrollPct || 0)),
            completed: sortedEvents.some(e => e.completed === 1) ? 1 : 0,
            updatedAt: new Date().toISOString()
          };
          
          mergedEvents.push(merged);
          duplicateCount.total += threadEvents.length - 1;
          duplicateCount.threads++;
          
          console.log(`[storage] Merged ${threadEvents.length} events for thread ${threadId}`);
        } else {
          mergedEvents.push(threadEvents[0]);
        }
      });
      
      // 清空并重新写入
      const clearRequest = store.clear();
      clearRequest.onsuccess = () => {
        let completed = 0;
        const total = mergedEvents.length;
        
        if (total === 0) {
          resolve({ success: true, duplicateCount });
          return;
        }
        
        mergedEvents.forEach(event => {
          const putRequest = store.put(event);
          putRequest.onsuccess = () => {
            completed++;
            if (completed === total) {
              console.log(`[storage] Deduplication complete: removed ${duplicateCount.total} duplicate events from ${duplicateCount.threads} threads`);
              resolve({ success: true, duplicateCount });
            }
          };
          putRequest.onerror = () => reject(putRequest.error);
        });
      };
      clearRequest.onerror = () => reject(clearRequest.error);
    };
    
    request.onerror = () => reject(request.error);
  });
}


// 分页查询函数
async function getEventsPaginated(offset = 0, limit = 100, filters = {}) {
  await ensureDb();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['read_events'], 'readonly');
    const store = transaction.objectStore('read_events');
    
    // 使用索引进行排序查询
    const index = store.index('createdAt');
    const request = index.openCursor(null, 'prev'); // 按时间倒序
    
    const results = [];
    let currentOffset = 0;
    let processedCount = 0;
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      
      if (!cursor) {
        // 查询完成
        resolve({
          events: results,
          total: processedCount,
          hasMore: false,
          nextOffset: null
        });
        return;
      }
      
      const eventData = cursor.value;
      
      // 应用过滤器
      let shouldInclude = true;
      if (filters.threadId && eventData.threadId !== filters.threadId) {
        shouldInclude = false;
      }
      if (filters.sessionId && eventData.sessionId !== filters.sessionId) {
        shouldInclude = false;
      }
      if (filters.completed !== undefined && eventData.completed !== filters.completed) {
        shouldInclude = false;
      }
      if (filters.startDate && new Date(eventData.createdAt) < new Date(filters.startDate)) {
        shouldInclude = false;
      }
      if (filters.endDate && new Date(eventData.createdAt) > new Date(filters.endDate)) {
        shouldInclude = false;
      }
      
      if (shouldInclude) {
        if (currentOffset >= offset && results.length < limit) {
          results.push(eventData);
        }
        currentOffset++;
      }
      
      processedCount++;
      
      // 如果已经获取足够的数据，停止查询
      if (results.length >= limit) {
        resolve({
          events: results,
          total: processedCount,
          hasMore: true,
          nextOffset: offset + limit
        });
        return;
      }
      
      cursor.continue();
    };
    
    request.onerror = () => reject(request.error);
  });
}

// 获取帖子分页查询
async function getThreadsPaginated(offset = 0, limit = 100, filters = {}) {
  await ensureDb();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['threads'], 'readonly');
    const store = transaction.objectStore('threads');
    
    // 根据过滤器选择索引
    let index, direction = 'prev';
    
    if (filters.forumId) {
      // 如果有论坛过滤，需要全表扫描（可以考虑添加复合索引）
      index = store;
    } else if (filters.isNew !== undefined) {
      index = store.index('isNew');
    } else if (filters.category) {
      index = store.index('category');
    } else {
      index = store.index('createdAt');
    }
    
    const request = index.openCursor(null, direction);
    const results = [];
    let currentOffset = 0;
    let processedCount = 0;
    
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      
      if (!cursor) {
        resolve({
          threads: results,
          total: processedCount,
          hasMore: false,
          nextOffset: null
        });
        return;
      }
      
      const thread = cursor.value;
      
      // 应用过滤器
      let shouldInclude = true;
      if (filters.forumId && thread.forumId !== filters.forumId) {
        shouldInclude = false;
      }
      if (filters.isNew !== undefined && thread.isNew !== filters.isNew) {
        shouldInclude = false;
      }
      if (filters.category && thread.category !== filters.category) {
        shouldInclude = false;
      }
      if (filters.startDate && new Date(thread.createdAt) < new Date(filters.startDate)) {
        shouldInclude = false;
      }
      if (filters.endDate && new Date(thread.createdAt) > new Date(filters.endDate)) {
        shouldInclude = false;
      }
      
      if (shouldInclude) {
        if (currentOffset >= offset && results.length < limit) {
          results.push(thread);
        }
        currentOffset++;
      }
      
      processedCount++;
      
      if (results.length >= limit) {
        resolve({
          threads: results,
          total: processedCount,
          hasMore: true,
          nextOffset: offset + limit
        });
        return;
      }
      
      cursor.continue();
    };
    
    request.onerror = () => reject(request.error);
  });
}

// 获取最近阅读事件（优化版本）
async function getRecentEventsPaginated(limit = 50, forum = 'all') {
  const filters = {};
  if (forum !== 'all') {
    // 需要先获取该论坛的帖子ID列表
    const forumThreads = await getThreadsPaginated(0, 10000, { forumId: forum });
    const threadIds = new Set(forumThreads.threads.map(t => t.threadId));
    
    // 由于IndexedDB限制，这里使用内存过滤
    // 在实际应用中，应该使用复合索引
    const allEvents = await getEventsPaginated(0, 1000);
    const filteredEvents = allEvents.events.filter(event => threadIds.has(event.threadId));
    
    return {
      events: filteredEvents.slice(0, limit),
      total: filteredEvents.length,
      hasMore: filteredEvents.length > limit,
      nextOffset: limit
    };
  }
  
  return await getEventsPaginated(0, limit, filters);
}

// 获取统计信息（优化版本，避免全表扫描）
async function getStatsOptimized() {
  await ensureDb();
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['read_events', 'threads', 'disliked_threads'], 'readonly');
    
    let completedCount = 0;
    const results = {
      totalEvents: 0,
      totalThreads: 0,
      newThreads: 0,
      todayEvents: 0,
      completedToday: 0,
      dislikedThreads: 0
    };
    
    // 统计阅读事件
    const eventsStore = transaction.objectStore('read_events');
    const eventsRequest = eventsStore.count();
    eventsRequest.onsuccess = () => {
      results.totalEvents = eventsRequest.result;
      completedCount++;
      if (completedCount === 3) resolve(results);
    };
    eventsRequest.onerror = () => reject(eventsRequest.error);
    
    // 统计帖子
    const threadsStore = transaction.objectStore('threads');
    const threadsRequest = threadsStore.count();
    threadsRequest.onsuccess = () => {
      results.totalThreads = threadsRequest.result;
      completedCount++;
      if (completedCount === 3) resolve(results);
    };
    threadsRequest.onerror = () => reject(threadsRequest.error);
    
    // 统计不感兴趣的帖子
    const dislikedStore = transaction.objectStore('disliked_threads');
    const dislikedRequest = dislikedStore.count();
    dislikedRequest.onsuccess = () => {
      results.dislikedThreads = dislikedRequest.result;
      completedCount++;
      if (completedCount === 3) resolve(results);
    };
    dislikedRequest.onerror = () => reject(dislikedRequest.error);
  });
}

export default {
  init,
  saveSession,
  upsertThread,
  updateReadEvent,
  finalizeReadEvent,
  getAllThreads,
  getNewThreads,
  getAllReadEvents,
  getAllSessions,
  addDislikedThread,
  getAllDislikedThreads,
  removeDislikedThread,
  importData,
  exportAllData,
  clearAllData,
  getStats,
  deduplicateReadEvents,
  getEventsPaginated,
  getThreadsPaginated,
  getRecentEventsPaginated,
  getStatsOptimized
};