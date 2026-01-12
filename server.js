const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// 配置
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 增加到 500MB，支持大视频上传

// 确保目录存在
async function ensureDirectories() {
    try {
        await fs.mkdir(UPLOAD_DIR, { recursive: true });
        await fs.mkdir(DATA_DIR, { recursive: true });
    } catch (error) {
        console.error('创建目录失败:', error);
    }
}

// 配置文件上传
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: MAX_FILE_SIZE
    },
    fileFilter: (req, file, cb) => {
        // 允许所有类型的文件分享
        cb(null, true);
    }
});

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// 数据文件路径
const CONTENTS_FILE = path.join(DATA_DIR, 'contents.json');
const DELETED_FILE = path.join(DATA_DIR, 'deleted.json');

// 读取数据文件
async function readDataFile(filename, defaultValue = []) {
    try {
        const data = await fs.readFile(filename, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await writeDataFile(filename, defaultValue);
            return defaultValue;
        }
        throw error;
    }
}

// 写入数据文件
async function writeDataFile(filename, data) {
    try {
        await fs.writeFile(filename, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error('写入文件失败:', error);
        throw error;
    }
}

// 获取所有内容
app.get('/api/contents', async (req, res) => {
    try {
        const contents = await readDataFile(CONTENTS_FILE);
        res.json({
            success: true,
            data: contents
        });
    } catch (error) {
        console.error('获取内容失败:', error);
        res.status(500).json({
            success: false,
            message: '获取内容失败'
        });
    }
});

// 获取已删除内容
app.get('/api/deleted', async (req, res) => {
    try {
        const deleted = await readDataFile(DELETED_FILE);
        res.json({
            success: true,
            data: deleted
        });
    } catch (error) {
        console.error('获取已删除内容失败:', error);
        res.status(500).json({
            success: false,
            message: '获取已删除内容失败'
        });
    }
});

// 创建新内容（带文件上传）
app.post('/api/contents', upload.array('files', 10), async (req, res) => {
    try {
        const { text } = req.body;
        const files = req.files || [];
        
        // 读取现有内容
        const contents = await readDataFile(CONTENTS_FILE);
        
        // 创建内容记录
        const newContents = [];
        
        // 处理文本内容
        if (text && text.trim()) {
            const textContent = {
                id: uuidv4(),
                type: 'text',
                text: text.trim(),
                data: null,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            newContents.push(textContent);
        }
        
        // 处理文件内容
        for (const file of files) {
            let fileType = 'file';
            if (file.mimetype.startsWith('image/')) {
                fileType = 'image';
            } else if (file.mimetype.startsWith('video/')) {
                fileType = 'video';
            } else if (file.mimetype.startsWith('audio/')) {
                fileType = 'audio';
            }
            
            const fileContent = {
                id: uuidv4(),
                type: fileType,
                text: text && files.length > 1 ? text.trim() : '',
                data: `/uploads/${file.filename}`,
                filename: file.originalname,
                size: file.size,
                mimetype: file.mimetype,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            newContents.push(fileContent);
        }
        
        // 添加到内容列表
        contents.unshift(...newContents);
        
        // 保存到文件
        await writeDataFile(CONTENTS_FILE, contents);
        
        res.json({
            success: true,
            message: '内容发布成功',
            data: newContents
        });
        
    } catch (error) {
        console.error('发布内容失败:', error);
        res.status(500).json({
            success: false,
            message: '发布内容失败'
        });
    }
});

// 删除内容（移动到回收站）
app.delete('/api/contents/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        // 读取内容
        const contents = await readDataFile(CONTENTS_FILE);
        const deleted = await readDataFile(DELETED_FILE);
        
        // 查找要删除的内容
        const contentIndex = contents.findIndex(c => c.id === id);
        if (contentIndex === -1) {
            return res.status(404).json({
                success: false,
                message: '内容不存在'
            });
        }
        
        // 移动到回收站
        const content = contents[contentIndex];
        content.deletedAt = new Date().toISOString();
        deleted.unshift(content);
        
        // 从原列表移除
        contents.splice(contentIndex, 1);
        
        // 保存
        await writeDataFile(CONTENTS_FILE, contents);
        await writeDataFile(DELETED_FILE, deleted);
        
        res.json({
            success: true,
            message: '内容已移至回收站'
        });
        
    } catch (error) {
        console.error('删除内容失败:', error);
        res.status(500).json({
            success: false,
            message: '删除内容失败'
        });
    }
});

// 恢复内容
app.post('/api/contents/:id/restore', async (req, res) => {
    try {
        const { id } = req.params;
        
        // 读取内容
        const contents = await readDataFile(CONTENTS_FILE);
        const deleted = await readDataFile(DELETED_FILE);
        
        // 查找要恢复的内容
        const contentIndex = deleted.findIndex(c => c.id === id);
        if (contentIndex === -1) {
            return res.status(404).json({
                success: false,
                message: '内容不存在'
            });
        }
        
        // 恢复内容
        const content = deleted[contentIndex];
        delete content.deletedAt;
        contents.unshift(content);
        
        // 从回收站移除
        deleted.splice(contentIndex, 1);
        
        // 保存
        await writeDataFile(CONTENTS_FILE, contents);
        await writeDataFile(DELETED_FILE, deleted);
        
        res.json({
            success: true,
            message: '内容恢复成功'
        });
        
    } catch (error) {
        console.error('恢复内容失败:', error);
        res.status(500).json({
            success: false,
            message: '恢复内容失败'
        });
    }
});

// 永久删除内容
app.delete('/api/contents/:id/permanent', async (req, res) => {
    try {
        const { id } = req.params;
        
        // 读取已删除内容
        const deleted = await readDataFile(DELETED_FILE);
        
        // 查找要删除的内容
        const contentIndex = deleted.findIndex(c => c.id === id);
        if (contentIndex === -1) {
            return res.status(404).json({
                success: false,
                message: '内容不存在'
            });
        }
        
        const content = deleted[contentIndex];
        
        // 删除关联的文件
        if (content.data && content.data.startsWith('/uploads/')) {
            const filePath = path.join(__dirname, content.data);
            try {
                await fs.unlink(filePath);
            } catch (error) {
                console.error('删除文件失败:', error);
            }
        }
        
        // 从回收站移除
        deleted.splice(contentIndex, 1);
        
        // 保存
        await writeDataFile(DELETED_FILE, deleted);
        
        res.json({
            success: true,
            message: '内容已永久删除'
        });
        
    } catch (error) {
        console.error('永久删除内容失败:', error);
        res.status(500).json({
            success: false,
            message: '永久删除内容失败'
        });
    }
});

// 批量操作
app.post('/api/batch/restore', async (req, res) => {
    try {
        const { ids } = req.body;
        
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: '请提供要恢复的内容ID列表'
            });
        }
        
        const contents = await readDataFile(CONTENTS_FILE);
        const deleted = await readDataFile(DELETED_FILE);
        
        let restoredCount = 0;
        
        for (const id of ids) {
            const contentIndex = deleted.findIndex(c => c.id === id);
            if (contentIndex !== -1) {
                const content = deleted[contentIndex];
                delete content.deletedAt;
                contents.unshift(content);
                deleted.splice(contentIndex, 1);
                restoredCount++;
            }
        }
        
        await writeDataFile(CONTENTS_FILE, contents);
        await writeDataFile(DELETED_FILE, deleted);
        
        res.json({
            success: true,
            message: `成功恢复 ${restoredCount} 项内容`,
            data: { restoredCount }
        });
        
    } catch (error) {
        console.error('批量恢复失败:', error);
        res.status(500).json({
            success: false,
            message: '批量恢复失败'
        });
    }
});

