const express = require('express');
const multer = require('multer');
const path = require('path');
const fsSync = require('fs');
const fs = require('fs').promises;
const { exec, execFile } = require('child_process');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
let heicConvert = null;
try {
    heicConvert = require('heic-convert');
} catch {}

function loadDotEnvIfPresent() {
    try {
        const envPath = path.join(__dirname, '.env');
        if (!fsSync.existsSync(envPath)) return;
        const content = fsSync.readFileSync(envPath, 'utf8');
        const lines = content.split(/\r?\n/);
        for (const raw of lines) {
            const line = String(raw || '').trim();
            if (!line || line.startsWith('#')) continue;
            const idx = line.indexOf('=');
            if (idx <= 0) continue;
            const key = line.slice(0, idx).trim();
            if (!key) continue;
            if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
            let value = line.slice(idx + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            process.env[key] = value;
        }
    } catch {}
}

loadDotEnvIfPresent();

const VOLC_TTS_APP_ID = process.env.VOLC_TTS_APP_ID || '';
const VOLC_TTS_ACCESS_KEY = process.env.VOLC_TTS_ACCESS_KEY || '';
function normalizeVolcAccessToken(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '';
    return raw.replace(/^Bearer;?\s*/i, '').trim();
}

function normalizeVolcVoiceCloneResourceId(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '';
    if (/^volc\.megatts\.voiceclone$/i.test(raw)) return '';
    if (!/^seed-icl-/i.test(raw)) return '';
    return raw;
}

const VOLC_TTS_ACCESS_TOKEN = normalizeVolcAccessToken(process.env.VOLC_TTS_ACCESS_TOKEN || VOLC_TTS_ACCESS_KEY || '');
const VOLC_VOICECLONE_RESOURCE_ID = normalizeVolcVoiceCloneResourceId(process.env.VOLC_VOICECLONE_RESOURCE_ID);
const VOLC_VOICECLONE_SPEAKER_ID = (process.env.VOLC_VOICECLONE_SPEAKER_ID || '').trim();
const VOLC_VOICECLONE_ALLOWED_SPEAKER_IDS = String(process.env.VOLC_VOICECLONE_ALLOWED_SPEAKER_IDS || '')
    .split(',')
    .map((x) => String(x || '').trim())
    .filter(Boolean);
const VOLC_TTS_RESOURCE_ID_V2 = process.env.VOLC_TTS_RESOURCE_ID_V2 || 'seed-tts-2.0';
const VOLC_TTS_RESOURCE_ID_V1 = process.env.VOLC_TTS_RESOURCE_ID_V1 || 'seed-tts-1.0';
const VOLC_TTS_RESOURCE_ID_ICL1 = process.env.VOLC_TTS_RESOURCE_ID_ICL1 || 'seed-icl-1.0';
const VOLC_TTS_RESOURCE_ID_ICL2 = process.env.VOLC_TTS_RESOURCE_ID_ICL2 || 'seed-icl-2.0';
const VOLC_TTS_MODEL_V2 = process.env.VOLC_TTS_MODEL_V2 || '';

const app = express();
const PORT = process.env.PORT || 3000;

// 配置
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const DATA_DIR = path.join(__dirname, 'data');
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 增加到 500MB，支持大视频上传

function execFileAsync(file, args, options = {}) {
    return new Promise((resolve, reject) => {
        execFile(file, args, { ...options, windowsHide: true, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                error.stdout = stdout;
                error.stderr = stderr;
                return reject(error);
            }
            resolve({ stdout, stderr });
        });
    });
}

function isHeicLike({ mimetype, filename } = {}) {
    const mt = typeof mimetype === 'string' ? mimetype.toLowerCase().trim() : '';
    if (mt === 'image/heic' || mt === 'image/heif') return true;
    const fn = typeof filename === 'string' ? filename : '';
    return /\.(heic|heif)$/i.test(fn);
}

function stripLeadingSlash(p) {
    const s = typeof p === 'string' ? p : '';
    return s.replace(/^\/+/, '');
}

function replaceFileExt(name, extWithDot) {
    const raw = typeof name === 'string' ? name : '';
    const ext = typeof extWithDot === 'string' ? extWithDot : '';
    const parsed = path.parse(raw);
    if (!parsed.name) return raw;
    return `${parsed.name}${ext}`;
}

