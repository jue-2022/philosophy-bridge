import os
import json
import requests
import sqlite3
from contextlib import closing
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()
import os
app = Flask(__name__, static_folder=os.path.join(os.path.dirname(__file__), 'static'), static_url_path='/static')
CORS(app)

# 智谱API配置
ZHIPU_API_KEY = "d2297ace43dc472182a15ab41ecbe132.GIqxyNU2tXMZtBDa"
ZHIPU_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"

# 数据库配置
DB_FILE = 'philosophy.db'

def init_db():
    """初始化数据库，创建表结构"""
    with closing(sqlite3.connect(DB_FILE)) as conn:
        conn.execute('''
            CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                lang TEXT NOT NULL,
                timestamp TEXT NOT NULL
            )
        ''')
        conn.execute('''
            CREATE TABLE IF NOT EXISTS replies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER NOT NULL,
                content TEXT NOT NULL,
                lang TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                FOREIGN KEY (post_id) REFERENCES posts (id)
            )
        ''')
        conn.commit()

def get_all_posts():
    """从数据库获取所有帖子（包含回复）"""
    with closing(sqlite3.connect(DB_FILE)) as conn:
        conn.row_factory = sqlite3.Row
        posts = conn.execute('SELECT * FROM posts ORDER BY id').fetchall()
        result = []
        for post in posts:
            replies = conn.execute('SELECT * FROM replies WHERE post_id = ?', (post['id'],)).fetchall()
            result.append({
                'id': post['id'],
                'title': post['title'],
                'content': post['content'],
                'lang': post['lang'],
                'timestamp': post['timestamp'],
                'replies': [dict(r) for r in replies]
            })
        return result

def create_post_db(title, content, lang, timestamp):
    """向数据库插入新帖子"""
    with closing(sqlite3.connect(DB_FILE)) as conn:
        cur = conn.execute(
            'INSERT INTO posts (title, content, lang, timestamp) VALUES (?,?,?,?)',
            (title, content, lang, timestamp)
        )
        conn.commit()
        return cur.lastrowid

def add_reply_db(post_id, content, lang, timestamp):
    """向数据库插入新回复"""
    with closing(sqlite3.connect(DB_FILE)) as conn:
        conn.execute(
            'INSERT INTO replies (post_id, content, lang, timestamp) VALUES (?,?,?,?)',
            (post_id, content, lang, timestamp)
        )
        conn.commit()

# 语言代码映射（用于界面显示）
LANG_NAMES = {
    "zh": "中文",
    "en": "English",
    "de": "Deutsch",
    "ja": "日本語",
    "ar": "العربية"
}

def call_gpt(prompt, system="You are a helpful assistant for philosophical dialogue."):
    """调用 智谱API，带重试一次"""
    try:
        headers = {
            "Content-Type": "application/json",
            "Authorization": ZHIPU_API_KEY
        }
        payload = {
            "model": "glm-4-flash",
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.3,
            "max_tokens": 500
        }
        response = requests.post(ZHIPU_API_URL, headers=headers, json=payload, timeout=10)
        if response.status_code == 200:
            data = response.json()
            return data["choices"][0]["message"]["content"].strip()
        else:
            return f"[翻译错误] HTTP {response.status_code}: {response.text[:100]}"
    except Exception as e:
        return f"[翻译错误] {str(e)}"

@app.route('/api/posts', methods=['GET'])
def get_posts():
    return jsonify(get_all_posts())

@app.route('/api/posts', methods=['POST'])
def create_post():
    data = request.json
    new_id = create_post_db(
        title=data['title'],
        content=data['content'],
        lang=data['lang'],
        timestamp=datetime.now().isoformat()
    )
    # 返回新创建的帖子信息
    return jsonify({"id": new_id, "message": "Post created"}), 201

@app.route('/api/posts/<int:post_id>/replies', methods=['POST'])
def add_reply(post_id):
    data = request.json
    # 先检查帖子是否存在
    with closing(sqlite3.connect(DB_FILE)) as conn:
        post_exists = conn.execute('SELECT 1 FROM posts WHERE id = ?', (post_id,)).fetchone()
        if not post_exists:
            return jsonify({"error": "Post not found"}), 404
    
    add_reply_db(
        post_id=post_id,
        content=data['content'],
        lang=data['lang'],
        timestamp=datetime.now().isoformat()
    )
    return jsonify({"message": "Reply added"}), 201

@app.route('/api/translate', methods=['POST'])
def translate():
    """将文本从源语言翻译到目标语言，保留哲学原词"""
    data = request.json
    text = data['text']
    target_lang = data['target_lang']
    source_lang = data.get('source_lang', 'auto')
    
    prompt = f"""请将以下哲学文本从{source_lang}翻译成{target_lang}。
要求：
1. 保留所有哲学术语的原词（例如 'Dasein', 'Atman', '仁'），并在括号中给出意译。
2. 保持论证的逻辑结构。
3. 不要添加任何解释。

文本：{text}
"""
    translated = call_gpt(prompt)
    return jsonify({"translated": translated})

@app.route('/api/concepts', methods=['POST'])
def extract_concepts():
    """从文本中提取哲学术语，并提供跨文化视角"""
    text = request.json['text']
    prompt = f"""分析以下哲学文本，提取其中出现的核心哲学术语（最多5个）。
对于每个术语：
- 给出该术语在原文传统中的简要定义（50字内）。
- 给出一个其他哲学传统中可对比的概念（例如'仁' ↔ 'Agape' 或 'Virtue'），并说明核心差异点。

文本：{text}

请以JSON格式返回，结构如下：
[
  {{"term": "术语1", "definition": "...", "counterpart": "...", "difference": "..."}},
  ...
]
只输出JSON，不要其他文字。"""
    
    try:
        resp = call_gpt(prompt, system="You are a comparative philosophy expert. Output valid JSON only.")
        # 清理可能的 markdown 标记
        resp = resp.strip().strip('```json').strip('```')
        concepts = json.loads(resp)
        return jsonify(concepts)
    except:
        return jsonify([])

import webbrowser
import os

if __name__ == '__main__':
    init_db()  # 确保数据库已初始化
    # 自动打开前端页面，避免在debug模式下重复打开
    if not os.environ.get('WERKZEUG_RUN_MAIN'):
        webbrowser.open('http://localhost:3000/static/index.html')
    app.run(debug=True, port=3000)