app.delete('/api/batch/permanent', async (req, res) => {
    try {
        const { ids } = req.body;
        
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({
                success: false,
                message: '请提供要删除的内容ID列表'
            });
        }
        
        const deleted = await readDataFile(DELETED_FILE);
        let deletedCount = 0;
        
        for (const id of ids) {
            const contentIndex = deleted.findIndex(c => c.id === id);
            if (contentIndex !== -1) {
                const content = deleted[contentIndex];
                
                // 删除关联的文件
                if (content.data && content.data.startsWith('/uploads/')) {
                    const filePath = path.join(__dirname, content.data);
                    try {
                        await fs.unlink(filePath);
                    } catch (error) {
                        console.error('删除文件失败:', error);
                    }
                }
                
                deleted.splice(contentIndex, 1);
                deletedCount++;
            }
        }
        
        await writeDataFile(DELETED_FILE, deleted);
        
        res.json({
            success: true,
            message: `成功永久删除 ${deletedCount} 项内容`,
            data: { deletedCount }
        });
        
    } catch (error) {
        console.error('批量删除失败:', error);
        res.status(500).json({
            success: false,
            message: '批量删除失败'
        });
    }
});

// 重置所有数据
app.post('/api/system/reset', async (req, res) => {
    try {
        // 1. 清空数据文件
        await writeDataFile(CONTENTS_FILE, []);
        await writeDataFile(DELETED_FILE, []);
        
        // 2. 删除上传目录下的所有文件
        const files = await fs.readdir(UPLOAD_DIR);
        for (const file of files) {
            if (file === '.gitkeep') continue;
            try {
                await fs.unlink(path.join(UPLOAD_DIR, file));
            } catch (err) {
                console.error(`删除文件 ${file} 失败:`, err);
            }
        }
        
        res.json({
            success: true,
            message: '所有数据已成功清空'
        });
    } catch (error) {
        console.error('重置数据失败:', error);
        res.status(500).json({
            success: false,
            message: '服务器重置失败'
        });
    }
});

