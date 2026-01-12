# 多媒体分享平台部署指南

## 概述

本指南将帮助您快速部署多媒体分享平台，解决A端分享B端看不到的问题。

## 问题原因

原问题：A端分享的内容在B端看不到
根本原因：原应用使用纯前端实现，数据存储在浏览器localStorage中，每个浏览器的数据是独立的

解决方案：开发后端服务，实现数据的服务器存储和多端同步

## 部署步骤

### 方案一：使用Docker Compose（推荐）

1. **安装Docker和Docker Compose**
   ```bash
   # Ubuntu/Debian
   sudo apt update
   sudo apt install docker.io docker-compose
   
   # CentOS/RHEL
   sudo yum install docker docker-compose
   
   # 启动Docker
   sudo systemctl start docker
   sudo systemctl enable docker
   ```

2. **启动服务**
   ```bash
   # 在项目目录中执行
   docker-compose up -d
   
   # 查看日志
   docker-compose logs -f
   ```

3. **访问应用**
   - 前端页面: http://localhost:8080
   - API文档: http://localhost:8080/api/health
   - 直接访问Node.js: http://localhost:3000

### 方案二：直接运行Node.js

1. **安装Node.js**
   ```bash
   # 使用NodeSource安装最新版Node.js
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt install nodejs
   
   # 验证安装
   node --version
   npm --version
   ```

2. **安装依赖并启动**
   ```bash
   # 进入项目目录
   cd /path/to/media-share-platform
   
   # 安装依赖
   npm install
   
   # 创建必要目录
   mkdir -p uploads data
   
   # 启动服务
   npm start
   
   # 或使用快速启动脚本
   ./quick-start.sh
   ```

3. **访问应用**
   - 前端页面: http://localhost:3000
   - API文档: http://localhost:3000/api/health

### 方案三：使用PM2生产部署

1. **安装PM2**
   ```bash
   npm install -g pm2
   ```

2. **使用PM2启动**
   ```bash
   # 启动应用
   pm2 start server.js --name media-share
   
   # 保存进程列表
   pm2 save
   
   # 设置开机启动
   pm2 startup
   
   # 查看状态
   pm2 status
   
   # 查看日志
   pm2 logs media-share
   ```

## 目录结构说明

```
media-share-platform/
├── server.js              # 后端服务（核心）
├── public/                # 前端静态文件
│   ├── index.html        # 首页（内容展示和发布）
│   ├── history.html      # 历史页面（已删除内容管理）
│   ├── settings.html     # 设置页面
│   └── main.js           # 前端JavaScript（已适配后端API）
├── uploads/              # 上传文件存储目录
├── data/                 # 数据文件存储目录
│   ├── contents.json     # 内容数据
│   └── deleted.json      # 已删除内容数据
├── docker-compose.yml    # Docker Compose配置
├── nginx.conf            # Nginx反向代理配置
├── package.json          # Node.js依赖
└── README.md             # 项目文档
```

## API接口文档

### 核心接口

#### 1. 获取所有内容
```http
GET /api/contents
```
响应示例：
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "type": "image|video|text",
      "text": "分享的文字内容",
      "data": "/uploads/filename.jpg",
      "createdAt": "2026-01-11T10:00:00.000Z"
    }
  ]
}
```

#### 2. 创建内容（支持文件上传）
```http
POST /api/contents
Content-Type: multipart/form-data
```
表单字段：
- `text`: 文字内容（可选）
- `files`: 文件列表（可选，支持多个文件）

#### 3. 删除内容（移动到回收站）
```http
DELETE /api/contents/:id
```

#### 4. 恢复内容
```http
POST /api/contents/:id/restore
```

#### 5. 永久删除内容
```http
DELETE /api/contents/:id/permanent
```

#### 6. 批量恢复
```http
POST /api/batch/restore
Content-Type: application/json

{
  "ids": ["uuid1", "uuid2", ...]
}
```

#### 7. 批量永久删除
```http
DELETE /api/batch/permanent
Content-Type: application/json

