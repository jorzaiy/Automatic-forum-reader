(() => {
  // DOM 元素
  const elSec = document.getElementById('threshold-seconds');
  const elScroll = document.getElementById('threshold-scroll');
  const elSaved = document.getElementById('saved');
  const btnSave = document.getElementById('btn-save');
  const btnExport = document.getElementById('btn-export');
  const btnExportReading = document.getElementById('btn-export-reading');
  const btnExportFetch = document.getElementById('btn-export-fetch');
  const btnImport = document.getElementById('btn-import');
  const btnImportReading = document.getElementById('btn-import-reading');
  const btnImportFetch = document.getElementById('btn-import-fetch');
  const fileImport = document.getElementById('file-import');
  const btnClear = document.getElementById('btn-clear');
  const btnClearReading = document.getElementById('btn-clear-reading');
  const btnClearFetch = document.getElementById('btn-clear-fetch');
  const btnFetch = document.getElementById('btn-fetch');
  const btnRefreshStats = document.getElementById('btn-refresh-stats');
  const clearStatus = document.getElementById('clear-status');
  const fetchStatus = document.getElementById('fetch-status');
  
  // 导入类型跟踪
  let importType = 'all'; // 'all', 'reading', 'fetch'
  
  // 统计元素
  const totalEvents = document.getElementById('total-events');
  const totalThreads = document.getElementById('total-threads');
  const newThreads = document.getElementById('new-threads');
  const completedToday = document.getElementById('completed-today');
  const fetchCount = document.getElementById('fetch-count');
  const lastFetch = document.getElementById('last-fetch');

  // 加载设置
  function loadSettings() {
    chrome.storage.local.get(['thresholdSeconds', 'thresholdScroll'], (res) => {
      if (typeof res.thresholdSeconds === 'number') elSec.value = String(res.thresholdSeconds);
      if (typeof res.thresholdScroll === 'number') elScroll.value = String(res.thresholdScroll);
    });
  }

  // 保存设置
  function saveSettings() {
    const thresholdSeconds = Number(elSec.value || 20);
    const thresholdScroll = Number(elScroll.value || 50);
    chrome.storage.local.set({ thresholdSeconds, thresholdScroll }, () => {
      elSaved.style.display = 'block';
      setTimeout(() => { elSaved.style.display = 'none'; }, 1200);
    });
  }

  // 加载统计信息
  function loadStats() {
    // 加载数据库统计
    chrome.runtime.sendMessage({ type: 'db/export' }, (resp) => {
      try {
        if (resp && resp.ok && resp.bytes) {
          const data = JSON.parse(new TextDecoder().decode(new Uint8Array(resp.bytes)));
          
          const events = data.events || [];
          const threads = data.threads || [];
          const newThreadsList = threads.filter(t => t.isNew);
          
          const today = new Date().toDateString();
          const todayEvents = events.filter(e => new Date(e.createdAt).toDateString() === today);
          const completedTodayCount = todayEvents.filter(e => e.completed === 1).length;
          
          totalEvents.textContent = events.length;
          totalThreads.textContent = threads.length;
          newThreads.textContent = newThreadsList.length;
          completedToday.textContent = completedTodayCount;
        } else {
          totalEvents.textContent = '0';
          totalThreads.textContent = '0';
          newThreads.textContent = '0';
          completedToday.textContent = '0';
        }
      } catch (e) {
        console.error('Failed to load stats:', e);
        totalEvents.textContent = '-';
        totalThreads.textContent = '-';
        newThreads.textContent = '-';
        completedToday.textContent = '-';
      }
    });
    
    // 加载抓取统计
    chrome.runtime.sendMessage({ type: 'fetch/stats' }, (resp) => {
      try {
        if (resp && resp.ok && resp.stats) {
          const stats = resp.stats;
          fetchCount.textContent = stats.fetchCount || 0;
          
          if (stats.lastFetchAt) {
            const lastFetchTime = new Date(stats.lastFetchAt);
            const now = new Date();
            const diffMs = now - lastFetchTime;
            const diffMins = Math.floor(diffMs / (1000 * 60));
            
            if (diffMins < 1) {
              lastFetch.textContent = '刚刚';
            } else if (diffMins < 60) {
              lastFetch.textContent = `${diffMins}分钟前`;
            } else {
              const diffHours = Math.floor(diffMins / 60);
              lastFetch.textContent = `${diffHours}小时前`;
            }
          } else {
            lastFetch.textContent = '从未';
          }
        } else {
          fetchCount.textContent = '-';
          lastFetch.textContent = '-';
        }
      } catch (e) {
        console.error('Failed to load fetch stats:', e);
        fetchCount.textContent = '-';
        lastFetch.textContent = '-';
      }
    });
  }

  // 显示状态消息
  function showStatus(element, message, type = 'success') {
    element.textContent = message;
    element.className = `status ${type}`;
    element.style.display = 'block';
    setTimeout(() => { element.style.display = 'none'; }, 3000);
  }
  
  // 显示导入进度
  function showImportProgress(message) {
    const progressEl = document.getElementById('import-progress');
    progressEl.textContent = message;
    progressEl.className = 'status info';
    progressEl.style.display = 'block';
    
    // 隐藏结果
    const resultEl = document.getElementById('import-result');
    resultEl.style.display = 'none';
  }
  
  // 显示导入结果
  function showImportResult(message, type) {
    const progressEl = document.getElementById('import-progress');
    progressEl.style.display = 'none';
    
    const resultEl = document.getElementById('import-result');
    resultEl.textContent = message;
    resultEl.className = `status ${type}`;
    resultEl.style.display = 'block';
    
    // 8秒后自动隐藏
    setTimeout(() => { 
      resultEl.style.display = 'none'; 
    }, 8000);
  }

  // 导出全部数据
  btnExport.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'db/export' }, (resp) => {
      try {
        if (!resp || !resp.ok) {
          showStatus(clearStatus, '导出失败：' + (resp && resp.error ? resp.error : '后台无响应'), 'error');
          return;
        }
        const bytes = resp.bytes ? Uint8Array.from(resp.bytes) : null;
        if (!bytes || bytes.length === 0) {
          showStatus(clearStatus, '数据库为空或尚未创建，请先在帖子页停留几秒再试。', 'error');
          return;
        }
        const blob = new Blob([bytes], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `linuxdo-all-data-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showStatus(clearStatus, '全部数据导出成功！', 'success');
      } catch (e) {
        showStatus(clearStatus, '导出异常：' + String(e), 'error');
      }
    });
  });

  // 导出阅读数据
  btnExportReading.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'db/export-reading' }, (resp) => {
      try {
        if (!resp || !resp.ok) {
          showStatus(clearStatus, '导出失败：' + (resp && resp.error ? resp.error : '后台无响应'), 'error');
          return;
        }
        const bytes = resp.bytes ? Uint8Array.from(resp.bytes) : null;
        if (!bytes || bytes.length === 0) {
          showStatus(clearStatus, '阅读数据为空，请先在帖子页停留几秒再试。', 'error');
          return;
        }
        const blob = new Blob([bytes], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `linuxdo-reading-data-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showStatus(clearStatus, '阅读数据导出成功！', 'success');
      } catch (e) {
        showStatus(clearStatus, '导出异常：' + String(e), 'error');
      }
    });
  });

  // 导出抓取数据
  btnExportFetch.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'db/export-fetch' }, (resp) => {
      try {
        if (!resp || !resp.ok) {
          showStatus(clearStatus, '导出失败：' + (resp && resp.error ? resp.error : '后台无响应'), 'error');
          return;
        }
        const bytes = resp.bytes ? Uint8Array.from(resp.bytes) : null;
        if (!bytes || bytes.length === 0) {
          showStatus(clearStatus, '抓取数据为空，请先手动抓取一些帖子。', 'error');
          return;
        }
        const blob = new Blob([bytes], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `linuxdo-fetch-data-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showStatus(clearStatus, '抓取数据导出成功！', 'success');
      } catch (e) {
        showStatus(clearStatus, '导出异常：' + String(e), 'error');
      }
    });
  });

  // 导入全部数据
  btnImport.addEventListener('click', () => {
    importType = 'all';
    fileImport.click();
  });

  // 导入阅读数据
  btnImportReading.addEventListener('click', () => {
    importType = 'reading';
    fileImport.click();
  });

  // 导入抓取数据
  btnImportFetch.addEventListener('click', () => {
    importType = 'fetch';
    fileImport.click();
  });
  
  fileImport.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    if (file.type !== 'application/json') {
      showStatus(clearStatus, '请选择JSON格式的文件', 'error');
      fileImport.value = '';
      return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importData = JSON.parse(e.target.result);
        
        // 根据导入类型过滤数据
        let filteredData = importData;
        if (importType === 'reading') {
          // 只导入阅读相关数据
          filteredData = {
            events: importData.events || [],
            sessions: importData.sessions || [],
            dislikedThreads: importData.dislikedThreads || []
          };
          if (!filteredData.events.length && !filteredData.dislikedThreads.length) {
            showStatus(clearStatus, '无效的阅读数据格式：缺少阅读记录或偏好数据', 'error');
            fileImport.value = '';
            return;
          }
        } else if (importType === 'fetch') {
          // 只导入抓取数据
          filteredData = {
            threads: importData.threads || []
          };
          if (!filteredData.threads.length) {
            showStatus(clearStatus, '无效的抓取数据格式：缺少帖子数据', 'error');
            fileImport.value = '';
            return;
          }
        } else {
          // 导入全部数据，验证格式
          if (!importData.events && !importData.dislikedThreads && !importData.threads) {
            showStatus(clearStatus, '无效的数据格式：缺少任何有效数据', 'error');
            fileImport.value = '';
            return;
          }
        }
        
        // 显示导入进度
        const importTypeText = importType === 'reading' ? '阅读数据' : importType === 'fetch' ? '抓取数据' : '全部数据';
        showImportProgress(`正在导入${importTypeText}...`);
        
        // 发送导入请求
        chrome.runtime.sendMessage({ 
          type: 'db/import', 
          data: filteredData,
          importType: importType
        }, (resp) => {
          if (resp && resp.ok && resp.result) {
            const result = resp.result;
            if (result.success) {
              let message = `导入完成！\n`;
              message += `✅ 成功导入：${result.importedCount} 条记录\n`;
              if (result.skippedCount > 0) {
                message += `⏭️ 跳过重复：${result.skippedCount} 条记录\n`;
              }
              if (result.errors && result.errors.length > 0) {
                message += `⚠️ 错误：${result.errors.length} 条记录\n`;
              }
              showImportResult(message, 'success');
              loadStats(); // 刷新统计
            } else {
              showImportResult(`导入失败：${result.error}`, 'error');
            }
          } else {
            showImportResult('导入失败：无法连接到扩展', 'error');
          }
          fileImport.value = '';
        });
        
      } catch (error) {
        showStatus(clearStatus, `文件解析失败：${error.message}`, 'error');
        fileImport.value = '';
      }
    };
    
    reader.onerror = () => {
      showStatus(clearStatus, '文件读取失败', 'error');
      fileImport.value = '';
    };
    
    reader.readAsText(file);
  });

  // 清空阅读数据
  btnClearReading.addEventListener('click', () => {
    if (confirm('确定要清空阅读数据吗？\n\n这将删除：\n- 所有阅读记录\n- 所有会话信息\n- 所有不感兴趣标记\n\n保留：\n- 所有帖子数据')) {
      chrome.runtime.sendMessage({ type: 'db/clear-reading' }, (resp) => {
        if (resp && resp.ok) {
          showStatus(clearStatus, '阅读数据已清空', 'success');
          loadStats(); // 刷新统计
        } else {
          showStatus(clearStatus, '清空失败：' + (resp && resp.error ? resp.error : '未知错误'), 'error');
        }
      });
    }
  });

  // 清空抓取数据
  btnClearFetch.addEventListener('click', () => {
    if (confirm('确定要清空抓取数据吗？\n\n这将删除：\n- 所有帖子数据\n\n保留：\n- 所有阅读记录\n- 所有会话信息\n- 所有不感兴趣标记')) {
      chrome.runtime.sendMessage({ type: 'db/clear-fetch' }, (resp) => {
        if (resp && resp.ok) {
          showStatus(clearStatus, '抓取数据已清空', 'success');
          loadStats(); // 刷新统计
        } else {
          showStatus(clearStatus, '清空失败：' + (resp && resp.error ? resp.error : '未知错误'), 'error');
        }
      });
    }
  });

  // 清空所有数据
  btnClear.addEventListener('click', () => {
    if (confirm('确定要清空所有数据吗？此操作不可撤销！\n\n这将删除：\n- 所有阅读记录\n- 所有帖子数据\n- 所有会话信息')) {
      chrome.runtime.sendMessage({ type: 'db/clear' }, (resp) => {
        if (resp && resp.ok) {
          showStatus(clearStatus, '数据已清空', 'success');
          loadStats(); // 刷新统计
        } else {
          showStatus(clearStatus, '清空失败：' + (resp && resp.error ? resp.error : '未知错误'), 'error');
        }
      });
    }
  });

  // 手动抓取
  btnFetch.addEventListener('click', () => {
    btnFetch.textContent = '抓取中...';
    btnFetch.disabled = true;
    
    chrome.runtime.sendMessage({ type: 'fetch/trigger' }, (resp) => {
      btnFetch.textContent = '🚀 立即抓取新内容';
      btnFetch.disabled = false;
      
      if (resp && resp.ok && resp.result) {
        const result = resp.result;
        if (result.success) {
          showStatus(fetchStatus, `抓取完成：发现 ${result.newTopics} 个新帖子`, 'success');
          loadStats(); // 刷新统计
        } else {
          showStatus(fetchStatus, `抓取失败：${result.reason}`, 'error');
        }
      } else {
        showStatus(fetchStatus, '抓取失败：后台无响应', 'error');
      }
    });
  });

  // 刷新统计
  btnRefreshStats.addEventListener('click', () => {
    loadStats();
  });

  // 保存设置
  btnSave.addEventListener('click', saveSettings);

  // 初始化
  loadSettings();
  loadStats();
})();


