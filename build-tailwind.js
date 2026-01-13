const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// 创建输出目录
const outputDir = path.join(__dirname, 'public');
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// 生成 Tailwind CSS
const tailwindArgs = [
    '-i', path.join(__dirname, 'styles.css'), // 输入文件
    '-o', path.join(outputDir, 'tailwind-output.css'), // 输出文件
    '--minify'
];

console.log('正在构建 Tailwind CSS...');

const tailwindProcess = spawn('npx', ['tailwindcss', ...tailwindArgs], {
    stdio: 'inherit',
    cwd: __dirname
});

tailwindProcess.on('close', (code) => {
    if (code === 0) {
        console.log('Tailwind CSS 构建成功！');
        
        // 创建一个最小化的 CSS 文件作为备用
        const fallbackCSS = `
/* Fallback styles for production */
.glass-effect {
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.2);
}
.content-card {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    cursor: pointer;
}
.upload-area {
    border: 2px dashed #ff6b35;
    transition: all 0.3s ease;
}
.hidden { display: none !important; }
.flex { display: flex !important; }
.grid { display: grid !important; }
.justify-center { justify-content: center !important; }
.items-center { align-items: center !important; }
.w-full { width: 100% !important; }
.h-full { height: 100% !important; }
.bg-orange-500 { background-color: #f97316 !important; }
.text-white { color: white !important; }
.p-4 { padding: 1rem !important; }
.rounded-xl { border-radius: 0.75rem !important; }
.shadow-lg { box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1) !important; }
/* 更多样式可根据需要添加 */
        `;
        
        fs.writeFileSync(path.join(outputDir, 'tailwind.min.js'), `
// Minimal Tailwind fallback for production
(function() {
    var style = document.createElement('style');
    style.textContent = \`${fallbackCSS}\`;
    document.head.appendChild(style);
})();
        `);
        
        console.log('备用样式文件已创建！');
    } else {
        console.error('Tailwind CSS 构建失败，使用备用样式');
        
        // 即使构建失败，也要创建备用样式
        const fallbackCSS = `
/* Fallback styles for production */
.glass-effect {
    background: rgba(255, 255, 255, 0.95);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255, 255, 255, 0.2);
}
.content-card {
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    cursor: pointer;
}
.upload-area {
    border: 2px dashed #ff6b35;
    transition: all 0.3s ease;
}
.hidden { display: none !important; }
.flex { display: flex !important; }
.grid { display: grid !important; }
.justify-center { justify-content: center !important; }
.items-center { align-items: center !important; }
.w-full { width: 100% !important; }
.h-full { height: 100% !important; }
.bg-orange-500 { background-color: #f97316 !important; }
.text-white { color: white !important; }
.p-4 { padding: 1rem !important; }
.rounded-xl { border-radius: 0.75rem !important; }
.shadow-lg { box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1) !important; }
        `;
        
        fs.writeFileSync(path.join(outputDir, 'tailwind.min.js'), `
// Minimal Tailwind fallback for production
(function() {
    var style = document.createElement('style');
    style.textContent = \`${fallbackCSS}\`;
    document.head.appendChild(style);
})();
        `);
        
        console.log('备用样式文件已创建！');
    }
});