async function convertHeicToJpeg(inputPath, outputPath) {
    if (typeof heicConvert === 'function') {
        try {
            const inputBuffer = await fs.readFile(inputPath);
            const outputBuffer = await heicConvert({
                buffer: inputBuffer,
                format: 'JPEG',
                quality: 0.92
            });
            await fs.writeFile(outputPath, outputBuffer);
            const st = await fs.stat(outputPath).catch(() => null);
            if (st && st.isFile() && st.size > 0) return st;
        } catch {}
    }

    const candidates = [
        { cmd: 'ffmpeg', args: ['-y', '-loglevel', 'error', '-i', inputPath, '-frames:v', '1', '-q:v', '2', outputPath] },
        { cmd: 'magick', args: [inputPath, outputPath] },
        { cmd: 'convert', args: [inputPath, outputPath] },
        { cmd: 'heif-convert', args: [inputPath, outputPath] }
    ];

    for (const c of candidates) {
        try {
            await execFileAsync(c.cmd, c.args);
            const st = await fs.stat(outputPath).catch(() => null);
            if (st && st.isFile() && st.size > 0) return st;
        } catch (err) {
            const code = err && err.code ? String(err.code) : '';
            const message = err && err.message ? String(err.message) : '';
            const notFound = code === 'ENOENT' || /not found/i.test(message);
            if (notFound) continue;
            const st = await fs.stat(outputPath).catch(() => null);
            if (st && st.isFile() && st.size > 0) return st;
        }
    }

    return null;
}

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
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// 数据文件路径
const CONTENTS_FILE = path.join(DATA_DIR, 'contents.json');
const DELETED_FILE = path.join(DATA_DIR, 'deleted.json');
const TTS_VOICES_FILE = path.join(DATA_DIR, 'tts_voices.json');

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

async function migrateHeicImages() {
    let contents;
    try {
        contents = await readDataFile(CONTENTS_FILE, []);
    } catch (err) {
        console.error('读取内容数据失败，跳过 HEIC 迁移:', err);
        return;
    }
    if (!Array.isArray(contents) || contents.length === 0) return;

    let changed = false;

    for (const item of contents) {
        if (!item || item.type !== 'image') continue;
        const data = typeof item.data === 'string' ? item.data : '';
        const looksHeic = isHeicLike({ mimetype: item.mimetype, filename: item.filename }) || /\.(heic|heif)$/i.test(data);
        if (!looksHeic) continue;

        const inputFilename = path.basename(data);
        if (!inputFilename) continue;
        const inputPath = path.join(UPLOAD_DIR, inputFilename);
        const inputExists = await fs.stat(inputPath).then((st) => st && st.isFile()).catch(() => false);
        if (!inputExists) continue;

        const convertedFilename = inputFilename.replace(/\.(heic|heif)$/i, '.jpg');
        const outputFilename = convertedFilename === inputFilename ? `${path.parse(inputFilename).name}.jpg` : convertedFilename;
        const outputPath = path.join(UPLOAD_DIR, outputFilename);
        const outputExists = await fs.stat(outputPath).then((st) => st && st.isFile() && st.size > 0).catch(() => false);

        let stat = null;
        if (outputExists) {
            stat = await fs.stat(outputPath).catch(() => null);
        } else {
            stat = await convertHeicToJpeg(inputPath, outputPath);
        }
        if (!stat) continue;

        if (!item.originalData && data) item.originalData = data;
        if (!item.originalFilename && item.filename) item.originalFilename = item.filename;
        if (!item.originalSize && item.size) item.originalSize = item.size;
        if (!item.originalMimetype && item.mimetype) item.originalMimetype = item.mimetype;

        item.data = `/uploads/${outputFilename}`;
        item.mimetype = 'image/jpeg';
        item.size = stat.size;
        if (typeof item.filename === 'string' && item.filename) {
            item.filename = replaceFileExt(item.filename, '.jpg');
        }
        item.updatedAt = new Date().toISOString();
        changed = true;
    }

    if (changed) {
        try {
            await writeDataFile(CONTENTS_FILE, contents);
        } catch (err) {
            console.error('写入 HEIC 迁移结果失败:', err);
        }
    }
}

function getVolcResourceIdBySpeaker(speaker) {
    if (typeof speaker !== 'string') return VOLC_TTS_RESOURCE_ID_V2;
    const s = speaker.trim();
    if (!s) return VOLC_TTS_RESOURCE_ID_V2;
    if (s.startsWith('saturn_')) return VOLC_TTS_RESOURCE_ID_ICL2;
    if (s.startsWith('seed_')) return VOLC_TTS_RESOURCE_ID_ICL2;
    if (s.startsWith('ICL_') || s.startsWith('icl_')) return VOLC_TTS_RESOURCE_ID_V1;
    if (s.includes('_mars_bigtts')) return VOLC_TTS_RESOURCE_ID_V1;
    return VOLC_TTS_RESOURCE_ID_V2;
}

