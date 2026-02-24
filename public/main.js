// 多媒体分享平台核心JavaScript逻辑 - 后端版本
// 版本: v2.0.0

class MediaShareApp {
    constructor() {
        this.currentPage = this.getCurrentPage();
        this.contents = [];
        this.deletedContents = [];
        this.settings = this.loadSettings();
        this.selectedItems = new Set();
        this.currentFilter = 'all';
        this.currentSort = 'newest';
        this.currentContentId = null;
        this.isOnline = navigator.onLine;
        this.apiBase = '/api';
        this.filesToUpload = []; // 用于存储待上传的文件对象
        this.voiceClonePollTimer = null;
        this.voiceClonePollingSpeakerId = '';
        this.voiceClonePollingModelType = 4;
        this.voiceCloneAllowedSpeakerIds = [];
        this.voiceCloneIsRecording = false;
        this.voiceCloneRecordedBase64 = '';
        this.voiceCloneRecordedBlobUrl = '';
        this.voiceCloneRecordingState = null;
        this.uploadLimitDirty = false;
        
        this.init();
    }
    
    // 初始化应用
    async init() {
        this.setupEventListeners();
        this.setupNetworkListeners();
        this.applySettings();
        
        if (this.currentPage === 'index') {
            await this.initIndexPage();
        } else if (this.currentPage === 'tts') {
            await this.initTtsPage();
        } else if (this.currentPage === 'history') {
            await this.initHistoryPage();
        } else if (this.currentPage === 'settings') {
            await this.initSettingsPage();
        }
    }
    
    // 获取当前页面
    getCurrentPage() {
        const path = window.location.pathname;
        if (path.includes('tts.html')) return 'tts';
        if (path.includes('history.html')) return 'history';
        if (path.includes('settings.html')) return 'settings';
        return 'index';
    }

    svgIcon(name, className) {
        const attrs = `class="${className}" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"`;
        switch (name) {
            case 'trash':
                return `<svg ${attrs}><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>`;
            case 'download':
                return `<svg ${attrs}><path d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>`;
            case 'copy':
                return `<svg ${attrs}><path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path></svg>`;
            case 'bolt':
                return `<svg ${attrs}><path d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>`;
            case 'video':
                return `<svg ${attrs}><path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>`;
            case 'file':
                return `<svg ${attrs}><path d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>`;
            case 'music':
                return `<svg ${attrs}><path d="M9 18V6l12-2v12"></path><circle cx="7.5" cy="18.5" r="2.5"></circle><circle cx="19.5" cy="16.5" r="2.5"></circle></svg>`;
            default:
                return '';
        }
    }

    handleImageLoadError(img) {
        if (!img || img.dataset.fallbackApplied === '1') return;
        img.dataset.fallbackApplied = '1';

        const src = img.getAttribute('src') || '';
        const container = img.parentElement;
        if (!container) return;

        img.classList.add('hidden');

        const overlay = document.createElement('div');
        overlay.className = 'absolute inset-0 flex flex-col items-center justify-center bg-gray-100 text-gray-500 text-xs p-4';

        const title = document.createElement('div');
        title.className = 'font-medium text-gray-600';
        title.textContent = '图片无法预览（可能是 HEIC 格式）';

        const tip = document.createElement('div');
        tip.className = 'text-gray-500';
        tip.textContent = '可点击下载或重新上传为 JPG/PNG';

        const link = document.createElement('a');
        link.href = src;
        link.className = 'mt-2 px-3 py-2 bg-white rounded-lg shadow-sm border border-gray-200 text-blue-600';
        link.textContent = '下载原文件';
        link.setAttribute('download', '');

        overlay.appendChild(title);
        overlay.appendChild(tip);
        overlay.appendChild(link);
        container.appendChild(overlay);
    }
    