// 视频转换/优化 (转为 H.264 MP4)
app.post('/api/video/optimize', async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, message: '未提供内容ID' });

        const contents = await readDataFile(CONTENTS_FILE);
        const item = contents.find(c => c.id === id);

        if (!item || item.type !== 'video') {
            return res.status(404).json({ success: false, message: '视频内容不存在' });
        }

        const inputPath = path.join(__dirname, item.data);
        const outputFilename = `optimized-${uuidv4()}.mp4`;
        const outputPath = path.join(UPLOAD_DIR, outputFilename);

        // 使用 ffmpeg 优化视频：转为 H.264, AAC, 兼容性最好的 yuv420p
        const command = `ffmpeg -i "${inputPath}" -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`;

        exec(command, async (error) => {
            if (error) {
                console.error('FFmpeg 优化失败:', error);
                return res.status(500).json({ success: false, message: '视频优化失败' });
            }

            const stats = await fs.stat(outputPath);

            const newVideoContent = {
                id: uuidv4(),
                type: 'video',
                text: `[优化视频] ${item.text || ''}`,
                data: `/uploads/${outputFilename}`,
                filename: `optimized-${item.filename || 'video.mp4'}`,
                size: stats.size,
                mimetype: 'video/mp4',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            contents.unshift(newVideoContent);
            await writeDataFile(CONTENTS_FILE, contents);

            res.json({
                success: true,
                message: '视频优化成功',
                data: newVideoContent
            });
        });
    } catch (error) {
        console.error('处理视频优化失败:', error);
        res.status(500).json({ success: false, message: '处理失败' });
    }
});