{
  "ids": ["uuid1", "uuid2", ...]
}
```

#### 8. 健康检查
```http
GET /api/health
```

## 数据存储说明

### 内容数据结构

```json
{
  "id": "uuid",
  "type": "image|video|text",
  "text": "文字内容",
  "data": "/uploads/filename.jpg",
  "filename": "original_name.jpg",
  "size": 1024000,
  "mimetype": "image/jpeg",
  "createdAt": "2026-01-11T10:00:00.000Z",
  "updatedAt": "2026-01-11T10:00:00.000Z"
}
```

### 文件存储

- **上传目录**: `uploads/`
- **文件命名**: UUID + 原始扩展名
- **访问路径**: `/uploads/{filename}`

## 前端功能说明

### 主要改进

1. **API集成**: 前端JavaScript已修改为调用后端API
2. **网络状态检测**: 自动检测网络状态，显示离线提示
3. **上传进度**: 显示文件上传进度条
4. **错误处理**: 完善的错误处理和用户提示
5. **实时同步**: 内容发布后自动刷新列表

### 使用流程

1. **发布内容**
   - 点击"分享"按钮
   - 输入文字内容（可选）
   - 选择或拖拽文件（可选）
   - 点击"发布"

2. **查看内容**
   - 内容自动显示在首页
   - 支持按类型筛选
   - 支持按时间排序
   - 点击内容查看详情

3. **删除和恢复**
   - 点击内容卡片上的删除按钮
   - 内容移动到回收站
   - 在历史页面可以恢复或永久删除

4. **批量操作**
   - 在历史页面选择多个内容
   - 支持批量恢复或批量删除

## 性能优化

### 已实现的优化

1. **文件压缩**: 自动压缩上传的图片
2. **缓存策略**: 合理的浏览器缓存配置
3. **CDN支持**: 支持CDN加速静态资源
4. **懒加载**: 图片懒加载优化

### 建议的进一步优化

1. **数据库**: 生产环境建议使用MongoDB或PostgreSQL
2. **缓存**: 使用Redis缓存热点数据
3. **CDN**: 使用云存储CDN加速文件访问
4. **监控**: 添加应用性能监控

## 安全加固

### 已实现的安全措施

1. **文件类型验证**: 严格验证上传文件类型
2. **文件大小限制**: 防止大文件攻击（50MB限制）
3. **CORS配置**: 合理的跨域配置
4. **安全头设置**: XSS防护等安全头

### 建议的安全加固

1. **认证授权**: 添加用户认证系统
2. **HTTPS**: 配置SSL证书
3. **限流**: 添加API限流防止滥用
4. **备份**: 定期备份数据文件

## 故障排除

### 常见问题

1. **端口占用**
   ```bash
   # 查看端口占用
   lsof -i :3000
   
   # 修改端口
   PORT=3001 node server.js
   ```

2. **权限问题**
   ```bash
   chmod -R 755 uploads data
   ```

3. **依赖安装失败**
   ```bash
   npm cache clean --force
   npm install
   ```

4. **Docker容器无法启动**
   ```bash
   # 查看日志
   docker-compose logs app
   docker-compose logs nginx
   
   # 重新构建
   docker-compose down
   docker-compose build --no-cache
   docker-compose up -d
   ```

## 监控和维护

### 日志查看

```bash
# Node.js应用日志
pm2 logs media-share

# 或查看应用目录中的日志文件
tail -f /path/to/logs

# Docker日志
docker-compose logs -f
```

### 数据备份

```bash
# 备份数据目录
tar -czf backup-$(date +%Y%m%d).tar.gz data/ uploads/

# 恢复数据
tar -xzf backup-20260111.tar.gz
```

### 性能监控

```bash
# 查看Node.js进程
pm2 monit

# 查看系统资源
htop
df -h
du -sh uploads data
```

## 扩展功能建议

1. **用户系统**: 添加用户注册、登录、权限管理
2. **社交功能**: 点赞、评论、分享统计
3. **搜索功能**: 全文搜索内容
4. **标签系统**: 为内容添加标签分类
5. **API扩展**: RESTful API完整支持
6. **移动端APP**: 开发React Native或Flutter应用

## 技术支持

如有问题，请：
1. 查看项目README.md
2. 检查日志文件
3. 提交Issue到项目仓库

---

**部署完成后，您的多媒体分享平台将支持多端实时同步，A端分享的内容B端可以立即看到！**