    // 设置网络状态监听器
    setupNetworkListeners() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.updateOnlineStatus();
            this.showNotification('网络连接已恢复', 'success');
        });
        
        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.updateOnlineStatus();
            this.showNotification('网络连接已断开，进入离线模式', 'warning');
        });
    }
    
    // 更新在线状态显示
    updateOnlineStatus() {
        const indicator = document.getElementById('offlineIndicator');
        if (indicator) {
            if (this.isOnline) {
                indicator.classList.add('hidden');
            } else {
                indicator.classList.remove('hidden');
            }
        }
    }
    
    // 设置事件监听器
    setupEventListeners() {
        document.addEventListener('DOMContentLoaded', () => {
            this.updateUI();
        });
        
        if (this.currentPage === 'index') {
            this.setupIndexEventListeners();
        } else if (this.currentPage === 'tts') {
            this.setupTtsEventListeners();
        } else if (this.currentPage === 'history') {
            this.setupHistoryEventListeners();
        } else if (this.currentPage === 'settings') {
            this.setupSettingsEventListeners();
        }
    }
    
    // 首页事件监听器
    setupIndexEventListeners() {
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshContent());
        }
        
        const mediaInput = document.getElementById('mediaInput');
        const fileInput = document.getElementById('fileInput');
        const uploadArea = document.getElementById('uploadArea');
        const textInput = document.getElementById('textInput');
        const composerPlaceholder = document.getElementById('composerPlaceholder');
        const chooseMediaBtn = document.getElementById('chooseMediaBtn');
        const chooseFileBtn = document.getElementById('chooseFileBtn');
        
        const syncComposerMode = ({ forceInputVisible } = {}) => {
            if (!textInput) return;
            const hasText = typeof textInput.value === 'string' && textInput.value.trim().length > 0;
            const hasFiles = Array.isArray(this.filesToUpload) && this.filesToUpload.some(f => f);
            const shouldShowInput = !!forceInputVisible || hasText || hasFiles;

            if (shouldShowInput) {
                textInput.classList.remove('hidden');
                if (composerPlaceholder) composerPlaceholder.classList.add('hidden');
            } else {
                textInput.classList.add('hidden');
                if (composerPlaceholder) composerPlaceholder.classList.remove('hidden');
            }
        };

        if (uploadArea) {
            uploadArea.addEventListener('click', (e) => {
                const target = e && e.target ? e.target : null;
                if (target && target.closest && target.closest('#textInput')) return;
                syncComposerMode({ forceInputVisible: true });
                if (textInput) textInput.focus();
            });
            uploadArea.addEventListener('dragover', (e) => this.handleDragOver(e));
            uploadArea.addEventListener('drop', (e) => this.handleDrop(e));
        }

        if (mediaInput) {
            mediaInput.addEventListener('change', (e) => this.handleFileSelect(e));
        }
        if (fileInput) {
            fileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        }

        const bindPress = (el, handler) => {
            if (!el) return;
            let lastTriggerAt = 0;
            const wrapped = (e) => {
                if (e) {
                    if (e.cancelable) e.preventDefault();
                    if (e.stopPropagation) e.stopPropagation();
                }
                const now = Date.now();
                if (now - lastTriggerAt < 700) return;
                lastTriggerAt = now;
                handler(e);
            };

            const hasPointer = typeof window !== 'undefined' && 'PointerEvent' in window;
            if (hasPointer) {
                el.addEventListener('pointerup', wrapped);
                el.addEventListener('click', wrapped);
            } else {
                el.addEventListener('touchend', wrapped, { passive: false });
                el.addEventListener('click', wrapped);
            }
        };

        bindPress(chooseMediaBtn, (e) => {
            if (mediaInput) mediaInput.click();
        });

        bindPress(chooseFileBtn, (e) => {
            if (fileInput) fileInput.click();
        });
        
        const publishBtn = document.getElementById('publishBtn');
        if (publishBtn) {
            publishBtn.addEventListener('click', () => this.publishContent());
        }

        if (textInput) {
            textInput.addEventListener('input', () => syncComposerMode());
            textInput.addEventListener('blur', () => syncComposerMode());
        }
        syncComposerMode();
        
        const filterBtns = document.querySelectorAll('.filter-btn');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => this.handleFilter(e));
        });
        
        const sortSelect = document.getElementById('sortSelect');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => this.handleSort(e));
        }
        
        const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        if (confirmDeleteBtn) {
            confirmDeleteBtn.addEventListener('click', () => this.confirmDelete());
        }

        // TTS 监听器
        const openTTSBtn = document.getElementById('openTTSBtn');
        if (openTTSBtn) {
            openTTSBtn.addEventListener('click', () => {
                const textInput = document.getElementById('textInput');
                const text = textInput && typeof textInput.value === 'string' ? textInput.value.trim() : '';
                const url = text ? `/tts.html?text=${encodeURIComponent(text)}` : '/tts.html';
                window.location.href = url;
            });
        }
    }

    setupTtsEventListeners() {
        const generateTTSBtn = document.getElementById('generateTTSBtn');
        if (generateTTSBtn) {
            generateTTSBtn.addEventListener('click', () => this.generateTTS());
        }

        const ttsSpeedRange = document.getElementById('ttsSpeedRange');
        if (ttsSpeedRange) {
            ttsSpeedRange.addEventListener('input', (e) => {
                const speedValue = document.getElementById('speedValue');
                if (speedValue) speedValue.textContent = e.target.value;
            });
        }

        const refreshTTSVoicesBtn = document.getElementById('refreshTTSVoicesBtn');
        if (refreshTTSVoicesBtn) {
            refreshTTSVoicesBtn.addEventListener('click', () => this.refreshTtsVoices());
        }

        const addTTSVoiceBtn = document.getElementById('addTTSVoiceBtn');
        if (addTTSVoiceBtn) {
            addTTSVoiceBtn.addEventListener('click', () => this.addTtsVoice());
        }

        const vcGenerateIdBtn = document.getElementById('vcGenerateIdBtn');
        if (vcGenerateIdBtn) {
            vcGenerateIdBtn.addEventListener('click', async () => {
                await this.fillVoiceCloneSpeakerId({ force: true });
            });
        }

        const vcSpeakerSelect = document.getElementById('vcSpeakerSelect');
        if (vcSpeakerSelect) {
            vcSpeakerSelect.addEventListener('change', (e) => {
                const input = document.getElementById('vcSpeakerId');
                if (!input) return;
                const value = e && e.target ? String(e.target.value || '').trim() : '';
                if (value) input.value = value;
            });
        }

        const vcRecordBtn = document.getElementById('vcRecordBtn');
        if (vcRecordBtn) {
            vcRecordBtn.addEventListener('click', () => this.toggleVoiceCloneRecording());
        }

        const vcUploadBtn = document.getElementById('vcUploadBtn');
        if (vcUploadBtn) {
            vcUploadBtn.addEventListener('click', () => this.uploadVoiceClone());
        }

        const vcStatusBtn = document.getElementById('vcStatusBtn');
        if (vcStatusBtn) {
            vcStatusBtn.addEventListener('click', () => this.fetchVoiceCloneStatus({ startPolling: false }));
        }

        const asrRefreshUploadedBtn = document.getElementById('asrRefreshUploadedBtn');
        if (asrRefreshUploadedBtn) {
            asrRefreshUploadedBtn.addEventListener('click', () => this.loadAsrUploadedAudios({ silent: false }));
        }

        const asrUploadRecognizeBtn = document.getElementById('asrUploadRecognizeBtn');
        if (asrUploadRecognizeBtn) {
            asrUploadRecognizeBtn.addEventListener('click', () => this.asrUploadAndRecognize());
        }

        const asrRecognizeSelectedBtn = document.getElementById('asrRecognizeSelectedBtn');
        if (asrRecognizeSelectedBtn) {
            asrRecognizeSelectedBtn.addEventListener('click', () => this.asrRecognizeSelected());
        }

        const asrCopyBtn = document.getElementById('asrCopyBtn');
        if (asrCopyBtn) {
            asrCopyBtn.addEventListener('click', (e) => {
                const ta = document.getElementById('asrResultText');
                this.copyText(ta && typeof ta.value === 'string' ? ta.value : '', e);
            });
        }

        const asrPublishBtn = document.getElementById('asrPublishBtn');
        if (asrPublishBtn) {
            asrPublishBtn.addEventListener('click', () => this.asrPublishToHome());
        }
    }

    async initTtsPage() {
        const params = new URLSearchParams(window.location.search || '');
        const text = params.get('text');
        const ttsTextInput = document.getElementById('ttsTextInput');
        if (ttsTextInput && typeof text === 'string' && text.trim()) {
            ttsTextInput.value = text.trim();
        }
        await this.refreshTtsVoices({ silent: true });
        await this.fillVoiceCloneSpeakerId({ force: false });
        this.initAsrPublicBaseUrlUI();
        await this.loadAsrUploadedAudios({ silent: true });
    }

    normalizePublicBaseUrl(value) {
        const raw = typeof value === 'string' ? value.trim() : '';
        if (!raw) return '';
        const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
        try {
            const u = new URL(withScheme);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
            if (!u.hostname) return '';
            return u.origin;
        } catch {
            return '';
        }
    }

    initAsrPublicBaseUrlUI() {
        const input = document.getElementById('asrPublicBaseUrl');
        const hint = document.getElementById('asrPublicBaseUrlHint');
        const saveBtn = document.getElementById('asrSavePublicBaseUrlBtn');
        if (!input) return;

        const existing = this.normalizePublicBaseUrl(this.settings.asrPublicBaseUrl);
        const fallback = this.normalizePublicBaseUrl(window.location.origin || '');
        input.value = existing || fallback;
        if (hint) hint.textContent = existing ? '已保存' : '默认使用当前访问域名';

        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                const norm = this.normalizePublicBaseUrl(input.value);
                if (!norm) {
                    this.showNotification('域名格式无效', 'error');
                    if (hint) hint.textContent = '域名格式无效';
                    return;
                }
                this.settings.asrPublicBaseUrl = norm;
                this.saveSettings();
                if (hint) hint.textContent = '已保存';
                this.showNotification('域名已保存', 'success');
            });
        }
    }

    setAsrStatus(text) {
        const el = document.getElementById('asrStatusText');
        if (!el) return;
        el.textContent = text || '';
    }

    async loadAsrUploadedAudios({ silent } = {}) {
        const select = document.getElementById('asrUploadedSelect');
        if (!select) return;
        try {
            if (!silent) this.setAsrStatus('加载音频列表中...');
            const resp = await this.apiRequest('/contents');
            const items = Array.isArray(resp && resp.data) ? resp.data : [];
            const audios = items.filter((x) => x && x.type === 'audio' && typeof x.data === 'string' && x.data.startsWith('/uploads/'));

            select.innerHTML = '';
            const opt0 = document.createElement('option');
            opt0.value = '';
            opt0.textContent = audios.length ? '请选择音频...' : '暂无已上传音频';
            select.appendChild(opt0);

            for (const a of audios) {
                const name = typeof a.filename === 'string' && a.filename.trim() ? a.filename.trim() : (a.data.split('/').pop() || 'audio');
                const size = Number.isFinite(Number(a.size)) ? this.formatFileSize(Number(a.size)) : '';
                const time = typeof a.createdAt === 'string' ? a.createdAt : '';
                const label = [name, size, time ? this.getTimeAgo(time) : ''].filter(Boolean).join(' · ');
                const opt = document.createElement('option');
                opt.value = a.data;
                opt.textContent = label;
                opt.dataset.filename = name;
                opt.dataset.mimetype = typeof a.mimetype === 'string' ? a.mimetype : '';
                select.appendChild(opt);
            }

            if (!silent) this.setAsrStatus(audios.length ? `已加载 ${audios.length} 条音频` : '暂无已上传音频');
        } catch (err) {
            if (!silent) this.setAsrStatus('加载音频列表失败');
        }
    }

    inferAucFormatFromNameOrType(name, mimetype) {
        const fn = typeof name === 'string' ? name.toLowerCase() : '';
        const mt = typeof mimetype === 'string' ? mimetype.toLowerCase() : '';
        if (fn.endsWith('.wav') || mt.includes('wav')) return 'wav';
        if (fn.endsWith('.mp3') || mt.includes('mpeg')) return 'mp3';
        if (fn.endsWith('.ogg') || mt.includes('ogg')) return 'ogg';
        if (fn.endsWith('.opus') || mt.includes('opus')) return 'ogg';
        return 'mp3';
    }

    async asrUploadAndRecognize() {
        const input = document.getElementById('asrFileInput');
        const file = input && input.files && input.files[0] ? input.files[0] : null;
        if (!file) {
            this.showNotification('请选择音频文件', 'warning');
            return;
        }

        const btn = document.getElementById('asrUploadRecognizeBtn');
        if (btn) btn.disabled = true;
        this.setAsrStatus('上传中...');
        try {
            const fd = new FormData();
            fd.append('file', file);
            const resp = await fetch(`${this.apiBase}/asr/upload`, { method: 'POST', body: fd });
            const json = await resp.json().catch(() => null);
            if (!resp.ok || !json || json.success !== true) {
                const msg = json && json.message ? String(json.message) : '上传失败';
                throw new Error(msg);
            }
            const data = json.data || {};
            const audioPath = typeof data.path === 'string' ? data.path : '';
            const format = typeof data.format === 'string' ? data.format : this.inferAucFormatFromNameOrType(file.name, file.type);
            await this.asrStartRecognize({ audio: audioPath, format, filename: file.name, mimetype: file.type });
            await this.loadAsrUploadedAudios({ silent: true });
        } catch (err) {
            const msg = err && err.message ? String(err.message) : '上传失败';
            this.setAsrStatus(msg);
            this.showNotification(msg, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async asrRecognizeSelected() {
        const select = document.getElementById('asrUploadedSelect');
        if (!select) return;
        const audio = typeof select.value === 'string' ? select.value : '';
        if (!audio) {
            this.showNotification('请选择已上传音频', 'warning');
            return;
        }
        const opt = select.options && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
        const filename = opt && opt.dataset ? opt.dataset.filename : '';
        const mimetype = opt && opt.dataset ? opt.dataset.mimetype : '';
        const format = this.inferAucFormatFromNameOrType(filename, mimetype);
        const btn = document.getElementById('asrRecognizeSelectedBtn');
        if (btn) btn.disabled = true;
        try {
            await this.asrStartRecognize({ audio, format, filename, mimetype });
        } catch (err) {
            const msgRaw = err && err.message ? String(err.message) : '识别失败';
            const msg = /requested resource not granted/i.test(msgRaw)
                ? '火山录音识别资源未开通/未授权，请在控制台开通后重试（AUC 录音识别）'
                : msgRaw;
            this.setAsrStatus(msg);
            this.showNotification(msg, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    async asrStartRecognize({ audio, format }) {
        const languageInput = document.getElementById('asrLanguage');
        const language = languageInput && typeof languageInput.value === 'string' ? languageInput.value.trim() : '';
        const result = document.getElementById('asrResultText');
        if (result) result.value = '';
        this.setAsrStatus('提交识别任务中...');

        const publicBaseUrlInput = document.getElementById('asrPublicBaseUrl');
        const publicBaseUrlFromUI = publicBaseUrlInput && typeof publicBaseUrlInput.value === 'string' ? publicBaseUrlInput.value.trim() : '';
        const publicBaseUrl = this.normalizePublicBaseUrl(publicBaseUrlFromUI) || this.normalizePublicBaseUrl(this.settings.asrPublicBaseUrl) || '';

        let submit;
        try {
            submit = await this.apiRequest('/asr/submit', {
                method: 'POST',
                body: JSON.stringify({ audio, format, language, publicBaseUrl })
            });
        } catch (err) {
            const msgRaw = err && err.message ? String(err.message) : '提交识别任务失败';
            const msg = /requested resource not granted/i.test(msgRaw)
                ? '火山录音识别资源未开通/未授权，请在控制台开通后重试（AUC 录音识别）'
                : msgRaw;
            this.setAsrStatus(msg);
            throw new Error(msg);
        }

        const taskId = submit && submit.data && typeof submit.data.taskId === 'string' ? submit.data.taskId : '';
        if (!taskId) throw new Error('提交失败');

        this.setAsrStatus('识别中...');
        const startedAt = Date.now();
        const maxMs = 6 * 60 * 1000;

        while (true) {
            if (Date.now() - startedAt > maxMs) throw new Error('识别超时，请稍后重试');
            await new Promise((r) => setTimeout(r, 2000));
            const q = await this.apiRequest('/asr/query', {
                method: 'POST',
                body: JSON.stringify({ taskId })
            });
            const statusCode = q && q.data && typeof q.data.statusCode === 'string' ? q.data.statusCode : '';
            if (q.success === true && statusCode === '20000000') {
                const text = q.data && typeof q.data.text === 'string' ? q.data.text : '';
                if (result) result.value = text || '';
                this.setAsrStatus('识别完成');
                this.showNotification('识别完成', 'success');
                return;
            }
            if (q.success === true && (statusCode === '20000001' || statusCode === '20000002')) {
                this.setAsrStatus('识别中...');
                continue;
            }
            const msg = q && typeof q.message === 'string' && q.message.trim() ? q.message.trim() : '识别失败';
            throw new Error(msg);
        }
    }

    async asrPublishToHome() {
        if (!this.isOnline) {
            this.showNotification('离线模式下无法发布内容', 'warning');
            return;
        }

        const ta = document.getElementById('asrResultText');
        const text = ta && typeof ta.value === 'string' ? ta.value.trim() : '';
        if (!text) {
            this.showNotification('识别结果为空，无法发布', 'warning');
            return;
        }

        const btn = document.getElementById('asrPublishBtn');
        if (btn) btn.disabled = true;
        this.setAsrStatus('发布中...');

        try {
            const fd = new FormData();
            fd.append('text', text);

            const resp = await fetch(`${this.apiBase}/contents`, {
                method: 'POST',
                body: fd
            });
            const json = await resp.json().catch(() => null);
            if (!resp.ok || !json || json.success !== true) {
                const msg = json && json.message ? String(json.message) : '发布失败';
                throw new Error(msg);
            }

            this.setAsrStatus('已发布到首页');
            this.showNotification('已发布到首页', 'success');
        } catch (err) {
            const msg = err && err.message ? String(err.message) : '发布失败';
            this.setAsrStatus(msg);
            this.showNotification(msg, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }
    
    // 历史页面事件监听器
    setupHistoryEventListeners() {
        const header = document.querySelector('header');
        if (header) {
            document.documentElement.style.setProperty('--history-header-h', `${Math.ceil(header.getBoundingClientRect().height)}px`);
        }

        const selectAllBtn = document.getElementById('selectAllBtn');
        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', () => this.toggleSelectAll());
        }
        
        const batchDeleteBtn = document.getElementById('batchDeleteBtn');
        if (batchDeleteBtn) {
            batchDeleteBtn.addEventListener('click', () => this.showDeletePermanentModal());
        }
        
        const batchRestoreBtn = document.getElementById('batchRestoreBtn');
        if (batchRestoreBtn) {
            batchRestoreBtn.addEventListener('click', () => this.showRestoreModal());
        }
        
        const clearSelectionBtn = document.getElementById('clearSelectionBtn');
        if (clearSelectionBtn) {
            clearSelectionBtn.addEventListener('click', () => this.clearSelection());
        }
        
        const filterBtns = document.querySelectorAll('.filter-btn');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', (e) => this.handleFilter(e));
        });
        
        const sortSelect = document.getElementById('sortSelect');
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => this.handleSort(e));
        }
        
        const confirmRestoreBtn = document.getElementById('confirmRestoreBtn');
        if (confirmRestoreBtn) {
            confirmRestoreBtn.addEventListener('click', () => this.batchRestore());
        }
        
        const confirmDeletePermanentBtn = document.getElementById('confirmDeletePermanentBtn');
        if (confirmDeletePermanentBtn) {
            confirmDeletePermanentBtn.addEventListener('click', () => this.batchDeletePermanent());
        }
    }
    
    // 设置页面事件监听器
    setupSettingsEventListeners() {
        const toggles = {
            'autoRefreshToggle': (value) => this.updateSetting('autoRefresh', value),
            'autoCleanupToggle': (value) => this.updateSetting('autoCleanup', value),
            'darkModeToggle': (value) => this.toggleDarkMode(value),
            'soundToggle': (value) => this.updateSetting('soundEnabled', value),
            'vibrationToggle': (value) => this.updateSetting('vibrationEnabled', value)
        };
        
        Object.entries(toggles).forEach(([id, handler]) => {
            const toggle = document.getElementById(id);
            if (toggle) {
                toggle.addEventListener('change', (e) => handler(e.target.checked));
            }
        });
        
        const refreshInterval = document.getElementById('refreshInterval');
        if (refreshInterval) {
            refreshInterval.addEventListener('change', (e) => {
                this.updateSetting('refreshInterval', parseInt(e.target.value));
            });
        }
        
        const cleanupPeriod = document.getElementById('cleanupPeriod');
        if (cleanupPeriod) {
            cleanupPeriod.addEventListener('change', (e) => {
                this.updateSetting('cleanupPeriod', parseInt(e.target.value));
            });
        }

        const uploadMaxSize = document.getElementById('uploadMaxSize');
        const uploadMaxSizeHint = document.getElementById('uploadMaxSizeHint');
        const saveUploadLimitBtn = document.getElementById('saveUploadLimitBtn');
        if (uploadMaxSize) {
            uploadMaxSize.addEventListener('change', (e) => {
                const mb = parseInt(e.target.value);
                if (!Number.isFinite(mb) || mb <= 0) return;
                this.settings.uploadMaxSizeMB = mb;
                this.saveSettings();
                this.uploadLimitDirty = true;
                if (uploadMaxSizeHint) uploadMaxSizeHint.textContent = '未保存';
                if (saveUploadLimitBtn) saveUploadLimitBtn.disabled = false;
            });
        }
        if (saveUploadLimitBtn) {
            saveUploadLimitBtn.addEventListener('click', async () => {
                const mb = Number.isFinite(Number(this.settings.uploadMaxSizeMB)) ? Number(this.settings.uploadMaxSizeMB) : NaN;
                if (!Number.isFinite(mb) || mb <= 0) return;
                saveUploadLimitBtn.disabled = true;
                if (uploadMaxSizeHint) uploadMaxSizeHint.textContent = '保存中...';
                try {
                    const resp = await this.apiRequest('/settings/upload', {
                        method: 'POST',
                        body: JSON.stringify({ maxUploadSizeMB: mb })
                    });
                    const saved = resp && resp.data && Number.isFinite(Number(resp.data.maxUploadSizeMB)) ? Number(resp.data.maxUploadSizeMB) : mb;
                    this.settings.uploadMaxSizeMB = Math.round(saved);
                    this.saveSettings();
                    this.uploadLimitDirty = false;
                    if (uploadMaxSizeHint) uploadMaxSizeHint.textContent = '已保存';
                    this.showNotification('上传大小限制已保存', 'success');
                } catch (err) {
                    this.uploadLimitDirty = true;
                    if (uploadMaxSizeHint) uploadMaxSizeHint.textContent = '保存失败';
                    saveUploadLimitBtn.disabled = false;
                    const msg = err && err.message ? String(err.message) : '保存失败';
                    this.showNotification(msg, 'error');
                }
            });
        }
        
        const clearCacheBtn = document.getElementById('clearCacheBtn');
        if (clearCacheBtn) {
            clearCacheBtn.addEventListener('click', () => this.clearCache());
        }
        
        const exportDataBtn = document.getElementById('exportDataBtn');
        if (exportDataBtn) {
            exportDataBtn.addEventListener('click', () => this.exportData());
        }
        
        const importDataBtn = document.getElementById('importDataBtn');
        if (importDataBtn) {
            importDataBtn.addEventListener('click', () => this.showImportDialog());
        }
        
        const importFileInput = document.getElementById('importFileInput');
        if (importFileInput) {
            importFileInput.addEventListener('change', (e) => this.importData(e));
        }
        
        const resetAllBtn = document.getElementById('resetAllBtn');
        if (resetAllBtn) {
            resetAllBtn.addEventListener('click', () => this.showResetConfirm());
        }
        
        const confirmActionBtn = document.getElementById('confirmActionBtn');
        if (confirmActionBtn) {
            confirmActionBtn.addEventListener('click', () => this.executeConfirmAction());
        }
    }
    
    // 初始化首页
    async initIndexPage() {
        await this.loadContents();
        this.renderContents();
        this.startAutoRefresh();
    }
    
    // 初始化历史页面
    async initHistoryPage() {
        await this.loadDeletedContents();
        this.renderDeletedContents();
        this.updateStatistics();
    }
    
    // 初始化设置页面
    async initSettingsPage() {
        await this.loadUploadLimitFromServer();
        this.loadSettingsUI();
        this.updateStorageInfo();
        this.syncCleanupSettings(); // 页面加载时同步一次
    }
    
    // API请求方法
    async apiRequest(endpoint, options = {}) {
        const url = `${this.apiBase}${endpoint}`;
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
            },
        };
        
        const config = {
            ...defaultOptions,
            ...options,
            headers: {
                ...defaultOptions.headers,
                ...options.headers,
            },
        };
        
        try {
            const response = await fetch(url, config);
            const data = await response.json();
            
            if (!response.ok) {
                const detail = data && (data.error || data.detail) ? String(data.error || data.detail) : '';
                const msg = data && data.message ? String(data.message) : '请求失败';
                throw new Error(detail && !msg.includes(detail) ? `${msg}: ${detail}` : msg);
            }
            
            return data;
        } catch (error) {
            console.error('API请求失败:', error);
            throw error;
        }
    }
    
    // 加载内容
    async loadContents() {
        try {
            this.showLoading(true);
            const response = await this.apiRequest('/contents');
            this.contents = response.data || [];
        } catch (error) {
            console.error('加载内容失败:', error);
            this.showNotification('加载内容失败', 'error');
            this.contents = [];
        } finally {
            this.showLoading(false);
        }
    }
    
    // 加载已删除内容
    async loadDeletedContents() {
        try {
            this.showLoading(true);
            const response = await this.apiRequest('/deleted');
            this.deletedContents = response.data || [];
        } catch (error) {
            console.error('加载已删除内容失败:', error);
            this.showNotification('加载已删除内容失败', 'error');
            this.deletedContents = [];
        } finally {
            this.showLoading(false);
        }
    }
    
    // 显示/隐藏加载状态
    showLoading(show) {
        const loadingState = document.getElementById('loadingState');
        const contentGrid = document.getElementById('contentGrid');
        
        if (loadingState && contentGrid) {
            if (show) {
                loadingState.classList.remove('hidden');
                contentGrid.style.display = 'none';
            } else {
                loadingState.classList.add('hidden');
                contentGrid.style.display = 'block';
            }
        }
    }
    
    // 刷新内容
    async refreshContent() {
        if (!this.isOnline) {
            this.showNotification('离线模式下无法刷新内容', 'warning');
            return;
        }
        
        try {
            this.showLoading(true);
            await this.loadContents();
            this.renderContents();
            this.showNotification('内容刷新成功', 'success');
        } catch (error) {
            console.error('刷新内容失败:', error);
            this.showNotification('刷新内容失败', 'error');
        } finally {
            this.showLoading(false);
        }
    }
    
    // 发布内容
    async publishContent() {
        if (!this.isOnline) {
            this.showNotification('离线模式下无法发布内容', 'warning');
            return;
        }
        
        const textInput = document.getElementById('textInput');
        const uploadProgress = document.getElementById('uploadProgress');
        const progressBar = uploadProgress ? uploadProgress.querySelector('.upload-progress-bar') : null;
        
        const text = textInput ? textInput.value.trim() : '';
        
        if (!text && this.filesToUpload.length === 0) {
            this.showNotification('请输入内容或选择文件', 'warning');
            return;
        }
        
        try {
            // 显示上传进度
            if (uploadProgress) {
                uploadProgress.classList.remove('hidden');
                if (progressBar) progressBar.style.width = '0%';
            }
            
            const formData = new FormData();
            
            // 添加文本
            if (text) {
                formData.append('text', text);
            }
            
            // 使用内部维护的文件列表
            if (this.filesToUpload.length > 0) {
                for (const file of this.filesToUpload) {
                    if (!file) continue;
                    formData.append('files', file);
                }
            }
            
            // 发送请求
            const response = await fetch(`${this.apiBase}/contents`, {
                method: 'POST',
                body: formData
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.message || '发布失败');
            }
            
            // 清空输入
            if (textInput) textInput.value = '';
            this.filesToUpload = [];
            const mediaInput = document.getElementById('mediaInput');
            if (mediaInput) mediaInput.value = '';
            const fileInput = document.getElementById('fileInput');
            if (fileInput) fileInput.value = '';
            
            const previewArea = document.getElementById('previewArea');
            if (previewArea) {
                previewArea.classList.add('hidden');
                previewArea.querySelector('.grid').innerHTML = '';
            }
            
            this.showNotification('内容发布成功！', 'success');
            
            // 重新加载内容
            await this.loadContents();
            this.renderContents();
            
        } catch (error) {
            console.error('发布内容失败:', error);
            this.showNotification('发布内容失败', 'error');
        } finally {
            if (uploadProgress) {
                uploadProgress.classList.add('hidden');
            }
        }
    }
    
    // 删除内容
    async deleteContent(id) {
        if (!this.isOnline) {
            this.showNotification('离线模式下无法删除内容', 'warning');
            return;
        }
        
        try {
            const response = await this.apiRequest(`/contents/${id}`, {
                method: 'DELETE'
            });
            
            this.showNotification(response.message || '内容已移至回收站', 'info');
            
            // 重新加载内容
            await this.loadContents();
            this.renderContents();
            
        } catch (error) {
            console.error('删除内容失败:', error);
            this.showNotification('删除内容失败', 'error');
        }
    }
    
    // 恢复内容
    async restoreContent(id) {
        if (!this.isOnline) {
            this.showNotification('离线模式下无法恢复内容', 'warning');
            return;
        }
        
        try {
            const response = await this.apiRequest(`/contents/${id}/restore`, {
                method: 'POST'
            });
            
            this.showNotification(response.message || '内容恢复成功', 'success');
            
            // 重新加载内容
            await this.loadDeletedContents();
            this.renderDeletedContents();
            this.updateStatistics();
            
        } catch (error) {
            console.error('恢复内容失败:', error);
            this.showNotification('恢复内容失败', 'error');
        }
    }
    
    // 永久删除内容
    async deleteContentPermanently(id) {
        if (!this.isOnline) {
            this.showNotification('离线模式下无法删除内容', 'warning');
            return;
        }
        
        try {
            const response = await this.apiRequest(`/contents/${id}/permanent`, {
                method: 'DELETE'
            });
            
            this.showNotification(response.message || '内容已永久删除', 'info');
            
            // 重新加载已删除内容
            await this.loadDeletedContents();
            this.renderDeletedContents();
            this.updateStatistics();
            
        } catch (error) {
            console.error('永久删除内容失败:', error);
            this.showNotification('永久删除内容失败', 'error');
        }
    }
    
    // 批量恢复
    async batchRestore() {
        if (!this.isOnline) {
            this.showNotification('离线模式下无法批量恢复', 'warning');
            return;
        }
        
        if (this.selectedItems.size === 0) {
            this.showNotification('请选择要恢复的内容', 'warning');
            return;
        }
        
        try {
            const response = await this.apiRequest('/batch/restore', {
                method: 'POST',
                body: JSON.stringify({
                    ids: Array.from(this.selectedItems)
                })
            });
            
            this.showNotification(response.message || '批量恢复成功', 'success');
            this.selectedItems.clear();
            this.closeRestoreModal();
            this.updateBatchToolbar();
            
            // 重新加载内容
            await this.loadDeletedContents();
            this.renderDeletedContents();
            this.updateStatistics();
            
        } catch (error) {
            console.error('批量恢复失败:', error);
            this.showNotification('批量恢复失败', 'error');
        }
    }
    
    // 批量永久删除
    async batchDeletePermanent() {
        if (!this.isOnline) {
            this.showNotification('离线模式下无法批量删除', 'warning');
            return;
        }
        
        if (this.selectedItems.size === 0) {
            this.showNotification('请选择要删除的内容', 'warning');
            return;
        }
        
        try {
            const response = await this.apiRequest('/batch/permanent', {
                method: 'DELETE',
                body: JSON.stringify({
                    ids: Array.from(this.selectedItems)
                })
            });
            
            this.showNotification(response.message || '批量删除成功', 'info');
            this.selectedItems.clear();
            this.closeDeletePermanentModal();
            this.updateBatchToolbar();
            
            // 重新加载内容
            await this.loadDeletedContents();
            this.renderDeletedContents();
            this.updateStatistics();
            
        } catch (error) {
            console.error('批量删除失败:', error);
            this.showNotification('批量删除失败', 'error');
        }
    }
    
    // 渲染内容（继续之前的代码）
    renderContents() {
        const contentGrid = document.getElementById('contentGrid');
        const emptyState = document.getElementById('emptyState');
        
        if (!contentGrid) return;
        
        let filteredContents = this.getFilteredContents();
        
        if (filteredContents.length === 0) {
            contentGrid.style.display = 'none';
            if (emptyState) emptyState.classList.remove('hidden');
            return;
        }
        
        contentGrid.style.display = 'block';
        if (emptyState) emptyState.classList.add('hidden');
        
        contentGrid.innerHTML = filteredContents.map(content => this.createContentCard(content)).join('');
        this.prepareVideoThumbnails(contentGrid);
        
        // 添加点击事件
        const cards = contentGrid.querySelectorAll('.content-card');
        cards.forEach(card => {
            card.addEventListener('click', (e) => {
                if (!e.target.closest('.delete-btn')) {
                    const contentId = card.dataset.contentId;
                    this.showContentModal(contentId);
                }
            });
        });
        
        // 添加删除事件
        const deleteBtns = contentGrid.querySelectorAll('.delete-btn');
        deleteBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const contentId = btn.dataset.contentId;
                this.showDeleteModal(contentId);
            });
        });
    }
    
    prepareVideoThumbnails(rootEl) {
        if (!rootEl) return;
        const videos = rootEl.querySelectorAll('video[data-video-thumb="1"]');
        videos.forEach((video) => {
            if (video.dataset.thumbReady === '1') return;
            video.dataset.thumbReady = '1';
            const seekTo = () => {
                try {
                    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
                    const t = Math.min(0.2, Math.max(0.05, video.duration * 0.02));
                    if (Math.abs(video.currentTime - t) < 0.01) return;
                    video.currentTime = t;
                } catch {}
            };
            video.addEventListener('loadedmetadata', seekTo, { once: true });
            video.addEventListener('loadeddata', seekTo, { once: true });
            if (video.readyState >= 1) seekTo();
        });
    }

    renderDeletedContents() {
        const contentGrid = document.getElementById('contentGrid');
        const emptyState = document.getElementById('emptyState');
        
        if (!contentGrid) return;
        
        let filteredContents = this.getFilteredDeletedContents();
        
        if (filteredContents.length === 0) {
            contentGrid.style.display = 'none';
            if (emptyState) emptyState.classList.remove('hidden');
            return;
        }
        
        contentGrid.style.display = 'block';
        if (emptyState) emptyState.classList.add('hidden');
        
        contentGrid.innerHTML = filteredContents.map(content => this.createDeletedContentCard(content)).join('');
        this.prepareVideoThumbnails(contentGrid);
        
        // 添加复选框事件
        const checkboxes = contentGrid.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const contentId = e.target.value;
                if (e.target.checked) {
                    this.selectedItems.add(contentId);
                } else {
                    this.selectedItems.delete(contentId);
                }
                this.updateBatchToolbar();
            });
        });
        
        // 添加卡片点击事件
        const cards = contentGrid.querySelectorAll('.content-card');
        cards.forEach(card => {
            card.addEventListener('click', (e) => {
                if (!e.target.closest('input[type="checkbox"]') && !e.target.closest('.action-btn')) {
                    const contentId = card.dataset.contentId;
                    this.showContentModal(contentId);
                }
            });
        });
        
        // 添加恢复和删除事件
        const restoreBtns = contentGrid.querySelectorAll('.restore-btn');
        restoreBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const contentId = btn.dataset.contentId;
                this.restoreContent(contentId);
            });
        });
        
        const deleteBtns = contentGrid.querySelectorAll('.delete-permanent-btn');
        deleteBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const contentId = btn.dataset.contentId;
                this.deleteContentPermanently(contentId);
            });
        });
    }
    
    // 创建内容卡片
    createContentCard(content) {
        const timeAgo = this.getTimeAgo(content.createdAt);
        const preview = this.getContentPreview(content);
        
        return `
            <div class="masonry-item">
                <div class="content-card glass-effect rounded-xl p-4 shadow-sm border border-gray-200" data-content-id="${content.id}">
                    ${preview}
                    <div class="mt-3 flex items-center justify-between">
                        <span class="text-sm text-gray-500">${timeAgo}</span>
                        <button class="delete-btn p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors" data-content-id="${content.id}">
                            ${this.svgIcon('trash', 'w-4 h-4')}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
    
    createDeletedContentCard(content) {
        const timeAgo = this.getTimeAgo(content.deletedAt);
        const preview = this.getContentPreview(content);
        
        return `
            <div class="masonry-item">
                <div class="checkbox-wrapper content-card glass-effect rounded-xl p-4 shadow-sm border border-gray-200" data-content-id="${content.id}">
                    <input type="checkbox" value="${content.id}">
                    ${preview}
                    <div class="mt-3 flex items-center justify-between">
                        <span class="text-sm text-gray-500">删除于 ${timeAgo}</span>
                        <div class="flex space-x-2">
                            <button class="restore-btn action-btn px-3 py-1 bg-green-100 text-green-700 rounded-md text-sm hover:bg-green-200 transition-colors" data-content-id="${content.id}">
                                恢复
                            </button>
                            <button class="delete-permanent-btn action-btn px-3 py-1 bg-red-100 text-red-700 rounded-md text-sm hover:bg-red-200 transition-colors" data-content-id="${content.id}">
                                删除
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
    
    // 获取内容预览
    getContentPreview(content, isModal = false) {
        const escapedText = content.text ? content.text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n') : '';
        
        if (content.type === 'image') {
            const hasOriginal = !!content.originalData;
            return `
                <div class="${isModal ? 'max-h-[70vh] flex justify-center' : 'aspect-square'} bg-gray-100 rounded-lg overflow-hidden mb-3 relative group">
                    <img src="${content.data}" alt="图片" onerror="window.app.handleImageLoadError(this)" class="${isModal ? 'max-w-full max-h-full object-contain' : 'w-full h-full object-cover'}">
                    <div class="absolute top-2 right-2 flex items-center justify-center">
                        <div class="flex items-center gap-2">
                            <a href="${content.data}" download="${content.filename || 'download'}" class="p-3 bg-white rounded-full shadow-xl hover:scale-110 active:scale-95 transition-all border border-gray-100" style="background: rgba(255,255,255,0.95);" title="下载 JPG" onclick="event.stopPropagation()">
                                ${this.svgIcon('download', 'w-6 h-6 text-blue-600')}
                            </a>
                            ${hasOriginal ? `
                                <a href="${content.originalData}" download="${content.originalFilename || content.filename || 'original'}" class="px-3 py-2 bg-white rounded-full shadow-xl hover:scale-110 active:scale-95 transition-all border border-gray-100 text-xs font-bold text-gray-700" style="background: rgba(255,255,255,0.95);" title="下载原图" onclick="event.stopPropagation()">
                                    原图
                                </a>
                            ` : ''}
                        </div>
                    </div>
                </div>
                ${content.text ? `
                    <div class="flex items-start justify-between gap-2">
                        <p class="text-gray-700 text-sm ${isModal ? '' : 'line-clamp-3'} flex-1">${content.text}</p>
                        <button onclick="window.app.copyText('${escapedText}', event)" class="p-2 text-gray-400 hover:text-blue-600 active:scale-90 transition-all" title="复制描述">
                            ${this.svgIcon('copy', 'w-5 h-5')}
                        </button>
                    </div>
                ` : ''}
            `;
        } else if (content.type === 'video') {
            // 对于视频预览，如果是模态框显示，则增加控制条和自动播放（静音）
            // 如果是列表显示，则作为缩略图显示
            if (isModal) {
                return `
                    <div class="bg-black rounded-xl overflow-hidden mb-4 shadow-inner">
                        <video 
                            src="${content.data}" 
                            class="w-full max-h-[60vh]" 
                            controls 
                            playsinline 
                            webkit-playsinline
                            preload="metadata"
                        ></video>
                    </div>
                    <div class="flex items-center justify-between mb-4 bg-gray-50 p-3 rounded-lg flex-wrap gap-2">
                        <div class="flex-1 min-w-[150px]">
                            <p class="text-sm font-bold text-gray-900 truncate">${content.filename || '视频文件'}</p>
                            <p class="text-xs text-gray-500">${this.formatFileSize(content.size)}</p>
                        </div>
                        <div class="flex items-center space-x-2">
                            <button onclick="window.app.optimizeVideo('${content.id}', event)" class="flex items-center space-x-1 px-3 py-2 bg-orange-100 text-orange-700 rounded-lg hover:bg-orange-200 transition-colors active:scale-95" title="如果视频无法播放，请尝试优化兼容性">
                                ${this.svgIcon('bolt', 'w-4 h-4')}
                                <span class="text-xs font-bold">转码兼容模式</span>
                            </button>
                            <a href="${content.data}" download="${content.filename || 'download'}" class="flex items-center space-x-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm active:scale-95">
                                ${this.svgIcon('download', 'w-4 h-4')}
                                <span class="text-xs font-medium">下载</span>
                            </a>
                        </div>
                    </div>
                    ${content.text ? `
                        <div class="flex items-start justify-between gap-2 p-1">
                            <p class="text-gray-700 text-sm whitespace-pre-wrap flex-1">${content.text}</p>
                            <button onclick="window.app.copyText('${escapedText}', event)" class="p-2 text-gray-400 hover:text-blue-600 active:scale-90 transition-all">
                                ${this.svgIcon('copy', 'w-5 h-5')}
                            </button>
                        </div>
                    ` : ''}
                `;
            } else {
                return `
                    <div class="aspect-video bg-gray-100 rounded-lg overflow-hidden mb-3 relative group">
                        <video
                            class="w-full h-full object-cover pointer-events-none"
                            src="${content.data}#t=0.1"
                            muted
                            playsinline
                            webkit-playsinline
                            preload="metadata"
                            data-video-thumb="1"
                        ></video>
                        <div class="absolute inset-0 flex items-center justify-center bg-black transition-all" style="background: rgba(0,0,0,0.25);">
                            <div class="w-12 h-12 bg-white rounded-full flex items-center justify-center backdrop-blur-sm group-hover:scale-110 transition-transform" style="background: rgba(255,255,255,0.28);">
                                <svg class="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z"/>
                                </svg>
                            </div>
                            <a href="${content.data}" download="${content.filename || 'download'}" class="absolute top-2 right-2 p-3 bg-white rounded-full shadow-xl hover:scale-110 active:scale-95 transition-all border border-gray-100" style="background: rgba(255,255,255,0.95);" title="下载视频" onclick="event.stopPropagation()">
                                ${this.svgIcon('download', 'w-6 h-6 text-blue-600')}
                            </a>
                        </div>
                    </div>
                    <div class="flex items-center justify-between space-x-2 mb-2">
                        <button onclick="window.app.extractAudioFromVideo('${content.id}', event)" class="flex-1 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700 active:scale-95 transition-all shadow-md flex items-center justify-center space-x-1">
                            ${this.svgIcon('music', 'w-4 h-4')}
                            <span>提取音频</span>
                        </button>
                        <a href="${content.data}" download="${content.filename || 'video'}" class="p-2 bg-white rounded-lg shadow-md border border-blue-100 text-blue-600 hover:scale-105 active:scale-95 transition-all" title="下载视频">
                            ${this.svgIcon('download', 'w-5 h-5')}
                        </a>
                    </div>
                    ${content.text ? `
                        <div class="flex items-start justify-between gap-2">
                            <p class="text-gray-700 text-sm line-clamp-3 flex-1">${content.text}</p>
                            <button onclick="window.app.copyText('${escapedText}', event)" class="p-2 text-gray-400 hover:text-blue-600 active:scale-90 transition-all" title="复制描述">
                                ${this.svgIcon('copy', 'w-5 h-5')}
                            </button>
                        </div>
                    ` : ''}
                `;
            }
        } else if (content.type === 'audio') {
            return `
                <div class="p-4 bg-orange-50 rounded-xl mb-3 relative group border border-orange-500">
                    <div class="flex items-center space-x-4 mb-3">
                        <div class="w-12 h-12 bg-orange-500 rounded-full flex items-center justify-center flex-shrink-0 shadow-lg animate-pulse">
                            ${this.svgIcon('music', 'w-6 h-6 text-white')}
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="text-orange-900 font-bold truncate text-sm">${content.filename || '音频文件'}</p>
                            <p class="text-orange-600 text-xs">${this.formatFileSize(content.size)}</p>
                        </div>
                    </div>
                    <audio src="${content.data}" controls preload="none" class="w-full h-8 mb-3"></audio>
                    <div class="flex items-center justify-between space-x-2">
                        <button onclick="window.app.convertToVideo('${content.id}', event)" class="flex-1 py-2 bg-orange-600 text-white rounded-lg text-xs font-bold hover:bg-orange-700 active:scale-95 transition-all shadow-md flex items-center justify-center space-x-1">
                            ${this.svgIcon('video', 'w-4 h-4')}
                            <span>导出 MP4</span>
                        </button>
                        <a href="${content.data}" download="${content.filename || 'audio'}" class="p-2 bg-white rounded-lg shadow-md border border-orange-100 text-orange-600 hover:scale-105 active:scale-95 transition-all" title="下载音频">
                            ${this.svgIcon('download', 'w-5 h-5')}
                        </a>
                    </div>
                </div>
                ${content.text ? `
                    <div class="flex items-start justify-between gap-2">
                        <p class="text-gray-700 text-sm line-clamp-3 flex-1">${content.text}</p>
                        <button onclick="window.app.copyText('${escapedText}', event)" class="p-2 text-gray-400 hover:text-blue-600 active:scale-90 transition-all" title="复制描述">
                            ${this.svgIcon('copy', 'w-5 h-5')}
                        </button>
                    </div>
                ` : ''}
            `;
        } else if (content.type === 'file') {
            return `
                <div class="p-4 bg-blue-50 rounded-xl mb-3 relative group border border-blue-200 flex items-center space-x-4">
                    <div class="w-12 h-12 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-lg">
                        ${this.svgIcon('file', 'w-7 h-7 text-white')}
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-blue-900 font-bold truncate text-sm mb-0.5">${content.filename || '未知文件'}</p>
                        <p class="text-blue-600 text-xs">${this.formatFileSize(content.size)}</p>
                    </div>
                    <div class="flex items-center space-x-1">
                        <a href="${content.data}" download="${content.filename || 'download'}" class="p-2.5 bg-white rounded-full shadow-md hover:scale-110 active:scale-95 transition-all border border-blue-100" title="下载文件" onclick="event.stopPropagation()">
                            ${this.svgIcon('download', 'w-5 h-5 text-blue-600')}
                        </a>
                    </div>
                </div>
                ${content.text ? `
                    <div class="flex items-start justify-between gap-2">
                        <p class="text-gray-700 text-sm line-clamp-3 flex-1">${content.text}</p>
                        <button onclick="window.app.copyText('${escapedText}', event)" class="p-2 text-gray-400 hover:text-blue-600 active:scale-90 transition-all" title="复制描述">
                            ${this.svgIcon('copy', 'w-5 h-5')}
                        </button>
                    </div>
                ` : ''}
            `;
        } else {
            return `
                <div class="p-5 bg-gray-50 rounded-xl mb-3 relative group border border-gray-200">
                    <p class="text-gray-800 whitespace-pre-wrap leading-relaxed ${isModal ? '' : 'line-clamp-5 text-sm'}">${content.text}</p>
                    <button onclick="window.app.copyText('${escapedText}', event)" class="absolute bottom-2 right-2 p-3 bg-white border border-gray-200 rounded-lg shadow-md hover:bg-gray-50 active:scale-90 transition-all text-blue-600 flex items-center space-x-1" style="background: rgba(255,255,255,0.95);" title="复制文本">
                        ${this.svgIcon('copy', 'w-5 h-5')}
                        <span class="text-xs font-bold">复制全文</span>
                    </button>
                </div>
            `;
        }
    }
    
    async convertToVideo(id, event) {
        if (event) event.stopPropagation();
        
        const loadingToast = this.showNotification('正在生成空白视频，请稍候...', 'loading');
        
        try {
            const response = await this.apiRequest('/audio/to-mp4', {
                method: 'POST',
                body: JSON.stringify({ id })
            });
            
            loadingToast.remove();
            
            if (response.success) {
                this.showNotification('视频生成成功！已加入列表', 'success');
                // 刷新内容列表
                await this.loadContents();
                this.renderContents();
            }
        } catch (error) {
            loadingToast.remove();
            console.error('转换失败:', error);
            this.showNotification('生成失败: ' + error.message, 'error');
        }
    }

    async extractAudioFromVideo(id, event) {
        if (event) event.stopPropagation();
        
        const loadingToast = this.showNotification('正在提取音频，请稍候...', 'loading');
        
        try {
            const response = await this.apiRequest('/video/to-mp3', {
                method: 'POST',
                body: JSON.stringify({ id })
            });
            
            loadingToast.remove();
            
            if (response.success) {
                this.showNotification('音频提取成功！已加入列表', 'success');
                await this.loadContents();
                this.renderContents();
            }
        } catch (error) {
            loadingToast.remove();
            console.error('提取失败:', error);
            this.showNotification('提取失败: ' + error.message, 'error');
        }
    }

    async optimizeVideo(id, event) {
        if (event) event.stopPropagation();
        
        // 使用带旋转图标的持续通知
        const loadingToast = this.showNotification('正在进行转码优化，请稍候...', 'loading');
        
        try {
            const response = await this.apiRequest('/video/optimize', {
                method: 'POST',
                body: JSON.stringify({ id })
            });
            
            loadingToast.remove(); // 任务完成，移除 loading 提示
            
            if (response.success) {
                this.showNotification('视频优化成功！已生成兼容版本', 'success');
                this.closeContentModal();
                // 刷新内容列表
                await this.loadContents();
                this.renderContents();
            }
        } catch (error) {
            loadingToast.remove(); // 出错也要移除
            console.error('视频优化失败:', error);
            this.showNotification('视频优化失败: ' + error.message, 'error');
        }
    }

    // 复制文本方法
    copyText(text, event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        
        if (!text) return;
        
        // 处理被转义的字符 (JSON -> HTML Attribute -> JS String)
        // 实际上经过 HTML 属性解析后，大部分转义已经还原
        // 主要是针对手动添加的 \\n 等进行处理
        const plainText = text.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
        
        const successMessage = '文本已复制到剪贴板';
        
        // 尝试使用现代 Clipboard API
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(plainText).then(() => {
                this.showNotification(successMessage, 'success');
            }).catch(err => {
                console.error('Clipboard API 失败，尝试回退方案:', err);
                this.fallbackCopyText(plainText);
            });
        } else {
            this.fallbackCopyText(plainText);
        }
    }

    // 复制文本回退方案 (特别优化 iOS 兼容性)
    fallbackCopyText(text) {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        
        // 确保在视图内但不可见，这样 focus() 和 select() 才能生效
        textArea.style.position = 'fixed';
        textArea.style.top = '0';
        textArea.style.left = '0';
        textArea.style.width = '2em';
        textArea.style.height = '2em';
        textArea.style.padding = '0';
        textArea.style.border = 'none';
        textArea.style.outline = 'none';
        textArea.style.boxShadow = 'none';
        textArea.style.background = 'transparent';
        textArea.style.opacity = '0.01'; // 极低透明度
        textArea.style.zIndex = '-1';
        
        document.body.appendChild(textArea);
        
        // 针对 iOS 的特殊处理
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        
        if (isIOS) {
            const range = document.createRange();
            range.selectNodeContents(textArea);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            textArea.setSelectionRange(0, 999999);
        } else {
            textArea.focus();
            textArea.select();
        }
        
        try {
            const successful = document.execCommand('copy');
            if (successful) {
                this.showNotification('文本已复制到剪贴板', 'success');
            } else {
                throw new Error('execCommand copy 返回 false');
            }
        } catch (err) {
            console.error('回退复制方案失败:', err);
            this.showNotification('复制失败，请尝试长按手动选择', 'error');
        }
        
        document.body.removeChild(textArea);
    }
    
    formatFileSize(bytes) {
        if (!bytes) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    // 工具方法
    getTimeAgo(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diff = now - date;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        
        if (minutes < 1) return '刚刚';
        if (minutes < 60) return `${minutes}分钟前`;
        if (hours < 24) return `${hours}小时前`;
        if (days < 7) return `${days}天前`;
        return date.toLocaleDateString();
    }
    
    getFilteredContents() {
        let filtered = [...this.contents];
        
        if (this.currentFilter !== 'all') {
            filtered = filtered.filter(content => content.type === this.currentFilter);
        }
        
        filtered.sort((a, b) => {
            const aTime = new Date(a.createdAt).getTime();
            const bTime = new Date(b.createdAt).getTime();
            return this.currentSort === 'newest' ? bTime - aTime : aTime - bTime;
        });
        
        return filtered;
    }
    
    getFilteredDeletedContents() {
        let filtered = [...this.deletedContents];
        
        if (this.currentFilter !== 'all') {
            filtered = filtered.filter(content => content.type === this.currentFilter);
        }
        
        const sortSelect = document.getElementById('sortSelect');
        const sortValue = sortSelect ? sortSelect.value : 'deletedNewest';
        
        filtered.sort((a, b) => {
            let aTime, bTime;
            
            switch (sortValue) {
                case 'deletedNewest':
                    aTime = new Date(a.deletedAt).getTime();
                    bTime = new Date(b.deletedAt).getTime();
                    return bTime - aTime;
                case 'deletedOldest':
                    aTime = new Date(a.deletedAt).getTime();
                    bTime = new Date(b.deletedAt).getTime();
                    return aTime - bTime;
                case 'createdNewest':
                    aTime = new Date(a.createdAt).getTime();
                    bTime = new Date(b.createdAt).getTime();
                    return bTime - aTime;
                case 'createdOldest':
                    aTime = new Date(a.createdAt).getTime();
                    bTime = new Date(b.createdAt).getTime();
                    return aTime - bTime;
                default:
                    return 0;
            }
        });
        
        return filtered;
    }
    
    // 文件处理方法（保持不变）
    handleDragOver(e) {
        e.preventDefault();
        e.currentTarget.classList.add('dragover');
    }
    
    handleDrop(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('dragover');
        const files = Array.from(e.dataTransfer.files);
        this.processFiles(files);
    }
    
    handleFileSelect(e) {
        const files = Array.from(e.target.files);
        this.processFiles(files);
    }
    
    processFiles(files) {
        const previewArea = document.getElementById('previewArea');
        const previewGrid = previewArea ? previewArea.querySelector('.grid') : null;
        
        if (!previewArea || !previewGrid) return;
        
        previewArea.classList.remove('hidden');

        const textInput = document.getElementById('textInput');
        const composerPlaceholder = document.getElementById('composerPlaceholder');
        if (textInput) textInput.classList.remove('hidden');
        if (composerPlaceholder) composerPlaceholder.classList.add('hidden');
        
        files.forEach(file => {
            const maxMB = Number.isFinite(Number(this.settings.uploadMaxSizeMB)) ? Number(this.settings.uploadMaxSizeMB) : 500;
            if (file && Number.isFinite(maxMB) && maxMB > 0 && file.size > maxMB * 1024 * 1024) {
                this.showNotification(`文件超过 ${maxMB}MB，已跳过`, 'warning');
                return;
            }
            // 将文件添加到待上传列表
            this.filesToUpload.push(file);
            const fileIndex = this.filesToUpload.length - 1;
            
            const previewItem = document.createElement('div');
            previewItem.className = 'relative aspect-square bg-gray-100 rounded-lg overflow-hidden border border-gray-200';
            previewItem.dataset.index = fileIndex;
            
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    previewItem.innerHTML = `
                        <img src="${e.target.result}" alt="预览" class="w-full h-full object-cover">
                        <button class="absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs hover:bg-red-600 shadow-md flex items-center justify-center" onclick="window.app.removeFileToUpload(${fileIndex}, this.parentElement)">×</button>
                    `;
                };
                reader.readAsDataURL(file);
            } else if (file.type.startsWith('video/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    previewItem.innerHTML = `
                        <video src="${e.target.result}" class="w-full h-full object-cover" muted></video>
                        <div class="absolute inset-0 flex items-center justify-center bg-black" style="background: rgba(0,0,0,0.30);">
                            <svg class="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z"/>
                            </svg>
                        </div>
                        <button class="absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs hover:bg-red-600 shadow-md flex items-center justify-center" onclick="window.app.removeFileToUpload(${fileIndex}, this.parentElement)">×</button>
                    `;
                };
                reader.readAsDataURL(file);
            } else if (file.type.startsWith('audio/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    previewItem.innerHTML = `
                        <div class="w-full h-full flex flex-col items-center justify-center p-2 bg-orange-50">
                            ${this.svgIcon('music', 'w-10 h-10 text-orange-500 mb-2 animate-bounce')}
                            <p class="text-[10px] text-orange-800 font-bold truncate w-full text-center px-1">${file.name}</p>
                        </div>
                        <button class="absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs hover:bg-red-600 shadow-md flex items-center justify-center" onclick="window.app.removeFileToUpload(${fileIndex}, this.parentElement)">×</button>
                    `;
                };
                reader.readAsDataURL(file);
            } else {
                // 其他文件类型的预览
                previewItem.innerHTML = `
                    <div class="w-full h-full flex flex-col items-center justify-center p-2 bg-blue-50">
                        ${this.svgIcon('file', 'w-10 h-10 text-blue-500 mb-2')}
                        <p class="text-[10px] text-blue-800 font-bold truncate w-full text-center px-1">${file.name}</p>
                    </div>
                    <button class="absolute top-2 right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs hover:bg-red-600 shadow-md flex items-center justify-center" onclick="window.app.removeFileToUpload(${fileIndex}, this.parentElement)">×</button>
                `;
            }
            
            previewGrid.appendChild(previewItem);
        });
    }

    // 从待上传列表中移除文件
    removeFileToUpload(index, element) {
        // 将对应的文件设为 null 而不是直接 splice，以免破坏其他按钮的索引
        // 或者在删除后重新渲染预览区域
        this.filesToUpload[index] = null;
        if (element) element.remove();
        
        // 检查是否还有有效文件
        const hasFiles = this.filesToUpload.some(f => f !== null);
        if (!hasFiles) {
            const previewArea = document.getElementById('previewArea');
            if (previewArea) previewArea.classList.add('hidden');
            this.filesToUpload = []; // 重置

            const textInput = document.getElementById('textInput');
            const composerPlaceholder = document.getElementById('composerPlaceholder');
            const hasText = textInput && typeof textInput.value === 'string' && textInput.value.trim().length > 0;
            if (!hasText) {
                if (textInput) textInput.classList.add('hidden');
                if (composerPlaceholder) composerPlaceholder.classList.remove('hidden');
            }
        }
    }
    
    // 筛选和排序方法（保持不变）
    handleFilter(e) {
        const filter = e.target.dataset.filter;
        this.currentFilter = filter;
        
        const filterBtns = document.querySelectorAll('.filter-btn');
        filterBtns.forEach(btn => {
            btn.classList.remove('active', 'bg-orange-500', 'text-white');
            btn.classList.add('bg-gray-100', 'text-gray-600');
        });
        
        e.target.classList.add('active', 'bg-orange-500', 'text-white');
        e.target.classList.remove('bg-gray-100', 'text-gray-600');
        
        if (this.currentPage === 'index') {
            this.renderContents();
        } else if (this.currentPage === 'history') {
            this.renderDeletedContents();
        }
    }
    
    handleSort(e) {
        this.currentSort = e.target.value;
        if (this.currentPage === 'index') {
            this.renderContents();
        } else if (this.currentPage === 'history') {
            this.renderDeletedContents();
        }
    }
    
    // 批量操作方法（保持不变）
    toggleSelectAll() {
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        const selectAllBtn = document.getElementById('selectAllBtn');
        
        if (selectAllBtn.textContent === '全选') {
            checkboxes.forEach(checkbox => {
                checkbox.checked = true;
                this.selectedItems.add(checkbox.value);
            });
            selectAllBtn.textContent = '取消全选';
        } else {
            checkboxes.forEach(checkbox => {
                checkbox.checked = false;
                this.selectedItems.delete(checkbox.value);
            });
            selectAllBtn.textContent = '全选';
        }
        
        this.updateBatchToolbar();
    }
    
    clearSelection() {
        const checkboxes = document.querySelectorAll('input[type="checkbox"]');
        const selectAllBtn = document.getElementById('selectAllBtn');
        
        checkboxes.forEach(checkbox => {
            checkbox.checked = false;
        });
        
        this.selectedItems.clear();
        selectAllBtn.textContent = '全选';
        this.updateBatchToolbar();
    }
    
    updateBatchToolbar() {
        const toolbar = document.getElementById('batchToolbar');
        const selectedCount = document.getElementById('selectedCount');
        
        if (!toolbar) return;
        
        if (this.selectedItems.size > 0) {
            toolbar.classList.add('show');
            if (selectedCount) {
                selectedCount.textContent = `已选择 ${this.selectedItems.size} 项`;
            }
        } else {
            toolbar.classList.remove('show');
        }
    }
    
    // 模态框方法（保持不变）
    showContentModal(contentId) {
        const content = this.contents.find(c => c.id === contentId) || 
                       this.deletedContents.find(c => c.id === contentId);
        if (!content) return;
        
        const modal = document.getElementById('contentModal');
        const modalContent = document.getElementById('modalContent');
        const deleteBtn = document.getElementById('deleteContentBtn');
        
        if (!modal || !modalContent) return;
        
        this.currentContentId = contentId;
        
        // 传入 isModal = true
        modalContent.innerHTML = this.getContentPreview(content, true);
        
        if (deleteBtn) {
            deleteBtn.onclick = () => {
                this.closeContentModal();
                this.showDeleteModal(contentId);
            };
        }
        
        modal.classList.remove('hidden');
    }
    
    closeContentModal() {
        const modal = document.getElementById('contentModal');
        const modalContent = document.getElementById('modalContent');
        
        // 停止视频播放，防止关闭模态框后还有声音
        if (modalContent) {
            const videos = modalContent.querySelectorAll('video');
            videos.forEach(v => {
                v.pause();
                v.src = '';
                v.load();
                v.remove();
            });
            const audios = modalContent.querySelectorAll('audio');
            audios.forEach(a => {
                a.pause();
                a.src = '';
                a.load();
                a.remove();
            });
            modalContent.innerHTML = '';
        }

        if (modal) {
            modal.classList.add('hidden');
        }
        this.currentContentId = null;
    }

    // TTS 模态框方法
    openTTSModal() {
        const modal = document.getElementById('ttsModal');
        const textInput = document.getElementById('textInput'); // 主输入框
        const ttsTextInput = document.getElementById('ttsTextInput'); // TTS 输入框
        
        if (modal && ttsTextInput) {
            // 如果主输入框有内容，自动填充
            if (textInput && textInput.value.trim()) {
                ttsTextInput.value = textInput.value.trim();
            }
            this.refreshTtsVoices({ silent: true });
            this.fillVoiceCloneSpeakerId({ force: false });
            modal.classList.remove('hidden');
            ttsTextInput.focus();
        }
    }

    closeTTSModal() {
        const modal = document.getElementById('ttsModal');
        if (modal) {
            modal.classList.add('hidden');
        }
        this.stopVoiceClonePolling();
    }

    async refreshTtsVoices({ silent } = {}) {
        const status = document.getElementById('ttsVoicesStatus');
        try {
            if (status) status.textContent = '加载中...';
            const [resp, statusResp] = await Promise.all([
                this.apiRequest('/tts/voices'),
                this.apiRequest('/tts/status', { method: 'GET' })
            ]);
            const builtin = (resp.data && Array.isArray(resp.data.builtin)) ? resp.data.builtin : [];
            const custom = (resp.data && Array.isArray(resp.data.custom)) ? resp.data.custom : [];
            const allowed = (statusResp && statusResp.data && Array.isArray(statusResp.data.voiceCloneAllowedSpeakerIds))
                ? statusResp.data.voiceCloneAllowedSpeakerIds.map((x) => String(x || '').trim()).filter(Boolean)
                : [];
            this.voiceCloneAllowedSpeakerIds = allowed;

            const customMap = new Map(custom.map((v) => [v.id, v]));
            const voiceCloneSpeakers = allowed.map((id) => {
                const record = customMap.get(id);
                return { id, name: record && record.name ? record.name : '', group: record && record.group ? record.group : '' };
            });

            this.renderTtsVoiceSelect(builtin, custom);
            this.renderCustomTtsVoices(voiceCloneSpeakers);
            this.renderVoiceCloneSpeakerSelect(voiceCloneSpeakers);
            this.setVoiceCloneSpeakerIdLockedMode(allowed.length > 0);
            if (status) status.textContent = `已加载 ${builtin.length + custom.length} 个`;
        } catch (e) {
            if (status) status.textContent = '';
            if (!silent) this.showNotification('获取音色列表失败: ' + e.message, 'error');
        }
    }

    setVoiceCloneSpeakerIdLockedMode(locked) {
        const idInput = document.getElementById('ttsNewVoiceId');
        const nameInput = document.getElementById('ttsNewVoiceName');
        const addBtn = document.getElementById('addTTSVoiceBtn');
        const display = locked ? 'none' : '';

        if (idInput) idInput.style.display = display;
        if (nameInput) nameInput.style.display = display;
        if (addBtn) addBtn.style.display = display;
    }

    renderTtsVoiceSelect(builtin, custom) {
        const select = document.getElementById('ttsVoiceSelect');
        if (!select) return;

        const makeOption = (v) => {
            const label = v.name ? `${v.name} (${v.id})` : v.id;
            return `<option value="${this.escapeHtml(v.id)}">${this.escapeHtml(label)}</option>`;
        };

        const groupBy = (arr) => {
            const map = {};
            for (const v of arr) {
                const g = v.group || '其他';
                if (!map[g]) map[g] = [];
                map[g].push(v);
            }
            return map;
        };

        const customGroup = custom.length ? `<optgroup label="我的音色">${custom.map(makeOption).join('')}</optgroup>` : '';
        const builtinGroups = groupBy(builtin);
        const builtinHtml = Object.keys(builtinGroups).map((g) => `<optgroup label="${this.escapeHtml(g)}">${builtinGroups[g].map(makeOption).join('')}</optgroup>`).join('');

        select.innerHTML = `${customGroup}${builtinHtml}`;
    }

    renderCustomTtsVoices(custom) {
        const container = document.getElementById('ttsCustomVoicesList');
        if (!container) return;
        if (!custom || custom.length === 0) {
            container.innerHTML = `<div class="text-xs text-gray-500">暂无可用 speaker_id</div>`;
            return;
        }

        container.innerHTML = custom.map((v) => {
            const label = v.name ? `${v.name}` : v.id;
            const inputId = `ttsVoiceName_${v.id}`;
            return `
                <div class="bg-white rounded-lg border border-gray-200 px-3 py-2 space-y-2">
                    <div class="flex items-center justify-between gap-3">
                        <div class="min-w-0">
                            <div class="text-sm font-semibold text-gray-800 truncate">${this.escapeHtml(label)}</div>
                            <div class="text-xs text-gray-500 truncate">${this.escapeHtml(v.id)}</div>
                        </div>
                    </div>
                    <div class="flex items-center gap-2">
                        <input id="${this.escapeHtml(inputId)}" class="flex-1 p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent" value="${this.escapeHtml(v.name || '')}" placeholder="给这个 speaker_id 起个名字（如：美玲）" />
                        <button type="button" class="px-3 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-50 active:scale-95 transition-all" onclick="window.app.saveTtsVoiceName('${this.escapeJs(v.id)}', event)">保存</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    renderVoiceCloneSpeakerSelect(custom) {
        const select = document.getElementById('vcSpeakerSelect');
        const input = document.getElementById('vcSpeakerId');
        if (!select || !input) return;

        const list = Array.isArray(custom) ? custom : [];
        if (list.length === 0) {
            select.innerHTML = `<option value="">（请在 .env 配置允许的 speaker_id 列表）</option>`;
            return;
        }

        const current = String(input.value || '').trim();
        select.innerHTML = [
            `<option value="">手动输入</option>`,
            ...list.map((v) => {
                const label = v.name ? `${v.name}（${v.id}）` : v.id;
                const selected = current && current === v.id ? ' selected' : '';
                return `<option value="${this.escapeHtml(v.id)}"${selected}>${this.escapeHtml(label)}</option>`;
            })
        ].join('');
    }

    useTtsVoice(id, event) {
        if (event) event.stopPropagation();
        const voiceCustom = document.getElementById('ttsVoiceCustom');
        if (voiceCustom) voiceCustom.value = id;
        this.showNotification('已选择音色: ' + id, 'success');
    }

    async saveTtsVoiceName(id, event) {
        if (event) event.stopPropagation();
        const input = document.getElementById(`ttsVoiceName_${id}`);
        const name = input ? String(input.value || '').trim() : '';
        try {
            await this.apiRequest('/tts/voices', {
                method: 'POST',
                body: JSON.stringify({ id, name, group: '我的音色' })
            });
            await this.refreshTtsVoices({ silent: true });
            this.showNotification('已保存名称', 'success');
        } catch (e) {
            this.showNotification('保存失败: ' + e.message, 'error');
        }
    }

    async addTtsVoice() {
        const idInput = document.getElementById('ttsNewVoiceId');
        const nameInput = document.getElementById('ttsNewVoiceName');
        const voiceId = idInput ? idInput.value.trim() : '';
        const name = nameInput ? nameInput.value.trim() : '';

        if (!voiceId) {
            this.showNotification('请填写音色ID', 'warning');
            return;
        }

        try {
            await this.apiRequest('/tts/voices', {
                method: 'POST',
                body: JSON.stringify({ id: voiceId, name, group: '我的音色' })
            });
            if (idInput) idInput.value = '';
            if (nameInput) nameInput.value = '';
            await this.refreshTtsVoices({ silent: true });
            this.showNotification('已添加音色', 'success');
        } catch (e) {
            this.showNotification('添加失败: ' + e.message, 'error');
        }
    }

    async deleteTtsVoice(id, event) {
        if (event) event.stopPropagation();
        try {
            await this.apiRequest(`/tts/voices/${encodeURIComponent(id)}`, { method: 'DELETE' });
            await this.refreshTtsVoices({ silent: true });
            this.showNotification('已删除音色', 'success');
        } catch (e) {
            this.showNotification('删除失败: ' + e.message, 'error');
        }
    }

    async fillVoiceCloneSpeakerId({ force } = {}) {
        const input = document.getElementById('vcSpeakerId');
        if (!input) return;
        const current = String(input.value || '').trim();
        if (current && !force) return;
        try {
            const resp = await this.apiRequest('/tts/status', { method: 'GET' });
            const suggested = resp && resp.data && typeof resp.data.voiceCloneSpeakerId === 'string' ? resp.data.voiceCloneSpeakerId.trim() : '';
            if (suggested) {
                input.value = suggested;
                return;
            }
            const allowed = resp && resp.data && Array.isArray(resp.data.voiceCloneAllowedSpeakerIds)
                ? resp.data.voiceCloneAllowedSpeakerIds.map((x) => String(x || '').trim()).filter(Boolean)
                : [];
            if (allowed.length > 0) {
                input.value = allowed[0];
                return;
            }
        } catch {}
        if (force) {
            this.showNotification('请从控制台获取 speaker_id（如 S_7JA7WNiQ1）', 'warning');
            input.focus();
        }
    }

    setVoiceCloneStatus(text) {
        const el = document.getElementById('vcStatusText');
        if (!el) return;
        el.textContent = text ? String(text) : '';
    }

    voiceCloneStatusLabel(status) {
        const s = Number(status);
        if (s === 0) return '未发现';
        if (s === 1) return '训练中';
        if (s === 2) return '训练完成';
        if (s === 3) return '训练失败';
        if (s === 4) return '可用';
        return `未知(${String(status)})`;
    }

    stopVoiceClonePolling() {
        if (this.voiceClonePollTimer) {
            clearInterval(this.voiceClonePollTimer);
            this.voiceClonePollTimer = null;
        }
        this.voiceClonePollingSpeakerId = '';
    }

    startVoiceClonePolling({ speakerId, modelType }) {
        this.stopVoiceClonePolling();
        this.voiceClonePollingSpeakerId = speakerId;
        this.voiceClonePollingModelType = modelType;

        let ticks = 0;
        this.voiceClonePollTimer = setInterval(async () => {
            ticks += 1;
            if (ticks > 60) {
                this.stopVoiceClonePolling();
                return;
            }
            await this.fetchVoiceCloneStatus({ startPolling: true, silent: true });
        }, 2000);
    }

    async fileToBase64(file) {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const chunkSize = 0x8000;
        let binary = '';
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    arrayBufferToBase64(buf) {
        const bytes = new Uint8Array(buf);
        const chunkSize = 0x8000;
        let binary = '';
        for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
        }
        return btoa(binary);
    }

    mergeFloat32(chunks) {
        const list = Array.isArray(chunks) ? chunks : [];
        let total = 0;
        for (const c of list) total += c.length;
        const out = new Float32Array(total);
        let offset = 0;
        for (const c of list) {
            out.set(c, offset);
            offset += c.length;
        }
        return out;
    }

    downsampleBuffer(buffer, inputRate, outputRate) {
        if (outputRate === inputRate) return buffer;
        const ratio = inputRate / outputRate;
        const newLength = Math.round(buffer.length / ratio);
        const result = new Float32Array(newLength);
        let offsetResult = 0;
        let offsetBuffer = 0;
        while (offsetResult < result.length) {
            const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
            let sum = 0;
            let count = 0;
            for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
                sum += buffer[i];
                count += 1;
            }
            result[offsetResult] = count ? (sum / count) : 0;
            offsetResult += 1;
            offsetBuffer = nextOffsetBuffer;
        }
        return result;
    }

    encodeWav16(samples, sampleRate) {
        const numChannels = 1;
        const bytesPerSample = 2;
        const blockAlign = numChannels * bytesPerSample;
        const byteRate = sampleRate * blockAlign;
        const dataSize = samples.length * bytesPerSample;
        const buffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buffer);

        const writeString = (offset, str) => {
            for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
        };

        writeString(0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, dataSize, true);

        let offset = 44;
        for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
            offset += 2;
        }
        return buffer;
    }

    async toggleVoiceCloneRecording() {
        if (this.voiceCloneIsRecording) {
            await this.stopVoiceCloneRecording();
        } else {
            await this.startVoiceCloneRecording();
        }
    }

    async startVoiceCloneRecording() {
        if (this.voiceCloneIsRecording) return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            this.showNotification('当前浏览器不支持麦克风录音', 'error');
            return;
        }

        const statusEl = document.getElementById('vcStatusText');
        const btn = document.getElementById('vcRecordBtn');
        const timeEl = document.getElementById('vcRecordTime');
        const preview = document.getElementById('vcRecordedPreview');

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            const audioCtx = new AudioCtx();
            const source = audioCtx.createMediaStreamSource(stream);
            const processor = audioCtx.createScriptProcessor(4096, 1, 1);
            const gain = audioCtx.createGain();
            gain.gain.value = 0;
            const chunks = [];

            processor.onaudioprocess = (e) => {
                const input = e.inputBuffer.getChannelData(0);
                chunks.push(new Float32Array(input));
            };

            source.connect(processor);
            processor.connect(gain);
            gain.connect(audioCtx.destination);

            this.voiceCloneRecordingState = {
                stream,
                audioCtx,
                source,
                processor,
                gain,
                chunks,
                startedAt: Date.now(),
                timer: null
            };
            this.voiceCloneIsRecording = true;
            this.voiceCloneRecordedBase64 = '';
            if (this.voiceCloneRecordedBlobUrl) {
                URL.revokeObjectURL(this.voiceCloneRecordedBlobUrl);
                this.voiceCloneRecordedBlobUrl = '';
            }
            if (preview) preview.src = '';

            if (btn) {
                btn.classList.remove('bg-white', 'text-gray-700', 'border-gray-200');
                btn.classList.add('bg-red-600', 'text-white', 'border-red-600');
                btn.setAttribute('aria-pressed', 'true');
            }
            if (statusEl) statusEl.textContent = '录音中...';
            if (timeEl) timeEl.textContent = '00:00';

            this.voiceCloneRecordingState.timer = setInterval(() => {
                const elapsedMs = Date.now() - this.voiceCloneRecordingState.startedAt;
                const totalSec = Math.floor(elapsedMs / 1000);
                const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
                const ss = String(totalSec % 60).padStart(2, '0');
                if (timeEl) timeEl.textContent = `${mm}:${ss}`;
            }, 200);
        } catch (e) {
            this.showNotification('麦克风权限获取失败: ' + (e && e.message ? e.message : 'unknown'), 'error');
        }
    }

    async stopVoiceCloneRecording() {
        if (!this.voiceCloneIsRecording) return;
        const st = this.voiceCloneRecordingState;
        this.voiceCloneIsRecording = false;
        this.voiceCloneRecordingState = null;

        const statusEl = document.getElementById('vcStatusText');
        const btn = document.getElementById('vcRecordBtn');
        const timeEl = document.getElementById('vcRecordTime');
        const preview = document.getElementById('vcRecordedPreview');

        try {
            if (st && st.timer) clearInterval(st.timer);
            if (st && st.processor) st.processor.disconnect();
            if (st && st.source) st.source.disconnect();
            if (st && st.gain) st.gain.disconnect();
            if (st && st.stream) st.stream.getTracks().forEach((t) => t.stop());
            if (st && st.audioCtx) await st.audioCtx.close();

            const inputRate = st && st.audioCtx ? st.audioCtx.sampleRate : 48000;
            const merged = this.mergeFloat32(st && st.chunks ? st.chunks : []);
            const targetRate = 24000;
            const downsampled = this.downsampleBuffer(merged, inputRate, targetRate);
            const wavBuf = this.encodeWav16(downsampled, targetRate);
            const b64 = this.arrayBufferToBase64(wavBuf);
            this.voiceCloneRecordedBase64 = b64;

            const blob = new Blob([wavBuf], { type: 'audio/wav' });
            this.voiceCloneRecordedBlobUrl = URL.createObjectURL(blob);
            if (preview) preview.src = this.voiceCloneRecordedBlobUrl;

            if (statusEl) statusEl.textContent = '已完成录音，可直接上传复刻';
        } catch (e) {
            if (statusEl) statusEl.textContent = '';
            this.showNotification('结束录音失败: ' + (e && e.message ? e.message : 'unknown'), 'error');
        } finally {
            if (btn) {
                btn.classList.remove('bg-red-600', 'text-white', 'border-red-600');
                btn.classList.add('bg-white', 'text-gray-700', 'border-gray-200');
                btn.setAttribute('aria-pressed', 'false');
            }
            if (timeEl && !timeEl.textContent) timeEl.textContent = '00:00';
        }
    }

    async uploadVoiceClone() {
        if (!this.isOnline) {
            this.showNotification('离线模式下无法使用 AI 功能', 'warning');
            return;
        }

        const speakerIdInput = document.getElementById('vcSpeakerId');
        const modelTypeSelect = document.getElementById('vcModelType');
        const languageSelect = document.getElementById('vcLanguage');
        const readTextInput = document.getElementById('vcReadText');
        const demoTextInput = document.getElementById('vcDemoText');
        const fileInput = document.getElementById('vcAudioFile');
        const uploadBtn = document.getElementById('vcUploadBtn');

        const speakerId = speakerIdInput ? speakerIdInput.value.trim() : '';
        const modelType = modelTypeSelect ? Number(modelTypeSelect.value) : 4;
        const language = languageSelect ? Number(languageSelect.value) : 0;
        const readText = readTextInput ? readTextInput.value.trim() : '';
        const demoText = demoTextInput ? demoTextInput.value.trim() : '';
        const file = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;

        if (!speakerId) {
            this.showNotification('请填写 speaker_id', 'warning');
            if (speakerIdInput) speakerIdInput.focus();
            return;
        }
        if (!/^S_[A-Za-z0-9]+$/.test(speakerId)) {
            this.showNotification('speaker_id 格式应为 S_ 开头（从控制台获取）', 'warning');
            if (speakerIdInput) speakerIdInput.focus();
            return;
        }
        if (Array.isArray(this.voiceCloneAllowedSpeakerIds) && this.voiceCloneAllowedSpeakerIds.length > 0 && !this.voiceCloneAllowedSpeakerIds.includes(speakerId)) {
            this.showNotification('speaker_id 不在允许列表中（请使用控制台提供的固定 speaker_id）', 'warning');
            if (speakerIdInput) speakerIdInput.focus();
            return;
        }
        if (!file && !this.voiceCloneRecordedBase64) {
            this.showNotification('请选择音频文件或使用麦克风录音', 'warning');
            return;
        }

        try {
            if (uploadBtn) {
                uploadBtn.disabled = true;
                uploadBtn.classList.add('opacity-75', 'cursor-not-allowed');
            }
            this.setVoiceCloneStatus('读取音频中...');
            let audioBytes = '';
            let audioFormat = '';
            if (file) {
                const ext = (file.name || '').split('.').pop().toLowerCase();
                audioFormat = ext || (file.type && file.type.includes('/') ? file.type.split('/')[1] : '');
                if (!audioFormat) {
                    this.showNotification('无法识别音频格式，请使用 wav/mp3/ogg/m4a/aac/pcm', 'warning');
                    return;
                }
                audioBytes = await this.fileToBase64(file);
            } else {
                audioBytes = this.voiceCloneRecordedBase64;
                audioFormat = 'wav';
            }
            this.setVoiceCloneStatus('上传中...');

            await this.apiRequest('/voice-clone/upload', {
                method: 'POST',
                body: JSON.stringify({
                    speaker_id: speakerId,
                    audio_bytes: audioBytes,
                    audio_format: audioFormat,
                    model_type: modelType,
                    language,
                    text: readText,
                    demo_text: demoText
                })
            });

            this.showNotification('已提交复刻任务，正在查询状态...', 'success');
            this.startVoiceClonePolling({ speakerId, modelType });
            await this.fetchVoiceCloneStatus({ startPolling: true, silent: true });
        } catch (e) {
            this.setVoiceCloneStatus('');
            this.showNotification('复刻上传失败: ' + e.message, 'error');
        } finally {
            if (uploadBtn) {
                uploadBtn.disabled = false;
                uploadBtn.classList.remove('opacity-75', 'cursor-not-allowed');
            }
        }
    }

    async fetchVoiceCloneStatus({ startPolling, silent } = {}) {
        const speakerIdInput = document.getElementById('vcSpeakerId');
        const modelTypeSelect = document.getElementById('vcModelType');
        const speakerId = speakerIdInput ? speakerIdInput.value.trim() : '';
        const modelType = modelTypeSelect ? Number(modelTypeSelect.value) : 4;

        const effectiveSpeakerId = speakerId || this.voiceClonePollingSpeakerId;
        const effectiveModelType = Number.isFinite(modelType) ? modelType : this.voiceClonePollingModelType;

        if (!effectiveSpeakerId) {
            if (!silent) this.showNotification('请先填写 speaker_id', 'warning');
            return;
        }
        if (!/^S_[A-Za-z0-9]+$/.test(effectiveSpeakerId)) {
            if (!silent) this.showNotification('speaker_id 格式应为 S_ 开头（从控制台获取）', 'warning');
            return;
        }
        if (Array.isArray(this.voiceCloneAllowedSpeakerIds) && this.voiceCloneAllowedSpeakerIds.length > 0 && !this.voiceCloneAllowedSpeakerIds.includes(effectiveSpeakerId)) {
            if (!silent) this.showNotification('speaker_id 不在允许列表中（请使用控制台提供的固定 speaker_id）', 'warning');
            return;
        }

        try {
            const resp = await this.apiRequest('/voice-clone/status', {
                method: 'POST',
                body: JSON.stringify({ speaker_id: effectiveSpeakerId, model_type: effectiveModelType })
            });

            const data = resp && resp.data ? resp.data : {};
            const status = data && typeof data.status !== 'undefined' ? data.status : undefined;
            if (typeof status === 'undefined') {
                this.setVoiceCloneStatus('状态查询成功，但返回缺少 status 字段');
                return;
            }

            this.setVoiceCloneStatus(`状态：${this.voiceCloneStatusLabel(status)}`);

            const done = Number(status) === 2 || Number(status) === 4;
            const failed = Number(status) === 3;
            if (failed) {
                this.stopVoiceClonePolling();
                this.showNotification('复刻训练失败，请更换音频重试', 'error');
                return;
            }

            if (done) {
                this.stopVoiceClonePolling();
                const name = `复刻音色 ${effectiveSpeakerId}`;
                await this.apiRequest('/tts/voices', {
                    method: 'POST',
                    body: JSON.stringify({ id: effectiveSpeakerId, name, group: '我的音色' })
                });
                await this.refreshTtsVoices({ silent: true });

                const voiceCustom = document.getElementById('ttsVoiceCustom');
                if (voiceCustom) voiceCustom.value = effectiveSpeakerId;
                this.showNotification('复刻完成，已添加到“我的音色”并选中', 'success');
            } else if (!startPolling) {
                this.startVoiceClonePolling({ speakerId: effectiveSpeakerId, modelType: effectiveModelType });
            }
        } catch (e) {
            if (!silent) this.showNotification('查询复刻状态失败: ' + e.message, 'error');
        }
    }

    escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
    }

    escapeJs(str) {
        return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r');
    }

    async generateTTS() {
        if (!this.isOnline) {
            this.showNotification('离线模式下无法使用 AI 功能', 'warning');
            return;
        }

        const textInput = document.getElementById('ttsTextInput');
        const voiceSelect = document.getElementById('ttsVoiceSelect');
        const voiceCustom = document.getElementById('ttsVoiceCustom');
        const speedRange = document.getElementById('ttsSpeedRange');
        const emotionSelect = document.getElementById('ttsEmotionSelect');
        const emotionScaleRange = document.getElementById('ttsEmotionScaleRange');
        const btn = document.getElementById('generateTTSBtn');
        const btnText = document.getElementById('ttsBtnText');
        const loading = document.getElementById('ttsLoading');

        const text = textInput.value.trim();
        if (!text) {
            this.showNotification('请输入要合成的文本', 'warning');
            textInput.focus();
            return;
        }

        try {
            // UI Loading 状态
            btn.disabled = true;
            btn.classList.add('opacity-75', 'cursor-not-allowed');
            btnText.textContent = '生成中...';
            loading.classList.remove('hidden');

            const response = await this.apiRequest('/tts', {
                method: 'POST',
                body: JSON.stringify({
                    text: text,
                    voice_type: (voiceCustom && voiceCustom.value.trim()) ? voiceCustom.value.trim() : voiceSelect.value,
                    speed_ratio: speedRange.value,
                    emotion: emotionSelect ? emotionSelect.value : '',
                    emotion_scale: emotionScaleRange ? emotionScaleRange.value : ''
                })
            });

            this.showNotification('语音生成成功！', 'success');
            if (this.currentPage === 'index') {
                this.closeTTSModal();
                await this.loadContents();
                this.renderContents();
            }
            
            // 清空输入
            textInput.value = '';
            if (voiceCustom) voiceCustom.value = '';

        } catch (error) {
            console.error('TTS 生成失败:', error);
            this.showNotification('生成失败: ' + error.message, 'error');
        } finally {
            // 恢复 UI 状态
            btn.disabled = false;
            btn.classList.remove('opacity-75', 'cursor-not-allowed');
            btnText.textContent = '开始生成';
            loading.classList.add('hidden');
        }
    }
    
    showDeleteModal(contentId) {
        this.currentContentId = contentId;
        const modal = document.getElementById('deleteModal');
        if (modal) {
            modal.classList.remove('hidden');
        }
    }
    
    closeDeleteModal() {
        const modal = document.getElementById('deleteModal');
        if (modal) {
            modal.classList.add('hidden');
        }
        this.currentContentId = null;
    }
    
    confirmDelete() {
        if (this.currentContentId) {
            this.deleteContent(this.currentContentId);
            this.closeDeleteModal();
        }
    }
    
    // 其他模态框方法
    showRestoreModal() {
        const modal = document.getElementById('restoreModal');
        const text = document.getElementById('restoreModalText');
        
        if (modal && text) {
            text.textContent = `确定要恢复选中的 ${this.selectedItems.size} 项内容吗？`;
            modal.classList.remove('hidden');
        }
    }
    
    closeRestoreModal() {
        const modal = document.getElementById('restoreModal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }
    
    showDeletePermanentModal() {
        const modal = document.getElementById('deletePermanentModal');
        const text = document.getElementById('deletePermanentModalText');
        
        if (modal && text) {
            text.textContent = `确定要永久删除选中的 ${this.selectedItems.size} 项内容吗？此操作无法撤销！`;
            modal.classList.remove('hidden');
        }
    }
    
    closeDeletePermanentModal() {
        const modal = document.getElementById('deletePermanentModal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }
    
    // 设置相关方法（保持不变）
    updateSetting(key, value) {
        this.settings[key] = value;
        this.saveSettings();
        
        if (key === 'autoRefresh') {
            if (value) {
                this.startAutoRefresh();
            } else {
                this.stopAutoRefresh();
            }
        }
        
        // 如果是自动清理相关的设置，同步到后台
        if (key === 'autoCleanup' || key === 'cleanupPeriod') {
            this.syncCleanupSettings();
        }
        
        this.showNotification('设置已更新', 'success');
    }
    
    // 同步清理设置到后台
    async syncCleanupSettings() {
        try {
            await this.apiRequest('/settings/cleanup', {
                method: 'POST',
                body: JSON.stringify({
                    enabled: this.settings.autoCleanup,
                    periodDays: this.settings.cleanupPeriod
                })
            });
        } catch (err) {
            console.error('同步清理设置失败:', err);
        }
    }

    async loadUploadLimitFromServer() {
        try {
            const resp = await this.apiRequest('/settings/upload', { method: 'GET' });
            const mb = resp && resp.data && Number.isFinite(Number(resp.data.maxUploadSizeMB)) ? Number(resp.data.maxUploadSizeMB) : NaN;
            if (Number.isFinite(mb) && mb > 0) {
                this.settings.uploadMaxSizeMB = Math.round(mb);
                this.saveSettings();
                this.uploadLimitDirty = false;
            }
        } catch {}
    }
    
    toggleDarkMode(enabled) {
        this.updateSetting('darkMode', enabled);
        document.documentElement.classList.toggle('dark', enabled);
        document.body.classList.toggle('dark', enabled);
    }
    
    loadSettingsUI() {
        const toggles = {
            'autoRefreshToggle': this.settings.autoRefresh,
            'autoCleanupToggle': this.settings.autoCleanup,
            'darkModeToggle': this.settings.darkMode,
            'soundToggle': this.settings.soundEnabled,
            'vibrationToggle': this.settings.vibrationEnabled
        };
        
        Object.entries(toggles).forEach(([id, value]) => {
            const toggle = document.getElementById(id);
            if (toggle) {
                toggle.checked = value;
            }
        });
        
        const refreshInterval = document.getElementById('refreshInterval');
        if (refreshInterval) {
            refreshInterval.value = this.settings.refreshInterval;
        }
        
        const cleanupPeriod = document.getElementById('cleanupPeriod');
        if (cleanupPeriod) {
            cleanupPeriod.value = this.settings.cleanupPeriod;
        }

        const uploadMaxSize = document.getElementById('uploadMaxSize');
        if (uploadMaxSize) {
            uploadMaxSize.value = this.settings.uploadMaxSizeMB;
        }
        const uploadMaxSizeHint = document.getElementById('uploadMaxSizeHint');
        if (uploadMaxSizeHint) uploadMaxSizeHint.textContent = this.uploadLimitDirty ? '未保存' : '已保存';
        const saveUploadLimitBtn = document.getElementById('saveUploadLimitBtn');
        if (saveUploadLimitBtn) saveUploadLimitBtn.disabled = !this.uploadLimitDirty;
    }
    
    applySettings() {
        document.documentElement.classList.toggle('dark', Boolean(this.settings.darkMode));
        document.body.classList.toggle('dark', Boolean(this.settings.darkMode));
        
        this.updateOnlineStatus();
    }
    
    loadSettings() {
        const stored = localStorage.getItem('mediaShareSettings');
        const defaultSettings = {
            autoRefresh: false,
            refreshInterval: 5,
            autoCleanup: false,
            cleanupPeriod: 30,
            darkMode: false,
            soundEnabled: true,
            vibrationEnabled: true,
            uploadMaxSizeMB: 500,
            asrPublicBaseUrl: ''
        };
        return stored ? { ...defaultSettings, ...JSON.parse(stored) } : defaultSettings;
    }
    
    saveSettings() {
        localStorage.setItem('mediaShareSettings', JSON.stringify(this.settings));
    }
    
    // 通知方法
    showNotification(message, type = 'info') {
        // 创建通知容器（如果不存在）
        let container = document.getElementById('notification-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'notification-container';
            container.className = 'fixed top-4 right-4 z-[9999] flex flex-col items-end space-y-3 pointer-events-none';
            document.body.appendChild(container);
        }

        const notification = document.createElement('div');
        notification.className = `pointer-events-auto px-4 py-3 rounded-xl text-white text-sm font-bold shadow-2xl transform translate-x-full transition-all duration-500 ease-out min-w-[200px] max-w-xs flex items-center justify-between`;
        
        // 增加毛玻璃效果和图标
        const icons = {
            success: '<svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path></svg>',
            error: '<svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path></svg>',
            warning: '<svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path></svg>',
            info: '<svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path></svg>',
            loading: '<svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>'
        };

        switch (type) {
            case 'success': notification.classList.add('bg-green-500'); break;
            case 'error': notification.classList.add('bg-red-500'); break;
            case 'warning': notification.classList.add('bg-yellow-500'); break;
            case 'loading': notification.classList.add('bg-blue-600'); break;
            default: notification.classList.add('bg-blue-600');
        }
        
        notification.innerHTML = `
            <div class="flex items-center">
                ${icons[type] || icons.info}
                <span>${message}</span>
            </div>
        `;
        container.appendChild(notification);
        
        // 进场动画
        requestAnimationFrame(() => {
            notification.classList.remove('translate-x-full');
            notification.classList.add('translate-x-0');
        });
        
        // 振动反馈
        if (this.settings.vibrationEnabled && navigator.vibrate) {
            navigator.vibrate(50);
        }

        const removeFunc = () => {
            notification.classList.remove('translate-x-0');
            notification.classList.add('translate-x-full', 'opacity-0');
            setTimeout(() => {
                if (notification.parentElement) {
                    notification.remove();
                }
                if (container.children.length === 0 && container.parentElement) {
                    container.remove();
                }
            }, 500);
        };

        // 如果不是 loading 类型，自动移除
        if (type !== 'loading') {
            setTimeout(removeFunc, 3500);
        }

        return { remove: removeFunc };
    }
    
    // 自动刷新
    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        
        if (this.settings.autoRefresh) {
            this.refreshInterval = setInterval(() => {
                if (this.isOnline) {
                    this.refreshContent();
                }
            }, this.settings.refreshInterval * 60 * 1000);
        }
    }
    
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }
    
    // 其他方法（保持不变）
    updateUI() {
        // 更新UI的通用逻辑
    }
    
    updateStatistics() {
        if (this.currentPage !== 'history') return;
        
        const totalCount = document.getElementById('totalCount');
        const imageCount = document.getElementById('imageCount');
        const videoCount = document.getElementById('videoCount');
        const textCount = document.getElementById('textCount');
        const storageUsed = document.getElementById('storageUsed');
        
        if (!totalCount) return;
        
        const stats = {
            total: this.deletedContents.length,
            image: this.deletedContents.filter(c => c.type === 'image').length,
            video: this.deletedContents.filter(c => c.type === 'video').length,
            text: this.deletedContents.filter(c => c.type === 'text').length,
            size: 0
        };
        
        this.deletedContents.forEach(content => {
            if (content.size) stats.size += parseInt(content.size);
        });
        
        // 更新数量显示
        totalCount.textContent = stats.total;
        if (imageCount) imageCount.textContent = stats.image;
        if (videoCount) videoCount.textContent = stats.video;
        if (textCount) textCount.textContent = stats.text;
        
        // 更新容量显示
        if (storageUsed) {
            const sizeMB = stats.size / (1024 * 1024);
            if (sizeMB >= 1024) {
                storageUsed.textContent = `${(sizeMB / 1024).toFixed(2)} GB`;
            } else {
                storageUsed.textContent = `${sizeMB.toFixed(2)} MB`;
            }
        }
    }
    
    async updateStorageInfo() {
        try {
            // 获取活跃内容和回收站内容，因为都占用物理空间
            const [contentsRes, deletedRes] = await Promise.all([
                this.apiRequest('/contents'),
                this.apiRequest('/deleted')
            ]);
            
            const allItems = [...(contentsRes.data || []), ...(deletedRes.data || [])];
            
            // 计算总大小
            let totalSize = 0;
            allItems.forEach(item => {
                if (item.size) {
                    totalSize += parseInt(item.size);
                }
            });
            
            // 转换为MB或GB显示
            const totalMB = totalSize / (1024 * 1024);
            const maxMB = 5120; // 5GB
            const percentage = Math.min((totalMB / maxMB) * 100, 100).toFixed(1);
            
            // UI显示优化：如果超过1024MB显示GB
            let displayText = "";
            if (totalMB >= 1024) {
                displayText = `${(totalMB / 1024).toFixed(2)} GB / 5 GB`;
            } else {
                displayText = `${totalMB.toFixed(2)} MB / 5 GB`;
            }
            
            const storageText = document.getElementById('storageText');
            const storageProgress = document.getElementById('storageProgress');
            
            if (storageText) storageText.textContent = displayText;
            if (storageProgress) {
                storageProgress.style.width = `${percentage}%`;
                storageProgress.style.backgroundColor = percentage > 80 ? '#ef4444' : (percentage > 60 ? '#f59e0b' : '#ff6b35');
            }
        } catch (error) {
            console.error('更新存储信息失败:', error);
        }
    }
    
    clearCache() {
        localStorage.clear();
        this.showNotification('缓存已清除', 'success');
    }
    
    exportData() {
        const data = {
            contents: this.contents,
            deletedContents: this.deletedContents,
            settings: this.settings,
            exportDate: new Date().toISOString()
        };
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `media-share-backup-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.showNotification('数据导出成功', 'success');
    }
    
    showImportDialog() {
        document.getElementById('importFileInput').click();
    }
    
    importData(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                // 处理导入数据的逻辑
                this.showNotification('数据导入成功', 'success');
            } catch (error) {
                this.showNotification('数据导入失败，文件格式错误', 'error');
            }
        };
        reader.readAsText(file);
    }
    
    showResetConfirm() {
        const modal = document.getElementById('confirmModal');
        const title = document.getElementById('confirmTitle');
        const message = document.getElementById('confirmMessage');
        const icon = document.getElementById('confirmIcon');
        
        if (modal && title && message && icon) {
            title.innerText = '确认清空所有数据？';
            message.innerText = '此操作将永久删除服务器上的所有内容和本地设置，且不可恢复。确定要继续吗？';
            icon.className = 'w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4';
            icon.innerHTML = `
                ${this.svgIcon('trash', 'w-8 h-8 text-red-600')}
            `;
            modal.classList.remove('hidden');
        }
    }
    
    async executeConfirmAction() {
        try {
            const modal = document.getElementById('confirmModal');
            if (modal) modal.classList.add('hidden');
            
            this.showNotification('正在重置系统...', 'info');
            
            // 1. 调用后端重置接口
            const response = await this.apiRequest('/system/reset', { method: 'POST' });
            
            if (response.success) {
                // 2. 清空本地存储
                localStorage.clear();
                
                this.showNotification('系统已重置', 'success');
                
                // 3. 延迟跳转回首页
                setTimeout(() => {
                    window.location.href = '/';
                }, 1500);
            }
        } catch (error) {
            console.error('重置失败:', error);
            this.showNotification('重置失败: ' + error.message, 'error');
        }
    }
}

// 全局函数（供HTML调用）
function closeContentModal() {
    if (window.app) {
        window.app.closeContentModal();
    }
}

function closeDeleteModal() {
    if (window.app) {
        window.app.closeDeleteModal();
    }
}

function closeRestoreModal() {
    if (window.app) {
        window.app.closeRestoreModal();
    }
}

function closeDeletePermanentModal() {
    if (window.app) {
        window.app.closeDeletePermanentModal();
    }
}

function closeConfirmModal() {
    const modal = document.getElementById('confirmModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

function closeTTSModal() {
    if (window.app) {
        window.app.closeTTSModal();
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    window.app = new MediaShareApp();
});
