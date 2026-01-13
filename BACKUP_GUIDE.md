# 项目备份与部署指南

本文档提供了三种不同的项目备份与部署方案，您可以根据实际场景选择最合适的方式。

---

## 方案 1：干净版本（源码打包 + Docker Compose）

**适用场景**：迁移一个全新的、不带历史数据的项目实例。

### 1.1 清理旧数据

在当前项目目录下执行以下命令，清空所有历史记录和上传文件：

```bash
# 清空所有内容记录
echo "[]" > data/contents.json
echo "[]" > data/deleted.json

# 删除所有已上传的文件（保留 .gitkeep）
find uploads/ -type f ! -name '.gitkeep' -delete
```

### 1.2 打包项目源码

```bash
cd /root/share

# 排除 node_modules、数据文件，仅打包源代码和配置
tar -czvf media_share_clean.tar.gz \
    --exclude='node_modules' \
    --exclude='data/*' \
    --exclude='uploads/*' \
    .
```

### 1.3 新环境部署

1. 将 `media_share_clean.tar.gz` 上传到新服务器
2. 解压文件：
   ```bash
   mkdir media-share && cd media-share
   tar -xzvf ../media_share_clean.tar.gz
   ```
3. 启动服务：
   ```bash
   # 确保已安装 Docker 和 Docker Compose
   docker compose up -d
   ```

系统会自动创建空的 `data` 和 `uploads` 目录并初始化。

---

## 方案 2：镜像版本（Docker 镜像导出/导入）

**适用场景**：新环境网络条件不佳、无法访问 Docker Hub/npm，或需要保证环境绝对一致。

### 2.1 构建并导出镜像

在当前环境执行：

```bash
# 构建 Docker 镜像
docker build -t media-share-app:v1.0 .

# 将镜像保存为压缩文件（约 200-300MB）
docker save media-share-app:v1.0 | gzip > media_share_image.tar.gz
```

### 2.2 新环境导入镜像

将 `media_share_image.tar.gz` 上传到新服务器后：

```bash
# 载入镜像
docker load < media_share_image.tar.gz

# 验证镜像已导入
docker images | grep media-share-app
```

### 2.3 修改 docker-compose.yml 并启动

编辑 `docker-compose.yml`，找到 `app` 服务部分，将：

```yaml
app:
  build: .
```

替换为：

```yaml
app:
  image: media-share-app:v1.0
```

然后启动服务：

```bash
docker compose up -d
```

**优势**：无需重新构建（build），启动速度快，完全离线可用。

---

## 方案 3：GitHub 版本管理（推荐长期维护）

**适用场景**：团队协作、版本控制、持续迭代开发。

### 3.1 初始化 Git 仓库

在项目目录下执行：

```bash
cd /root/share

# 初始化 Git（如果还未初始化）
git init

# 添加所有文件（.gitignore 会自动排除 data/ 和 uploads/）
git add .

# 创建首次提交
git commit -m "feat: Initial commit with FFmpeg support and UI optimizations"
```

### 3.2 关联 GitHub 远程仓库

#### 方式 A：在 Windows 本地操作（推荐）

