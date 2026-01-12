#!/bin/bash

# 多媒体分享平台快速启动脚本

set -e

echo "=========================================="
echo "  多媒体分享平台 - 快速启动脚本"
echo "=========================================="
echo ""

# 检查是否安装了必要的依赖
echo "检查环境..."

# 检查Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未检测到Node.js，请先安装Node.js 14或更高版本"
    echo "   安装地址: https://nodejs.org/"
    exit 1
fi

# 检查npm
if ! command -v npm &> /dev/null; then
    echo "❌ 未检测到npm，请先安装npm"
    exit 1
fi

echo "✅ Node.js版本: $(node --version)"
echo "✅ npm版本: $(npm --version)"
echo ""

# 检查package.json是否存在
if [ ! -f "package.json" ]; then
    echo "❌ 未找到package.json文件，请确保在正确的目录中运行此脚本"
    exit 1
fi

# 安装依赖
echo "=========================================="
echo "  安装项目依赖"
echo "=========================================="
if [ -d "node_modules" ]; then
    echo "检测到已存在的node_modules目录，跳过依赖安装"
else
    echo "正在安装依赖..."
    npm install
fi

# 创建必要目录
echo ""
echo "=========================================="
echo "  创建必要目录"
echo "=========================================="
mkdir -p uploads data
echo "✅ 目录结构已创建"

# 启动服务
echo ""
echo "=========================================="
echo "  启动服务"
echo "=========================================="
echo ""
echo "🚀 正在启动多媒体分享平台..."
echo ""
echo "服务启动后，您可以通过以下地址访问："
echo "  • 前端页面: http://localhost:3000"
echo "  • API文档: http://localhost:3000/api/health"
echo ""
echo "按 Ctrl+C 停止服务"
echo "=========================================="
echo ""

# 启动Node.js服务器
node server.js