function getBuiltInTtsVoices() {
    return [
        { id: 'zh_female_vv_uranus_bigtts', name: 'Vivi 2.0', group: '通用 2.0' },
        { id: 'zh_female_xiaohe_uranus_bigtts', name: '小何 2.0', group: '通用 2.0' },
        { id: 'zh_male_m191_uranus_bigtts', name: '云舟 2.0', group: '通用 2.0' },
        { id: 'zh_male_taocheng_uranus_bigtts', name: '小天 2.0', group: '通用 2.0' },
        { id: 'zh_female_xueayi_saturn_bigtts', name: '雪阿姨', group: '特色' },
        { id: 'zh_male_dayi_saturn_bigtts', name: '大壹', group: '特色' },
        { id: 'saturn_zh_female_keainvsheng_tob', name: '可爱女生', group: '角色扮演' },
        { id: 'saturn_zh_female_tiaopigongzhu_tob', name: '调皮公主', group: '角色扮演' },
        { id: 'saturn_zh_male_shuanglangshaonian_tob', name: '爽朗少年', group: '角色扮演' },
        { id: 'saturn_zh_male_tiancaitongzhuo_tob', name: '天才同桌', group: '角色扮演' },
        { id: 'saturn_zh_female_cancan_tob', name: '知性灿灿', group: '角色扮演' }
    ];
}

function normalizeVoiceRecord(v) {
    if (!v || typeof v !== 'object') return null;
    const id = typeof v.id === 'string' ? v.id.trim() : '';
    if (!id || id.length > 200) return null;
    const name = typeof v.name === 'string' ? v.name.trim() : '';
    const group = typeof v.group === 'string' ? v.group.trim() : '';
    return { id, name, group };
}

async function readCustomTtsVoices() {
    const list = await readDataFile(TTS_VOICES_FILE, []);
    if (!Array.isArray(list)) return [];
    return list.map(normalizeVoiceRecord).filter(Boolean);
}

async function writeCustomTtsVoices(list) {
    const normalized = Array.isArray(list) ? list.map(normalizeVoiceRecord).filter(Boolean) : [];
    await writeDataFile(TTS_VOICES_FILE, normalized);
    return normalized;
}

async function getEffectiveVoiceCloneAllowedSpeakerIds() {
    if (VOLC_VOICECLONE_ALLOWED_SPEAKER_IDS.length > 0) return VOLC_VOICECLONE_ALLOWED_SPEAKER_IDS;
    try {
        const custom = await readCustomTtsVoices();
        const ids = custom
            .map((v) => (v && typeof v.id === 'string' ? v.id.trim() : ''))
            .filter((id) => /^S_[A-Za-z0-9]+$/.test(id));
        return Array.from(new Set(ids));
    } catch {
        return [];
    }
}

function extractAudioBase64FromChunk(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (typeof obj.audio === 'string') return obj.audio;
    if (typeof obj.audio_data === 'string') return obj.audio_data;
    if (typeof obj.data === 'string') return obj.data;
    if (obj.data && typeof obj.data === 'object') {
        if (typeof obj.data.audio === 'string') return obj.data.audio;
        if (typeof obj.data.audio_data === 'string') return obj.data.audio_data;
        if (typeof obj.data.data === 'string') return obj.data.data;
    }
    if (obj.result && typeof obj.result === 'object') {
        if (typeof obj.result.audio === 'string') return obj.result.audio;
        if (typeof obj.result.audio_data === 'string') return obj.result.audio_data;
        if (typeof obj.result.data === 'string') return obj.result.data;
    }
    return null;
}

function normalizeJsonLine(line) {
    if (!line) return '';
    const trimmed = String(line).trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('data:')) return trimmed.slice(5).trim();
    return trimmed;
}

function speedRatioToSpeechRate(speedRatio) {
    const r = Number(speedRatio);
    if (!Number.isFinite(r)) return undefined;
    const clamped = Math.max(0.5, Math.min(2.0, r));
    const speechRate = Math.round((clamped - 1.0) * 100);
    return Math.max(-50, Math.min(100, speechRate));
}

