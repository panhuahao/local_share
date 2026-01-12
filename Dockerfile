FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 复制package文件
COPY package*.json ./

# 安装依赖和 ffmpeg
RUN apk add --no-cache ffmpeg
RUN npm config set registry https://mirrors.cloud.tencent.com/npm/
RUN npm install --only=production

# 复制应用代码
COPY server.js ./
COPY public ./public

# 创建必要目录
RUN mkdir -p /app/data /app/uploads

# 设置权限
RUN chown -R node:node /app

# 切换到非root用户
USER node

# 暴露端口
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# 启动应用
CMD ["node", "server.js"]
