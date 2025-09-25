(() => {
  const statsEl = document.getElementById('stats');
  const listEl = document.getElementById('list');
  const fetchStatusEl = document.getElementById('fetch-status');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnFetch = document.getElementById('btn-fetch');
  const forumSelector = document.getElementById('forum-selector');

  function renderList(items) {
    listEl.innerHTML = '';
    if (items.length === 0) {
      const li = document.createElement('li');
      li.textContent = '暂无推荐内容';
      li.style.color = '#666';
      listEl.appendChild(li);
      return;
    }
    
    items.forEach(it => {
      const li = document.createElement('li');
      li.style.marginBottom = '8px';
      li.style.padding = '8px';
      li.style.border = '1px solid #eee';
      li.style.borderRadius = '4px';
      
      // 创建内容容器
      const contentDiv = document.createElement('div');
      contentDiv.style.display = 'flex';
      contentDiv.style.justifyContent = 'space-between';
      contentDiv.style.alignItems = 'flex-start';
      contentDiv.style.gap = '8px';
      
      // 创建左侧内容区域
      const leftDiv = document.createElement('div');
      leftDiv.style.flex = '1';
      leftDiv.style.minWidth = '0'; // 允许内容收缩
      
      // 创建标题链接
      const a = document.createElement('a');
      a.href = it.url;
      a.textContent = it.title || it.url;
      a.target = '_blank';
      a.style.textDecoration = 'none';
      a.style.color = '#007cff';
      a.style.display = 'block';
      a.style.marginBottom = '4px';
      a.style.wordBreak = 'break-word'; // 长标题换行
      
      // 添加论坛来源标识
      const forumSpan = document.createElement('span');
      forumSpan.style.fontSize = '10px';
      forumSpan.style.color = '#666';
      forumSpan.style.backgroundColor = '#f0f0f0';
      forumSpan.style.padding = '2px 6px';
      forumSpan.style.borderRadius = '3px';
      forumSpan.style.marginLeft = '8px';
      
      if (it.forumId === 'linux.do') {
        forumSpan.textContent = 'Linux.do';
        forumSpan.style.backgroundColor = '#e3f2fd';
        forumSpan.style.color = '#1976d2';
      } else if (it.forumId === 'nodeseek.com') {
        forumSpan.textContent = 'NodeSeek';
        forumSpan.style.backgroundColor = '#f3e5f5';
        forumSpan.style.color = '#7b1fa2';
      } else {
        forumSpan.textContent = it.forumId || '未知';
      }
      
      a.appendChild(forumSpan);
      
      // 添加点击事件，点击后从推荐中移除
      a.addEventListener('click', (e) => {
        console.log('[popup] User clicked recommendation:', it.threadId, it.title);
        handleRecommendationClick(it.threadId, it.title, li);
      });
      
      // 添加版块和标签信息
      if (it.category || (it.tags && it.tags.length > 0)) {
        const meta = document.createElement('div');
        meta.style.fontSize = '12px';
        meta.style.color = '#666';
        meta.style.marginBottom = '6px';
        
        const parts = [];
        if (it.category) parts.push(`版块: ${it.category}`);
        if (it.tags && it.tags.length > 0) parts.push(`标签: ${it.tags.join(', ')}`);
        
        meta.textContent = parts.join(' | ');
        leftDiv.appendChild(a);
        leftDiv.appendChild(meta);
      } else {
        leftDiv.appendChild(a);
      }
      
      // 添加不感兴趣按钮
      const dislikeBtn = document.createElement('button');
      dislikeBtn.textContent = '👎';
      dislikeBtn.title = '不感兴趣'; // 添加提示文字
      dislikeBtn.style.fontSize = '12px';
      dislikeBtn.style.padding = '2px 6px';
      dislikeBtn.style.backgroundColor = '#f8f9fa';
      dislikeBtn.style.border = '1px solid #dee2e6';
      dislikeBtn.style.borderRadius = '3px';
      dislikeBtn.style.cursor = 'pointer';
      dislikeBtn.style.color = '#6c757d';
      dislikeBtn.style.minWidth = '24px';
      dislikeBtn.style.height = '20px';
      dislikeBtn.style.display = 'inline-flex';
      dislikeBtn.style.alignItems = 'center';
      dislikeBtn.style.justifyContent = 'center';
      dislikeBtn.style.flexShrink = '0'; // 防止按钮被压缩
      dislikeBtn.dataset.threadId = it.threadId;
      dislikeBtn.dataset.title = it.title;
      
      // 添加点击事件
      dislikeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handleDislikeClick(it.threadId, it.title, dislikeBtn);
      });
      
      // 组装布局
      contentDiv.appendChild(leftDiv);
      contentDiv.appendChild(dislikeBtn);
      li.appendChild(contentDiv);
      listEl.appendChild(li);
    });
  }

  async function loadStats() {
    try {
      // 获取阅读统计
      const events = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'db/export' }, (resp) => {
          if (resp && resp.ok) {
            resolve(resp.bytes ? JSON.parse(new TextDecoder().decode(new Uint8Array(resp.bytes))).events : []);
          } else {
            resolve([]);
          }
        });
      });
      
      const today = new Date().toDateString();
      const todayEvents = events.filter(e => new Date(e.createdAt).toDateString() === today);
      const completedToday = todayEvents.filter(e => e.completed === 1).length;
      
      statsEl.textContent = `今日阅读: ${todayEvents.length} 篇，完成: ${completedToday} 篇`;
      
      // 获取抓取状态
      const threads = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'db/export' }, (resp) => {
          if (resp && resp.ok) {
            const data = JSON.parse(new TextDecoder().decode(new Uint8Array(resp.bytes)));
            resolve(data.threads || []);
          } else {
            resolve([]);
          }
        });
      });
      
      const newThreads = threads.filter(t => t.isNew);
      fetchStatusEl.textContent = `本地帖子: ${threads.length} 个，新帖子: ${newThreads.length} 个`;
      
      // 显示推荐内容
      loadRecommendations();
      
    } catch (e) {
      statsEl.textContent = '加载统计失败';
      fetchStatusEl.textContent = '';
    }
  }

  function refresh() {
    statsEl.textContent = '刷新中...';
    loadStats();
    loadRecommendations();
  }

  function triggerFetch() {
    btnFetch.textContent = '抓取中...';
    btnFetch.disabled = true;
    
    chrome.runtime.sendMessage({ 
      type: 'fetch/trigger'
    }, (resp) => {
      btnFetch.textContent = '抓取所有论坛';
      btnFetch.disabled = false;
      
      if (resp && resp.ok && resp.result) {
        const result = resp.result;
        if (result.success) {
          // 显示详细的抓取结果
          let statusText = `抓取完成: ${result.summary.successfulForums}/${result.summary.totalForums} 个论坛成功，共发现 ${result.summary.totalNewTopics} 个新帖子`;
          
          // 添加各论坛的详细结果
          if (result.results && result.results.length > 0) {
            const forumResults = result.results.map(r => {
              const forumName = r.forum === 'linux.do' ? 'Linux.do' : r.forum === 'nodeseek.com' ? 'NodeSeek' : r.forum;
              const status = r.success ? `✅ ${r.newTopics || 0}个` : `❌ 失败`;
              return `${forumName}: ${status}`;
            }).join(', ');
            statusText += `\n详情: ${forumResults}`;
          }
          
          fetchStatusEl.textContent = statusText;
          fetchStatusEl.style.color = '#28a745';
          fetchStatusEl.style.whiteSpace = 'pre-line'; // 支持换行
          // 刷新显示
          setTimeout(loadStats, 1000);
        } else {
          fetchStatusEl.textContent = `抓取失败: ${result.error || '未知错误'}`;
          fetchStatusEl.style.color = '#dc3545';
        }
      } else {
        fetchStatusEl.textContent = '抓取失败: 后台无响应';
        fetchStatusEl.style.color = '#dc3545';
      }
    });
  }

  // 处理推荐点击
  function handleRecommendationClick(threadId, title, listItem) {
    console.log('[popup] Removing clicked recommendation:', threadId, title);
    
    // 发送消息到后台，标记该帖子为已点击
    chrome.runtime.sendMessage({ 
      type: 'recommend/clicked', 
      threadId: threadId,
      title: title
    }, (response) => {
      if (response && response.ok) {
        console.log('[popup] Successfully marked recommendation as clicked');
      } else {
        console.error('[popup] Failed to mark recommendation as clicked:', response);
      }
    });
    
    // 立即从UI中移除该推荐项
    if (listItem && listItem.parentNode) {
      listItem.style.opacity = '0.5';
      listItem.style.transition = 'opacity 0.3s ease';
      
      setTimeout(() => {
        if (listItem.parentNode) {
          listItem.parentNode.removeChild(listItem);
        }
        
        // 检查是否还有推荐项
        const remainingItems = listEl.querySelectorAll('li');
        if (remainingItems.length === 0) {
          const li = document.createElement('li');
          li.textContent = '暂无推荐内容';
          li.style.color = '#666';
          listEl.appendChild(li);
        }
      }, 300);
    }
  }

  // 处理不感兴趣按钮点击
  function handleDislikeClick(threadId, title, button) {
    // 更新按钮状态
    button.textContent = '已标记';
    button.disabled = true;
    button.style.backgroundColor = '#e9ecef';
    button.style.color = '#6c757d';
    
    // 发送消息到background
    chrome.runtime.sendMessage({ 
      type: 'dislike/add', 
      threadId: threadId,
      title: title 
    }, (resp) => {
      if (resp && resp.ok) {
        // 成功标记后，从列表中移除该项目
        const listItem = button.closest('li');
        if (listItem) {
          listItem.style.opacity = '0.5';
          listItem.style.textDecoration = 'line-through';
          setTimeout(() => {
            listItem.remove();
            // 如果列表为空，显示提示
            if (listEl.children.length === 0) {
              const li = document.createElement('li');
              li.textContent = '暂无更多推荐内容';
              li.style.color = '#666';
              listEl.appendChild(li);
            }
          }, 1000);
        }
      } else {
        // 失败时恢复按钮状态
        button.textContent = '👎 不感兴趣';
        button.disabled = false;
        button.style.backgroundColor = '#f8f9fa';
        button.style.color = '#6c757d';
        alert('标记失败，请重试');
      }
    });
  }

  // 加载推荐内容
  function loadRecommendations() {
    const selectedForum = forumSelector.value;
    console.log('[popup] Loading recommendations for forum:', selectedForum);
    
    chrome.runtime.sendMessage({ 
      type: 'recommend/mixed', 
      limit: 5,
      forum: selectedForum
    }, (resp) => {
      if (resp && resp.ok && resp.recommendations) {
        renderList(resp.recommendations);
      } else {
        // 如果推荐失败，显示新帖子作为备选
        chrome.runtime.sendMessage({ type: 'db/export' }, (exportResp) => {
          if (exportResp && exportResp.ok) {
            const data = JSON.parse(new TextDecoder().decode(new Uint8Array(exportResp.bytes)));
            let newThreads = (data.threads || []).filter(t => t.isNew);
            
            // 根据选择的论坛过滤
            if (selectedForum !== 'all') {
              newThreads = newThreads.filter(t => t.forumId === selectedForum);
            }
            renderList(newThreads.slice(0, 5));
          } else {
            renderList([]);
          }
        });
      }
    });
  }

  btnRefresh.addEventListener('click', refresh);
  btnFetch.addEventListener('click', triggerFetch);
  
  // 论坛选择器变化时重新加载推荐
  forumSelector.addEventListener('change', () => {
    console.log('[popup] Forum selector changed to:', forumSelector.value);
    loadRecommendations();
  });
  
  // 检查是否有新帖子，如果有则自动刷新推荐
  function checkForNewContent(retryCount = 0) {
    console.log(`[popup] Attempting to connect to background script (attempt ${retryCount + 1})`);
    
    // 检查chrome.runtime是否可用
    if (typeof chrome === 'undefined' || !chrome.runtime) {
      console.error('[popup] Chrome runtime not available');
      statsEl.textContent = 'Chrome runtime 不可用。';
      listEl.innerHTML = '<li>请确保在扩展环境中运行。</li>';
      return;
    }
    
    chrome.runtime.sendMessage({ type: 'fetch/stats' }, (resp) => {
      console.log('[popup] Received response:', resp);
      
      if (chrome.runtime.lastError) {
        console.error('[popup] Chrome runtime error:', chrome.runtime.lastError);
        if (chrome.runtime.lastError.message.includes('Receiving end does not exist') && retryCount < 3) {
          console.warn(`[popup] Connection failed. Retrying... (${retryCount + 1})`);
          setTimeout(() => checkForNewContent(retryCount + 1), 300);
        } else {
          console.error('[popup] Could not establish connection with background script.', chrome.runtime.lastError);
          statsEl.textContent = '无法连接到后台服务。';
          listEl.innerHTML = '<li>请尝试重新打开弹窗。</li>';
        }
        return;
      }

      if (resp && resp.ok && resp.stats) {
        const stats = resp.stats;
        const now = Date.now();
        const timeSinceLastFetch = stats.timeSinceLastFetch || 0;
        const timeSinceLastSuccess = stats.timeSinceLastSuccess || 0;
        
        // 如果最近5分钟内有成功的抓取，自动刷新推荐
        if (timeSinceLastSuccess < 5 * 60 * 1000 && timeSinceLastSuccess > 0) {
          console.log('[popup] Recent fetch detected, auto-refreshing recommendations');
          refresh();
        } else {
          // 否则正常加载
          loadStats();
        }
      } else {
        // 如果无法获取抓取统计，正常加载
        loadStats();
      }
    });
  }
  
  // 初始加载
  checkForNewContent();
})();