// 音频转空白视频 (MP4)
app.post('/api/audio/to-mp4', async (req, res) => {
    try {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, message: '未提供内容ID' });

        const contents = await readDataFile(CONTENTS_FILE);
        const item = contents.find(c => c.id === id);

        if (!item || item.type !== 'audio') {
            return res.status(404).json({ success: false, message: '音频内容不存在' });
        }

        const inputPath = path.join(__dirname, item.data);
        const outputFilename = `${uuidv4()}.mp4`;
        const outputPath = path.join(UPLOAD_DIR, outputFilename);

        // 使用 ffmpeg 生成黑色背景视频并合成音频
        // 参数说明：
        // -f lavfi -i color... : 生成黑色背景
        // -i input : 输入音频
        // -shortest : 以较短的流（音频）结束为准
        const command = `ffmpeg -f lavfi -i color=c=black:s=640x480:r=25 -i "${inputPath}" -c:v libx264 -tune stillimage -c:a aac -b:a 192k -pix_fmt yuv420p -shortest "${outputPath}"`;

        exec(command, async (error) => {
            if (error) {
                console.error('FFmpeg 转换失败:', error);
                return res.status(500).json({ success: false, message: '视频转换失败' });
            }

            // 获取新文件大小
            const stats = await fs.stat(outputPath);

            // 创建新内容记录
            const newVideoContent = {
                id: uuidv4(),
                type: 'video',
                text: `[音频转换] ${item.text || ''}`,
                data: `/uploads/${outputFilename}`,
                filename: `${item.filename || 'audio'}.mp4`,
                size: stats.size,
                mimetype: 'video/mp4',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            contents.unshift(newVideoContent);
            await writeDataFile(CONTENTS_FILE, contents);

            res.json({
                success: true,
                message: '视频转换成功',
                data: newVideoContent
            });
        });
    } catch (error) {
        console.error('处理音频转换失败:', error);
        res.status(500).json({ success: false, message: '处理失败' });
    }
});

// 健康检查
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: '服务正常运行',
        timestamp: new Date().toISOString()
    });
});

// 错误处理中间件
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: '文件大小超过限制'
            });
        }
    }
    
    console.error('错误:', error);
    res.status(500).json({
        success: false,
        message: '服务器错误'
    });
});

// 自动清理配置
let cleanupConfig = {
    enabled: false,
    periodDays: 30
};

// 自动清理过期内容（每小时执行一次）
async function runAutoCleanup() {
    try {
        if (!cleanupConfig.enabled) return;

        const deleted = await readDataFile(DELETED_FILE);
        if (deleted.length === 0) return;

        const now = new Date();
        const expiryMs = cleanupConfig.periodDays * 24 * 60 * 60 * 1000;
        
        let deletedCount = 0;
        const remainingDeleted = [];

        for (const item of deleted) {
            const deletedAt = new Date(item.deletedAt);
            if (now - deletedAt > expiryMs) {
                // 彻底删除关联文件
                if (item.data && item.data.startsWith('/uploads/')) {
                    const filePath = path.join(__dirname, item.data);
                    try {
                        await fs.unlink(filePath);
                    } catch (err) {
                        // 忽略文件不存在等错误
                    }
                }
                deletedCount++;
            } else {
                remainingDeleted.push(item);
            }
        }

        if (deletedCount > 0) {
            await writeDataFile(DELETED_FILE, remainingDeleted);
            console.log(`[AutoCleanup] 自动清理完成，永久删除了 ${deletedCount} 项过期内容`);
        }
    } catch (error) {
        console.error('[AutoCleanup] 执行失败:', error);
    }
}

// 更新清理配置接口
app.post('/api/settings/cleanup', (req, res) => {
    const { enabled, periodDays } = req.body;
    cleanupConfig.enabled = !!enabled;
    if (periodDays) cleanupConfig.periodDays = parseInt(periodDays);
    
    res.json({
        success: true,
        message: '清理配置已更新',
        data: cleanupConfig
    });
});

// 启动服务器
async function startServer() {
    await ensureDirectories();
    
    // 启动后立即执行一次，之后每小时执行一次
    runAutoCleanup();
    setInterval(runAutoCleanup, 60 * 60 * 1000);
    
    app.listen(PORT, () => {
        console.log(`多媒体分享服务器运行在端口 ${PORT}`);
        console.log(`访问地址: http://localhost:${PORT}`);
        console.log(`API文档: http://localhost:${PORT}/api/health`);
    });
}

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('收到SIGTERM信号，优雅关闭服务器...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('收到SIGINT信号，优雅关闭服务器...');
    process.exit(0);
});

// 启动
startServer().catch(console.error);
