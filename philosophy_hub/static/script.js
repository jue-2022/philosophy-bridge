const API_BASE = "http://localhost:3000/api";
let currentDisplayLang = "zh";  // 默认显示中文

// 辅助：调用翻译API
async function translateText(text, targetLang, sourceLang = "auto") {
    try {
        const resp = await fetch(`${API_BASE}/translate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, target_lang: targetLang, source_lang: sourceLang })
        });
        const data = await resp.json();
        return data.translated || text;
    } catch (err) {
        console.error(err);
        return `[翻译失败] ${text}`;
    }
}

// 解析哲学术语（模态框）
async function showConcepts(text) {
    const modal = document.getElementById("conceptModal");
    const resultDiv = document.getElementById("conceptResult");
    modal.style.display = "block";
    resultDiv.innerHTML = "🤔 正在解析哲学概念，请稍候...";
    try {
        const resp = await fetch(`${API_BASE}/concepts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text })
        });
        const concepts = await resp.json();
        if (concepts.length === 0) {
            resultDiv.innerHTML = "未检测到明显的哲学术语。";
        } else {
            let html = `<ul style="list-style:none; padding-left:0;">`;
            for (let c of concepts) {
                html += `<li style="margin-bottom: 20px;"><strong>${c.term}</strong><br>
                         📖 ${c.definition}<br>
                         🔁 跨文化对比：${c.counterpart}<br>
                         ⚡ 核心差异：${c.difference}</li>`;
            }
            html += `</ul>`;
            resultDiv.innerHTML = html;
        }
    } catch (e) {
        resultDiv.innerHTML = "解析失败，请重试。";
    }
}

// 渲染单个帖子（包含回复）
async function renderPost(post) {
    const container = document.createElement("div");
    container.className = "post-card";
    
    // 翻译标题和内容
    const translatedTitle = await translateText(post.title, currentDisplayLang, post.lang);
    const translatedContent = await translateText(post.content, currentDisplayLang, post.lang);
    
    container.innerHTML = `
        <h3 class="post-title">${escapeHtml(translatedTitle)}</h3>
        <div class="post-meta">
            <span>🗣️ 原文: ${post.lang}</span>
            <span>🕒 ${new Date(post.timestamp).toLocaleString()}</span>
        </div>
        <div class="post-content">${escapeHtml(translatedContent)}</div>
        <div>
            <button class="concept-btn" data-text="${escapeHtml(post.content)}">🔍 解析哲学术语</button>
            <button class="reply-toggle-btn" data-id="${post.id}">💬 回复</button>
        </div>
        <div id="replies-${post.id}" style="margin-top:15px;">
            ${post.replies ? await renderReplies(post.replies) : ""}
        </div>
        <div id="reply-form-${post.id}" style="display:none;" class="reply-form">
            <textarea id="reply-content-${post.id}" rows="2" placeholder="写下你的回应... (母语)"></textarea>
            <select id="reply-lang-${post.id}">
                <option value="zh">中文</option><option value="en">English</option>
                <option value="de">Deutsch</option><option value="ja">日本語</option><option value="ar">العربية</option>
            </select>
            <button class="submit-reply" data-id="${post.id}">发送回复</button>
        </div>
    `;
    
    // 绑定概念解析按钮
    const conceptBtn = container.querySelector(".concept-btn");
    conceptBtn.addEventListener("click", () => {
        const originalText = conceptBtn.getAttribute("data-text");
        showConcepts(originalText);
    });
    
    // 回复按钮显示/隐藏表单
    const toggleBtn = container.querySelector(".reply-toggle-btn");
    const replyFormDiv = container.querySelector(`#reply-form-${post.id}`);
    toggleBtn.addEventListener("click", () => {
        replyFormDiv.style.display = replyFormDiv.style.display === "none" ? "block" : "none";
    });
    
    // 提交回复
    const submitBtn = container.querySelector(".submit-reply");
    submitBtn.addEventListener("click", async () => {
        const content = document.getElementById(`reply-content-${post.id}`).value;
        const lang = document.getElementById(`reply-lang-${post.id}`).value;
        if (!content.trim()) return;
        await fetch(`${API_BASE}/posts/${post.id}/replies`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content, lang })
        });
        loadPosts();  // 刷新
    });
    
    return container;
}

// 渲染回复列表（递归简单）
async function renderReplies(replies, level = 0) {
    if (!replies.length) return "";
    let html = `<div style="margin-left: ${level * 20}px; border-left: 2px solid #ddd; padding-left: 12px;">`;
    for (let r of replies) {
        const translated = await translateText(r.content, currentDisplayLang, r.lang);
        html += `
            <div class="reply-item">
                <div>${escapeHtml(translated)}</div>
                <div class="post-meta" style="font-size:0.7rem;">🗣️ ${r.lang} · ${new Date(r.timestamp).toLocaleString()}</div>
                <button class="concept-small" data-text="${escapeHtml(r.content)}" style="font-size:0.7rem;">🔎 解析</button>
            </div>
        `;
    }
    html += `</div>`;
    // 懒绑定小按钮概念解析（之后整体绑定）
    return html;
}

// 加载所有帖子
async function loadPosts() {
    const container = document.getElementById("postsContainer");
    container.innerHTML = '<div class="loading">更新对话中...</div>';
    try {
        const resp = await fetch(`${API_BASE}/posts`);
        const posts = await resp.json();
        container.innerHTML = "";
        if (posts.length === 0) {
            container.innerHTML = "<p>✨ 还没有哲学论题，成为第一个思辨者吧！</p>";
            return;
        }
        for (let post of posts) {
            const postElem = await renderPost(post);
            container.appendChild(postElem);
        }
        // 绑定所有动态生成的小概念按钮
        document.querySelectorAll(".concept-small").forEach(btn => {
            btn.addEventListener("click", () => {
                const text = btn.getAttribute("data-text");
                showConcepts(text);
            });
        });
    } catch (err) {
        container.innerHTML = "<p>❌ 无法连接服务器，请确保后端已运行 (python app.py)</p>";
    }
}

// 发布新帖子
async function submitPost() {
    const title = document.getElementById("postTitle").value;
    const content = document.getElementById("postContent").value;
    const lang = document.getElementById("postLang").value;
    if (!title.trim() || !content.trim()) return alert("请填写标题和内容");
    await fetch(`${API_BASE}/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, lang })
    });
    document.getElementById("postTitle").value = "";
    document.getElementById("postContent").value = "";
    loadPosts();
}

// 简单防XSS
function escapeHtml(str) {
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// 监听显示语言变化
document.getElementById("displayLang")?.addEventListener("change", (e) => {
    currentDisplayLang = e.target.value;
    loadPosts();
});
document.getElementById("submitPost")?.addEventListener("click", submitPost);

// 模态框关闭
document.querySelector(".close")?.addEventListener("click", () => {
    document.getElementById("conceptModal").style.display = "none";
});
window.onclick = function(e) {
    const modal = document.getElementById("conceptModal");
    if (e.target === modal) modal.style.display = "none";
};

// 启动
loadPosts();