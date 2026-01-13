#!/bin/bash

echo "开始 ARM 平台部署..."

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo "错误: Docker 未安装"
    exit 1
fi

# 检查 Docker Compose 是否安装
if ! command -v docker-compose &> /dev/null; then
    echo "正在安装 Docker Compose..."
    apt update
    apt install -y docker-compose
fi

# 确保数据目录存在且权限正确
echo "设置目录权限..."
mkdir -p data uploads
chmod -R 755 data uploads

# 如果存在 ARM 专用 Dockerfile，则使用它
if [ -f "Dockerfile.arm" ]; then
    echo "使用 ARM 优化的 Dockerfile..."
    sed -i 's/build: ./build:\
      context: .\n      dockerfile: Dockerfile.arm/' docker-compose.arm.yml
fi

# 构建并启动服务
echo "构建并启动服务..."
docker-compose -f docker-compose.arm.yml down
docker-compose -f docker-compose.arm.yml build --no-cache
docker-compose -f docker-compose.arm.yml up -d

# 等待服务启动
echo "等待服务启动..."
sleep 10

# 检查服务状态
echo "检查服务状态..."
docker-compose -f docker-compose.arm.yml ps

echo "ARM 平台部署完成！"
echo "访问地址: http://$(hostname -I | awk '{print $1}'):8580"