function isVolcResourceMismatchPayload(obj) {
    if (!obj || typeof obj !== 'object') return false;
    const code = obj.code;
    const msg = typeof obj.message === 'string' ? obj.message : '';
    return code === 55000000 || /resource id is mismatched/i.test(msg);
}

function buildResourceIdCandidates(speaker) {
    const candidates = [
        getVolcResourceIdBySpeaker(speaker),
        VOLC_TTS_RESOURCE_ID_ICL2,
        VOLC_TTS_RESOURCE_ID_ICL1,
        VOLC_TTS_RESOURCE_ID_V2,
        VOLC_TTS_RESOURCE_ID_V1
    ].filter((x) => typeof x === 'string' && x.trim());
    return Array.from(new Set(candidates));
}

async function volcTtsV3ToBufferOnce({
    text,
    speaker,
    audioFormat,
    sampleRate,
    emotion,
    emotionScale,
    speedRatio,
    speedMode,
    resourceId
}) {
    const url = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional';
    const requestId = uuidv4();

    const payload = {
        user: { uid: 'user_1' },
        namespace: 'BidirectionalTTS',
        req_params: {
            text,
            speaker,
            audio_params: {
                format: audioFormat,
                sample_rate: sampleRate
            }
        }
    };

    if (VOLC_TTS_MODEL_V2 && resourceId === VOLC_TTS_RESOURCE_ID_V2) {
        payload.req_params.model = VOLC_TTS_MODEL_V2;
    }

    if (emotion) {
        payload.req_params.audio_params.emotion = emotion;
    }
    if (emotionScale) {
        payload.req_params.audio_params.emotion_scale = emotionScale;
    }
    if (typeof speedRatio === 'number' && Number.isFinite(speedRatio)) {
        if (speedMode === 'speed_ratio') {
            payload.req_params.audio_params.speed_ratio = speedRatio;
        } else if (speedMode === 'speech_rate') {
            payload.req_params.audio_params.speech_rate = speedRatioToSpeechRate(speedRatio);
        }
    }

    const headers = {
        'Content-Type': 'application/json',
        'X-Api-App-Id': VOLC_TTS_APP_ID,
        'X-Api-App-Key': VOLC_TTS_APP_ID,
        'X-Api-Access-Key': VOLC_TTS_ACCESS_TOKEN,
        'X-Api-Resource-Id': resourceId,
        'X-Api-Request-Id': requestId
    };

    const response = await axios.post(url, payload, {
        headers,
        responseType: 'stream',
        timeout: 120000,
        validateStatus: () => true
    });
    const ttLogId = response && response.headers ? (response.headers['x-tt-logid'] || response.headers['X-Tt-Logid']) : '';

    if (response.status < 200 || response.status >= 300) {
        const errText = await new Promise((resolve) => {
            let buf = '';
            response.data.on('data', (chunk) => {
                buf += chunk.toString('utf8');
                if (buf.length > 4000) {
                    buf = buf.slice(0, 4000);
                    response.data.destroy();
                }
            });
            response.data.on('end', () => resolve(buf));
            response.data.on('error', () => resolve(buf));
        });
        throw new Error(`TTS 请求失败(${response.status})${ttLogId ? ` logid=${ttLogId}` : ''}: ${errText || 'unknown'}`);
    }

    const audioBuffers = [];
    let textBuffer = '';
    let lastJson = null;

    await new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
            textBuffer += chunk.toString('utf8');
            const lines = textBuffer.split('\n');
            textBuffer = lines.pop() || '';

            for (const rawLine of lines) {
                const line = normalizeJsonLine(rawLine);
                if (!line) continue;
                let obj;
                try {
                    obj = JSON.parse(line);
                } catch {
                    continue;
                }
                lastJson = obj;
                const audioB64 = extractAudioBase64FromChunk(obj);
                if (typeof audioB64 === 'string' && audioB64.length > 0) {
                    try {
                        audioBuffers.push(Buffer.from(audioB64, 'base64'));
                    } catch {
                        continue;
                    }
                }
            }
        });
        response.data.on('end', resolve);
        response.data.on('error', reject);
    });

    if (textBuffer.trim()) {
        try {
            const obj = JSON.parse(normalizeJsonLine(textBuffer));
            lastJson = obj;
            const audioB64 = extractAudioBase64FromChunk(obj);
            if (typeof audioB64 === 'string' && audioB64.length > 0) {
                audioBuffers.push(Buffer.from(audioB64, 'base64'));
            }
        } catch {}
    }

    if (audioBuffers.length === 0) {
        const mismatch = isVolcResourceMismatchPayload(lastJson);
        throw new Error(`${mismatch ? 'TTS 资源ID与音色不匹配' : 'TTS 无音频数据返回'}${ttLogId ? ` logid=${ttLogId}` : ''}: ${lastJson ? JSON.stringify(lastJson).slice(0, 800) : 'empty'}`);
    }

    return Buffer.concat(audioBuffers);
}