1. **在 Windows 上安装 Git**：
   - 下载 [Git for Windows](https://git-scm.com/download/win)
   - 安装完成后打开 Git Bash

2. **配置 SSH 密钥（首次使用）**：
   ```bash
   # 生成 SSH 密钥
   ssh-keygen -t rsa -b 4096 -C "your_email@example.com"
   
   # 查看公钥并复制
   cat ~/.ssh/id_rsa.pub
   ```
   
3. **将公钥添加到 GitHub**：
   - 登录 GitHub → Settings → SSH and GPG keys → New SSH key
   - 粘贴刚才复制的公钥内容

4. **通过 SFTP/WinSCP 将服务器项目下载到本地**

5. **在本地项目目录执行**：
   ```bash
   # 添加远程仓库（使用 SSH 地址）
   git remote add origin git@github.com:你的用户名/仓库名.git
   
   # 推送到 GitHub
   git branch -M main
   git push -u origin main
   ```

#### 方式 B：直接在服务器操作

1. **在服务器上配置 Git 用户信息**：
   ```bash
   git config --global user.name "你的名字"
   git config --global user.email "your_email@example.com"
   ```

2. **生成 SSH 密钥**：
   ```bash
   ssh-keygen -t rsa -b 4096 -C "your_email@example.com"
   cat ~/.ssh/id_rsa.pub  # 复制输出的公钥
   ```

3. **将服务器的公钥添加到 GitHub**（步骤同上）

4. **关联并推送**：
   ```bash
   git remote add origin git@github.com:你的用户名/仓库名.git
   git branch -M main
   git push -u origin main
   ```

### 3.3 新环境部署

在任何新服务器上，只需：

```bash
# 克隆项目
git clone git@github.com:你的用户名/仓库名.git
cd 仓库名

# 启动服务
docker compose up -d
```

### 3.4 ARM 平台部署

对于 ARM 架构的设备（如树莓派、Apple Silicon Mac 等），请使用专门的部署脚本：

```bash
# 克隆项目
git clone git@github.com:你的用户名/仓库名.git
cd 仓库名

# 给部署脚本授权
chmod +x arm-deploy.sh

# 运行 ARM 部署
./arm-deploy.sh
```

**ARM 平台注意事项：**
- 确保设备有足够的内存（建议至少 2GB RAM）
- FFmpeg 在 ARM 平台上可能运行较慢，音视频转换时间会更长
- 如果遇到权限问题，确保 data 和 uploads 目录有正确的读写权限
- Docker 镜像构建可能需要更多时间

### 3.4 后续更新

每次修改代码后：

```bash
# 添加修改
git add .

# 提交修改
git commit -m "描述你的修改内容"

# 推送到 GitHub
git push
```

---

## GitHub 操作详解

### 推荐方案：在 Windows 本地操作

**为什么推荐在本地（Windows）操作？**

1. **更方便的编辑体验**：可以使用 VS Code 等图形化工具
2. **安全性更高**：不需要在服务器上存储 GitHub 凭证
3. **更灵活**：可以先本地测试，确认无误后再推送

**工作流程：**

```
服务器（开发环境） 
    ↓ SFTP/WinSCP 下载
Windows 本地
    ↓ Git 提交并推送
GitHub 仓库
    ↓ Git Clone
新服务器（生产环境）
```

### 在服务器直接操作的场景

如果您习惯直接在服务器上通过 SSH 修改代码，也可以直接在服务器上：

1. 配置 Git
2. 生成 SSH 密钥并添加到 GitHub
3. 直接 `git push`

**注意**：无论哪种方式，GitHub 账号本身的登录都是在 **GitHub 网站**上完成的，Git 命令只是通过 SSH 密钥进行身份验证。

---

## 方案对比

| 特性 | 方案1 (源码) | 方案2 (镜像) | 方案3 (GitHub) |
|------|-------------|-------------|----------------|
| 文件大小 | 小（~5MB） | 大（~300MB） | 小（~5MB） |
| 部署速度 | 需构建（~5min） | 快（~30s） | 需构建（~5min） |
| 离线可用 | 需要网络 | 完全离线 | 需要网络 |
| 版本管理 | ❌ | ❌ | ✅ |
| 团队协作 | ❌ | ❌ | ✅ |
| 环境一致性 | 中 | 高 | 中 |
| 推荐场景 | 一次性部署 | 离线环境 | 长期维护 |

---

## 常见问题

### Q1: 我已经有数据了，想保留怎么办？

**方案1** 中不要执行清理步骤，打包时包含 `data/` 和 `uploads/`：

```bash
tar -czvf media_share_with_data.tar.gz \
    --exclude='node_modules' \
    .
```

### Q2: GitHub 私有仓库会收费吗？

GitHub 免费账号可以创建无限的私有仓库，推荐使用私有仓库保护您的代码。

### Q3: 如何验证部署是否成功？

访问 `http://服务器IP:8580` 查看页面是否正常加载，或执行：

```bash
curl http://localhost:8580/api/health
```

---

**提示**：建议结合 **方案3** 进行版本管理，并定期备份 `data/` 和 `uploads/` 目录以防数据丢失。