async function volcTtsV3ToBuffer({
    text,
    speaker,
    audioFormat,
    sampleRate,
    emotion,
    emotionScale,
    speedRatio,
    speedMode
}) {
    const candidates = buildResourceIdCandidates(speaker);
    let lastError = null;

    for (const resourceId of candidates) {
        try {
            return await volcTtsV3ToBufferOnce({
                text,
                speaker,
                audioFormat,
                sampleRate,
                emotion,
                emotionScale,
                speedRatio,
                speedMode,
                resourceId
            });
        } catch (err) {
            lastError = err;
            const msg = String(err && err.message ? err.message : '');
            const mayBeMismatch = /resource ID is mismatched with speaker related resource/i.test(msg) || /资源ID与音色不匹配/.test(msg);
            if (mayBeMismatch) continue;
            throw err;
        }
    }

    if (lastError) throw lastError;
    throw new Error('TTS 请求失败: unknown');
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

            let dataPath = `/uploads/${file.filename}`;
            let filename = file.originalname;
            let size = file.size;
            let mimetype = file.mimetype;
            let originalData;
            let originalFilename;
            let originalSize;
            let originalMimetype;

            if (fileType === 'image' && isHeicLike({ mimetype: file.mimetype, filename: file.originalname })) {
                const convertedFilename = `${path.parse(file.filename).name}.jpg`;
                const outputPath = path.join(UPLOAD_DIR, convertedFilename);
                const stat = await convertHeicToJpeg(file.path, outputPath);
                if (stat) {
                    originalData = dataPath;
                    originalFilename = filename;
                    originalSize = size;
                    originalMimetype = mimetype;

                    dataPath = `/uploads/${convertedFilename}`;
                    filename = replaceFileExt(file.originalname, '.jpg');
                    size = stat.size;
                    mimetype = 'image/jpeg';
                }
            }
            
            const fileContent = {
                id: uuidv4(),
                type: fileType,
                text: text && files.length > 1 ? text.trim() : '',
                data: dataPath,
                filename,
                size,
                mimetype,
                originalData,
                originalFilename,
                originalSize,
                originalMimetype,
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

        const inputPath = path.join(__dirname, stripLeadingSlash(item.data));
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

        const inputPath = path.join(__dirname, stripLeadingSlash(item.data));
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

// 文本转语音 (TTS)
app.post('/api/tts', async (req, res) => {
    try {
        const { text, voice_type = 'zh_female_vv_uranus_bigtts', speed_ratio = 1.0, emotion, emotion_scale } = req.body;
        
        if (!text || !String(text).trim()) {
            return res.status(400).json({ success: false, message: '请提供文本内容' });
        }

        if (!VOLC_TTS_APP_ID || !VOLC_TTS_ACCESS_TOKEN) {
            return res.status(500).json({ success: false, message: '未配置火山引擎TTS鉴权信息' });
        }

        const reqId = uuidv4();
        const outputFilename = `tts-${reqId}.mp3`;
        const outputPath = path.join(UPLOAD_DIR, outputFilename);

        const speedRatioNumber = Math.max(0.5, Math.min(2.0, Number(speed_ratio)));
        const emotionScaleNumberRaw = Number(emotion_scale);
        const emotionScaleNumber = Number.isFinite(emotionScaleNumberRaw) && emotionScaleNumberRaw >= 1 && emotionScaleNumberRaw <= 5 ? emotionScaleNumberRaw : undefined;

        let audioBuffer;
        try {
            audioBuffer = await volcTtsV3ToBuffer({
                text: String(text).trim(),
                speaker: voice_type,
                audioFormat: 'mp3',
                sampleRate: 24000,
                emotion: typeof emotion === 'string' && emotion.trim() ? emotion.trim() : undefined,
                emotionScale: emotionScaleNumber,
                speedRatio: Number.isFinite(speedRatioNumber) ? speedRatioNumber : undefined,
                speedMode: 'speech_rate'
            });
        } catch (err) {
            const speedlessErr = String(err && err.message ? err.message : '');
            const mayBeUnknownParam = /unknown|invalid|not support|不支持|参数/i.test(speedlessErr);
            if (!mayBeUnknownParam) throw err;
            try {
                audioBuffer = await volcTtsV3ToBuffer({
                    text: String(text).trim(),
                    speaker: voice_type,
                    audioFormat: 'mp3',
                    sampleRate: 24000,
                    emotion: typeof emotion === 'string' && emotion.trim() ? emotion.trim() : undefined,
                    emotionScale: emotionScaleNumber,
                    speedRatio: Number.isFinite(speedRatioNumber) ? speedRatioNumber : undefined,
                    speedMode: 'speed_ratio'
                });
            } catch (err2) {
                audioBuffer = await volcTtsV3ToBuffer({
                    text: String(text).trim(),
                    speaker: voice_type,
                    audioFormat: 'mp3',
                    sampleRate: 24000,
                    emotion: typeof emotion === 'string' && emotion.trim() ? emotion.trim() : undefined,
                    emotionScale: emotionScaleNumber
                });
            }
        }

        await fs.writeFile(outputPath, audioBuffer);
        
        const stats = await fs.stat(outputPath);

        // 保存到数据库
        const contents = await readDataFile(CONTENTS_FILE);
        
        const displayText = String(text).trim();
        const displayPrefix = displayText.length > 80 ? `${displayText.slice(0, 80)}...` : displayText;

        const newAudioContent = {
            id: uuidv4(),
            type: 'audio',
            text: `[AI语音] ${displayPrefix}`,
            data: `/uploads/${outputFilename}`,
            filename: `tts-${displayText.slice(0, 10)}.mp3`,
            size: stats.size,
            mimetype: 'audio/mpeg',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        contents.unshift(newAudioContent);
        await writeDataFile(CONTENTS_FILE, contents);

        res.json({
            success: true,
            message: '语音生成成功',
            data: newAudioContent
        });

    } catch (error) {
        console.error('TTS 生成失败:', error && error.message ? error.message : error);
        const detail = error && error.message ? String(error.message) : '';
        const shouldExpose = /^TTS\s/.test(detail) || /logid=/.test(detail);
        res.status(500).json({ 
            success: false, 
            message: shouldExpose ? detail : '语音生成失败，请检查 API 配置或网络连接',
            error: detail || 'API Error'
        });
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

app.get('/api/tts/status', async (req, res) => {
    const mask = (s) => {
        if (!s) return '';
        const str = String(s);
        if (str.length <= 8) return '***';
        return `${str.slice(0, 3)}***${str.slice(-3)}`;
    };

    const effectiveAllowedSpeakerIds = await getEffectiveVoiceCloneAllowedSpeakerIds();

    res.json({
        success: true,
        data: {
            configured: Boolean(VOLC_TTS_APP_ID && VOLC_TTS_ACCESS_TOKEN),
            appId: mask(VOLC_TTS_APP_ID),
            accessToken: mask(VOLC_TTS_ACCESS_TOKEN),
            resourceIdV2: VOLC_TTS_RESOURCE_ID_V2,
            resourceIdV1: VOLC_TTS_RESOURCE_ID_V1,
            resourceIdIcl1: VOLC_TTS_RESOURCE_ID_ICL1,
            resourceIdIcl2: VOLC_TTS_RESOURCE_ID_ICL2,
            voiceCloneResourceId: VOLC_VOICECLONE_RESOURCE_ID,
            voiceCloneSpeakerId: VOLC_VOICECLONE_SPEAKER_ID,
            voiceCloneAllowedSpeakerIds: effectiveAllowedSpeakerIds,
            modelV2: VOLC_TTS_MODEL_V2 || ''
        }
    });
});

app.get('/api/tts/voices', async (req, res) => {
    try {
        const builtin = getBuiltInTtsVoices().map((v) => ({
            ...v,
            resourceId: getVolcResourceIdBySpeaker(v.id)
        }));
        const custom = await readCustomTtsVoices();
        const customWithResource = custom.map((v) => ({
            ...v,
            resourceId: getVolcResourceIdBySpeaker(v.id)
        }));

        res.json({
            success: true,
            data: {
                builtin,
                custom: customWithResource
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: '获取音色列表失败' });
    }
});

app.post('/api/tts/voices', async (req, res) => {
    try {
        const record = normalizeVoiceRecord(req.body || {});
        if (!record) {
            return res.status(400).json({ success: false, message: '音色信息不合法' });
        }

        const current = await readCustomTtsVoices();
        const existsIndex = current.findIndex((x) => x.id === record.id);
        if (existsIndex >= 0) {
            current[existsIndex] = { ...current[existsIndex], ...record };
        } else {
            current.unshift(record);
        }

        const saved = await writeCustomTtsVoices(current);
        res.json({ success: true, message: '已保存', data: saved });
    } catch (error) {
        res.status(500).json({ success: false, message: '保存音色失败' });
    }
});

app.delete('/api/tts/voices/:id', async (req, res) => {
    try {
        const id = typeof req.params.id === 'string' ? req.params.id.trim() : '';
        if (!id) return res.status(400).json({ success: false, message: '缺少音色ID' });
        const current = await readCustomTtsVoices();
        const next = current.filter((x) => x.id !== id);
        await writeCustomTtsVoices(next);
        res.json({ success: true, message: '已删除' });
    } catch (error) {
        res.status(500).json({ success: false, message: '删除音色失败' });
    }
});

function getVolcVoiceCloneResourceIdByModelType(modelType) {
    if (VOLC_VOICECLONE_RESOURCE_ID) return VOLC_VOICECLONE_RESOURCE_ID;
    const mt = Number(modelType);
    if (mt === 4) return VOLC_TTS_RESOURCE_ID_ICL2;
    return VOLC_TTS_RESOURCE_ID_ICL1;
}

async function volcVoiceClonePost({ url, resourceId, payload }) {
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer;${VOLC_TTS_ACCESS_TOKEN}`,
        'Resource-Id': resourceId
    };

    const resp = await axios.post(url, payload, {
        headers,
        timeout: 30000,
        validateStatus: () => true
    });

    if (resp.status >= 200 && resp.status < 300) return resp.data;

    const ttLogId = resp && resp.headers ? (resp.headers['x-tt-logid'] || resp.headers['X-Tt-Logid']) : '';
    const err = new Error(`Volc API 请求失败(${resp.status})${ttLogId ? ` logid=${ttLogId}` : ''}`);
    err.status = resp.status;
    err.ttLogId = ttLogId;
    err.data = resp.data;
    err.url = url;
    err.resourceId = resourceId;
    throw err;
}

app.post('/api/voice-clone/upload', async (req, res) => {
    try {
        if (!VOLC_TTS_APP_ID || !VOLC_TTS_ACCESS_TOKEN) {
            return res.status(500).json({ success: false, message: '未配置火山引擎鉴权信息' });
        }
        const effectiveAllowedSpeakerIds = await getEffectiveVoiceCloneAllowedSpeakerIds();

        const speakerId = typeof req.body.speaker_id === 'string' ? req.body.speaker_id.trim() : '';
        const audioBytes = typeof req.body.audio_bytes === 'string' ? req.body.audio_bytes.trim() : '';
        const audioFormat = typeof req.body.audio_format === 'string' ? req.body.audio_format.trim() : '';
        const modelTypeRaw = req.body.model_type;
        const modelType = Number.isFinite(Number(modelTypeRaw)) ? Number(modelTypeRaw) : 4;
        const languageRaw = req.body.language;
        const language = Number.isFinite(Number(languageRaw)) ? Number(languageRaw) : 0;
        const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
        const demoText = typeof req.body.demo_text === 'string' ? req.body.demo_text.trim() : '';
        const enableAudioDenoiseRaw = req.body.enable_audio_denoise;
        const enableAudioDenoise = typeof enableAudioDenoiseRaw === 'boolean' ? enableAudioDenoiseRaw : undefined;

        if (!speakerId) return res.status(400).json({ success: false, message: '缺少 speaker_id' });
        if (effectiveAllowedSpeakerIds.length > 0 && !effectiveAllowedSpeakerIds.includes(speakerId)) {
            return res.status(400).json({ success: false, message: 'speaker_id 不在允许列表中（请使用控制台提供的固定 speaker_id）' });
        }
        if (!audioBytes) return res.status(400).json({ success: false, message: '缺少音频数据' });
        if (!audioFormat) return res.status(400).json({ success: false, message: '缺少 audio_format' });

        const resourceId = getVolcVoiceCloneResourceIdByModelType(modelType);
        const extraParams = {};
        if (demoText) extraParams.demo_text = demoText;
        if (typeof enableAudioDenoise === 'boolean') {
            extraParams.enable_audio_denoise = enableAudioDenoise;
        } else {
            extraParams.enable_audio_denoise = modelType === 4 ? false : true;
        }

        const payload = {
            appid: String(VOLC_TTS_APP_ID),
            speaker_id: speakerId,
            audios: [{ audio_bytes: audioBytes, audio_format: audioFormat }],
            source: 2,
            language,
            model_type: modelType,
            extra_params: JSON.stringify(extraParams)
        };
        if (text) payload.text = text;

        const data = await volcVoiceClonePost({
            url: 'https://openspeech.bytedance.com/api/v1/mega_tts/audio/upload',
            resourceId,
            payload
        });

        res.json({ success: true, data });
    } catch (error) {
        const status = Number(error && (error.status || (error.response && error.response.status)) || 0);
        const data = error && (error.data || (error.response && error.response.data));
        const detail = data ? JSON.stringify(data) : (error && error.message ? String(error.message) : 'API Error');
        const licenseHint = (status === 403 && /license not found/i.test(detail)) ? '（无权限：请确认控制台已开通/购买声音复刻资源，并使用正确 Resource-Id：seed-icl-1.0 或 seed-icl-2.0）' : '';
        const authHint = (status === 401 || status === 403) ? '（鉴权失败：请确认使用控制台 Access Token 配置 VOLC_TTS_ACCESS_TOKEN，并正确设置 VOLC_TTS_APP_ID）' : '';
        res.status(500).json({
            success: false,
            message: `声音复刻上传失败${licenseHint || authHint}`,
            error: detail,
            meta: {
                status,
                logid: error && error.ttLogId ? String(error.ttLogId) : '',
                resourceId: error && error.resourceId ? String(error.resourceId) : '',
                url: error && error.url ? String(error.url) : ''
            }
        });
    }
});

app.post('/api/voice-clone/status', async (req, res) => {
    try {
        if (!VOLC_TTS_APP_ID || !VOLC_TTS_ACCESS_TOKEN) {
            return res.status(500).json({ success: false, message: '未配置火山引擎鉴权信息' });
        }
        const effectiveAllowedSpeakerIds = await getEffectiveVoiceCloneAllowedSpeakerIds();

        const speakerId = typeof req.body.speaker_id === 'string' ? req.body.speaker_id.trim() : '';
        const modelTypeRaw = req.body.model_type;
        const modelType = Number.isFinite(Number(modelTypeRaw)) ? Number(modelTypeRaw) : 4;
        if (!speakerId) return res.status(400).json({ success: false, message: '缺少 speaker_id' });
        if (effectiveAllowedSpeakerIds.length > 0 && !effectiveAllowedSpeakerIds.includes(speakerId)) {
            return res.status(400).json({ success: false, message: 'speaker_id 不在允许列表中（请使用控制台提供的固定 speaker_id）' });
        }

        const resourceId = getVolcVoiceCloneResourceIdByModelType(modelType);
        const payload = { appid: String(VOLC_TTS_APP_ID), speaker_id: speakerId };
        const data = await volcVoiceClonePost({
            url: 'https://openspeech.bytedance.com/api/v1/mega_tts/status',
            resourceId,
            payload
        });

        res.json({ success: true, data });
    } catch (error) {
        const status = Number(error && (error.status || (error.response && error.response.status)) || 0);
        const data = error && (error.data || (error.response && error.response.data));
        const detail = data ? JSON.stringify(data) : (error && error.message ? String(error.message) : 'API Error');
        const licenseHint = (status === 403 && /license not found/i.test(detail)) ? '（无权限：请确认控制台已开通/购买声音复刻资源，并使用正确 Resource-Id：seed-icl-1.0 或 seed-icl-2.0）' : '';
        const authHint = (status === 401 || status === 403) ? '（鉴权失败：请确认使用控制台 Access Token 配置 VOLC_TTS_ACCESS_TOKEN，并正确设置 VOLC_TTS_APP_ID）' : '';
        res.status(500).json({
            success: false,
            message: `获取复刻状态失败${licenseHint || authHint}`,
            error: detail,
            meta: {
                status,
                logid: error && error.ttLogId ? String(error.ttLogId) : '',
                resourceId: error && error.resourceId ? String(error.resourceId) : '',
                url: error && error.url ? String(error.url) : ''
            }
        });
    }
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
    migrateHeicImages().catch((err) => {
        console.error('HEIC 迁移执行失败:', err);
    });
    
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
