(() => {
    'use strict';

    const BRANDKIT_KEY = 'layerlens-brandkit';
    const PROJECT_KEY = 'layerlens-project';
    const MIN_TEXT_CONFIDENCE = 75;
    const SAFE_MARGIN_PCT = 0.08;
    const ROLES = ['hero', 'gallery', 'detail'];

    let tesseractWorker = null;
    let textCheckTimeout = null;
    let cultsEstimateTimeout = null;
    let bgCustomImage = null;
    let logoImage = null;
    let lastOcrSummary = 'Waiting…';
    let cultsSizeText = '—';

    const state = {
        projectName: 'Untitled Project',
        images: [],
        activeImageId: null,
        fitMode: 'contain',
        bgType: 'blur',
        bgColor: '#111827',
        bgGradientStart: '#4c1d95',
        bgGradientEnd: '#f97316',
        bgGradientDirection: 'diagonal',
        bgTexture: 'texture_dot',
        bgTextureScale: 1,
        bgTextureBlur: 0,
        bgTextureBrightness: 1.0,
        bgTextureColor: '#ffffff',
        bgCustomImageName: '',
        bgCustomImageDataUrl: '',
        blurVal: 20,
        edgeSoftness: 0,
        makerworldOrientation: 'landscape',
        showSafeMargins: false,
        logo: {
            dataUrl: '',
            name: '',
            position: 'bottom-right',
            scale: 15,
            opacity: 70
        }
    };

    function defaultColorAdjust() {
        return { exposure: 0, contrast: 0, temperature: 0, vignette: 0 };
    }

    function defaultTransform() {
        return { zoom: 1.0, panX: 0, panY: 0 };
    }

    function createImageEntry(id, name, dataUrl, role) {
        return {
            id,
            name,
            dataUrl,
            role: role || 'gallery',
            image: null,
            zoom: 1.0,
            panX: 0,
            panY: 0,
            platformTransforms: {},
            color: defaultColorAdjust()
        };
    }

    function uid() {
        return `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function slugify(value) {
        const slug = String(value || 'project')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 48);
        return slug || 'project';
    }

    function getActiveImage() {
        return state.images.find((img) => img.id === state.activeImageId) || null;
    }

    function getSourceImage() {
        const active = getActiveImage();
        return active && active.image ? active.image : null;
    }

    function ensurePlatformTransform(imageEntry, platformId) {
        if (!imageEntry.platformTransforms[platformId]) {
            imageEntry.platformTransforms[platformId] = defaultTransform();
        }
        return imageEntry.platformTransforms[platformId];
    }

    function getTransformForPlatform(platformId) {
        const active = getActiveImage();
        if (!active) return defaultTransform();
        if (state.fitMode === 'cover' && platformId) {
            return ensurePlatformTransform(active, platformId);
        }
        return { zoom: active.zoom, panX: active.panX, panY: active.panY };
    }

    function getPlatformIds() {
        return getPlatforms().map((platform) => platform.id);
    }

    function getPlatforms() {
        const makerworldPortrait = state.makerworldOrientation === 'portrait';
        return [
            { id: 'printables', name: 'Printables', width: 1920, height: 1440 },
            {
                id: 'makerworld',
                name: `MakerWorld_${state.makerworldOrientation}`,
                width: makerworldPortrait ? 1440 : 1920,
                height: makerworldPortrait ? 1920 : 1440
            },
            { id: 'thangs', name: 'Thangs', width: 900, height: 1100 },
            { id: 'snapmaker', name: 'SnapmakerSpaces', width: 1920, height: 1080, checkText: true },
            {
                id: 'cults3d',
                name: 'Cults3D',
                width: 8000,
                height: 8000,
                previewWidth: 1200,
                previewHeight: 1200,
                maxBytes: 10 * 1024 * 1024
            }
        ];
    }

    const DOM = {};

    function cacheDom() {
        const ids = [
            'uploadScreen', 'fileInput', 'editorScreen', 'heroSection', 'filmstrip', 'batchCount',
            'btnFitContain', 'btnFitCover', 'btnMakerworldLandscape', 'btnMakerworldPortrait',
            'makerworld-ratio', 'bgSettingsPanel', 'bgType', 'bgCustomImageWrap', 'bgCustomImageInput',
            'btnBgCustomImage', 'btnClearBgCustomImage', 'bgCustomImageName', 'bgColorPickerWrap',
            'bgColor', 'bgGradientWrap', 'bgGradientStart', 'bgGradientEnd', 'bgGradientDirection',
            'bgTextureWrap', 'bgTexture', 'bgTextureScale', 'textureScaleVal', 'bgTextureBlur',
            'textureBlurVal', 'bgTextureBrightness', 'textureBrightnessVal', 'bgTextureColor',
            'bgBlurWrap', 'bgBlur', 'blurVal', 'edgeSoftness', 'edgeSoftnessVal', 'zoomCtrl',
            'zoomVal', 'panXCtrl', 'panYCtrl', 'cropReferencePanel', 'globalTransformPanel',
            'coverModeHint', 'canvas-reference', 'btnReset', 'btnUploadNew', 'btnDownloadHeader',
            'snapmaker-status', 'snapmaker-card', 'toast', 'toast-msg', 'toast-icon',
            'projectName', 'projectNameMobile', 'btnSaveProject', 'btnLoadProject',
            'btnExportProjectJson', 'btnImportProjectJson', 'projectJsonInput',
            'btnLoadProjectUpload', 'btnImportProjectJsonUpload', 'btnAddImages', 'btnRemoveImage',
            'imageRole', 'btnAutoCrop', 'exposureCtrl', 'exposureVal', 'contrastCtrl', 'contrastVal',
            'temperatureCtrl', 'temperatureVal', 'vignetteCtrl', 'vignetteVal', 'safeMarginToggle',
            'logoInput', 'btnLogoUpload', 'btnClearLogo', 'logoName', 'logoControls', 'logoPosition',
            'logoScale', 'logoScaleVal', 'logoOpacity', 'logoOpacityVal', 'btnSaveBrandKit',
            'btnApplyBrandKit', 'cultsSizeEstimate', 'ocrChecklistSummary', 'rolesChecklistSummary',
            'btnClearProject', 'snapmaker-canvas-wrap'
        ];
        ids.forEach((id) => {
            const key = id
                .replace(/-([a-z])/g, (_, c) => c.toUpperCase())
                .replace(/Val$/, 'ValDisplay');
            // Keep readable aliases for known elements
        });

        DOM.uploadScreen = document.getElementById('uploadScreen');
        DOM.fileInput = document.getElementById('fileInput');
        DOM.editorScreen = document.getElementById('editorScreen');
        DOM.heroSection = document.getElementById('heroSection');
        DOM.filmstrip = document.getElementById('filmstrip');
        DOM.batchCount = document.getElementById('batchCount');
        DOM.btnFitContain = document.getElementById('btnFitContain');
        DOM.btnFitCover = document.getElementById('btnFitCover');
        DOM.btnMakerworldLandscape = document.getElementById('btnMakerworldLandscape');
        DOM.btnMakerworldPortrait = document.getElementById('btnMakerworldPortrait');
        DOM.makerworldRatio = document.getElementById('makerworld-ratio');
        DOM.bgSettingsPanel = document.getElementById('bgSettingsPanel');
        DOM.bgType = document.getElementById('bgType');
        DOM.bgCustomImageWrap = document.getElementById('bgCustomImageWrap');
        DOM.bgCustomImageInput = document.getElementById('bgCustomImageInput');
        DOM.btnBgCustomImage = document.getElementById('btnBgCustomImage');
        DOM.btnClearBgCustomImage = document.getElementById('btnClearBgCustomImage');
        DOM.bgCustomImageName = document.getElementById('bgCustomImageName');
        DOM.bgColorPickerWrap = document.getElementById('bgColorPickerWrap');
        DOM.bgColor = document.getElementById('bgColor');
        DOM.bgGradientWrap = document.getElementById('bgGradientWrap');
        DOM.bgGradientStart = document.getElementById('bgGradientStart');
        DOM.bgGradientEnd = document.getElementById('bgGradientEnd');
        DOM.bgGradientDirection = document.getElementById('bgGradientDirection');
        DOM.bgTextureWrap = document.getElementById('bgTextureWrap');
        DOM.bgTexture = document.getElementById('bgTexture');
        DOM.bgTextureScale = document.getElementById('bgTextureScale');
        DOM.textureScaleValDisplay = document.getElementById('textureScaleVal');
        DOM.bgTextureBlur = document.getElementById('bgTextureBlur');
        DOM.textureBlurValDisplay = document.getElementById('textureBlurVal');
        DOM.bgTextureBrightness = document.getElementById('bgTextureBrightness');
        DOM.textureBrightnessValDisplay = document.getElementById('textureBrightnessVal');
        DOM.bgTextureColor = document.getElementById('bgTextureColor');
        DOM.bgBlurWrap = document.getElementById('bgBlurWrap');
        DOM.bgBlur = document.getElementById('bgBlur');
        DOM.blurValDisplay = document.getElementById('blurVal');
        DOM.edgeSoftness = document.getElementById('edgeSoftness');
        DOM.edgeSoftnessValDisplay = document.getElementById('edgeSoftnessVal');
        DOM.zoomCtrl = document.getElementById('zoomCtrl');
        DOM.zoomValDisplay = document.getElementById('zoomVal');
        DOM.panXCtrl = document.getElementById('panXCtrl');
        DOM.panYCtrl = document.getElementById('panYCtrl');
        DOM.cropReferencePanel = document.getElementById('cropReferencePanel');
        DOM.globalTransformPanel = document.getElementById('globalTransformPanel');
        DOM.coverModeHint = document.getElementById('coverModeHint');
        DOM.referenceCanvas = document.getElementById('canvas-reference');
        DOM.btnReset = document.getElementById('btnReset');
        DOM.btnUploadNew = document.getElementById('btnUploadNew');
        DOM.btnDownloadHeader = document.getElementById('btnDownloadHeader');
        DOM.snapmakerStatus = document.getElementById('snapmaker-status');
        DOM.snapmakerCard = document.getElementById('snapmaker-card');
        DOM.toast = document.getElementById('toast');
        DOM.toastMsg = document.getElementById('toast-msg');
        DOM.toastIcon = document.getElementById('toast-icon');
        DOM.projectName = document.getElementById('projectName');
        DOM.projectNameMobile = document.getElementById('projectNameMobile');
        DOM.btnSaveProject = document.getElementById('btnSaveProject');
        DOM.btnLoadProject = document.getElementById('btnLoadProject');
        DOM.btnExportProjectJson = document.getElementById('btnExportProjectJson');
        DOM.btnImportProjectJson = document.getElementById('btnImportProjectJson');
        DOM.projectJsonInput = document.getElementById('projectJsonInput');
        DOM.btnLoadProjectUpload = document.getElementById('btnLoadProjectUpload');
        DOM.btnImportProjectJsonUpload = document.getElementById('btnImportProjectJsonUpload');
        DOM.btnAddImages = document.getElementById('btnAddImages');
        DOM.btnRemoveImage = document.getElementById('btnRemoveImage');
        DOM.imageRole = document.getElementById('imageRole');
        DOM.btnAutoCrop = document.getElementById('btnAutoCrop');
        DOM.exposureCtrl = document.getElementById('exposureCtrl');
        DOM.exposureVal = document.getElementById('exposureVal');
        DOM.contrastCtrl = document.getElementById('contrastCtrl');
        DOM.contrastVal = document.getElementById('contrastVal');
        DOM.temperatureCtrl = document.getElementById('temperatureCtrl');
        DOM.temperatureVal = document.getElementById('temperatureVal');
        DOM.vignetteCtrl = document.getElementById('vignetteCtrl');
        DOM.vignetteVal = document.getElementById('vignetteVal');
        DOM.safeMarginToggle = document.getElementById('safeMarginToggle');
        DOM.logoInput = document.getElementById('logoInput');
        DOM.btnLogoUpload = document.getElementById('btnLogoUpload');
        DOM.btnClearLogo = document.getElementById('btnClearLogo');
        DOM.logoName = document.getElementById('logoName');
        DOM.logoControls = document.getElementById('logoControls');
        DOM.logoPosition = document.getElementById('logoPosition');
        DOM.logoScale = document.getElementById('logoScale');
        DOM.logoScaleVal = document.getElementById('logoScaleVal');
        DOM.logoOpacity = document.getElementById('logoOpacity');
        DOM.logoOpacityVal = document.getElementById('logoOpacityVal');
        DOM.btnSaveBrandKit = document.getElementById('btnSaveBrandKit');
        DOM.btnApplyBrandKit = document.getElementById('btnApplyBrandKit');
        DOM.cultsSizeEstimate = document.getElementById('cultsSizeEstimate');
        DOM.ocrChecklistSummary = document.getElementById('ocrChecklistSummary');
        DOM.rolesChecklistSummary = document.getElementById('rolesChecklistSummary');
        DOM.btnClearProject = document.getElementById('btnClearProject');
        DOM.snapmakerCanvasWrap = document.getElementById('snapmaker-canvas-wrap');
    }

    async function init() {
        cacheDom();
        setupPlatformCropControls();
        setupEventListeners();
        updateCropModeUI();
        updateLogoUI();
        syncProjectNameInputs();
        try {
            tesseractWorker = await Tesseract.createWorker('eng');
            console.log('Tesseract OCR Engine loaded successfully.');
        } catch (e) {
            console.error('Failed to load Tesseract OCR Engine', e);
            showToast('Failed to load OCR engine. Text detection may be unavailable.', false);
        }
    }

    function platformCropControlsHtml(platformId) {
        return `
            <div class="flex items-center justify-between gap-2">
                <p class="text-xs text-gray-400">Drag image to re-focus · zoom &amp; pan to crop</p>
                <button type="button" data-platform-reset="${platformId}" class="text-xs bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded text-gray-300 transition-colors shrink-0">Reset crop</button>
            </div>
            <div class="flex flex-col gap-1">
                <div class="flex justify-between text-xs text-gray-400">
                    <label for="zoom-${platformId}">Zoom</label>
                    <span data-platform-zoom-val="${platformId}">1.00x</span>
                </div>
                <input type="range" id="zoom-${platformId}" data-platform-zoom="${platformId}" min="0.5" max="3" step="0.05" value="1" class="w-full">
            </div>
            <div class="grid grid-cols-2 gap-3">
                <div class="flex flex-col gap-1">
                    <label for="panx-${platformId}" class="text-xs text-gray-400">Pan X</label>
                    <input type="range" id="panx-${platformId}" data-platform-pan-x="${platformId}" min="-100" max="100" value="0" class="w-full">
                </div>
                <div class="flex flex-col gap-1">
                    <label for="pany-${platformId}" class="text-xs text-gray-400">Pan Y</label>
                    <input type="range" id="pany-${platformId}" data-platform-pan-y="${platformId}" min="-100" max="100" value="0" class="w-full">
                </div>
            </div>
        `;
    }

    function setupPlatformCropControls() {
        document.querySelectorAll('[data-platform-controls]').forEach((panel) => {
            const platformId = panel.getAttribute('data-platform-controls');
            panel.innerHTML = platformCropControlsHtml(platformId);
        });
    }

    function syncPlatformCropControls(platformId) {
        const active = getActiveImage();
        if (!active) return;
        const transform = ensurePlatformTransform(active, platformId);
        const zoomCtrl = document.querySelector(`[data-platform-zoom="${platformId}"]`);
        const zoomVal = document.querySelector(`[data-platform-zoom-val="${platformId}"]`);
        const panXCtrl = document.querySelector(`[data-platform-pan-x="${platformId}"]`);
        const panYCtrl = document.querySelector(`[data-platform-pan-y="${platformId}"]`);
        if (!zoomCtrl || !panXCtrl || !panYCtrl) return;
        zoomCtrl.value = transform.zoom;
        if (zoomVal) zoomVal.textContent = `${transform.zoom.toFixed(2)}x`;
        panXCtrl.value = transform.panX;
        panYCtrl.value = transform.panY;
    }

    function updateCropModeUI() {
        const isCover = state.fitMode === 'cover';
        DOM.cropReferencePanel.classList.toggle('hidden', isCover);
        DOM.globalTransformPanel.classList.toggle('hidden', isCover);
        DOM.coverModeHint.classList.toggle('hidden', !isCover);
        document.querySelectorAll('.platform-crop-controls').forEach((panel) => {
            panel.classList.toggle('hidden', !isCover);
        });
        document.querySelectorAll('[data-platform-canvas]').forEach((canvas) => {
            canvas.classList.toggle('cursor-grab', isCover);
            if (!isCover) canvas.classList.remove('cursor-grabbing');
        });
        if (DOM.snapmakerCanvasWrap) {
            DOM.snapmakerCanvasWrap.classList.toggle('pb-12', !isCover);
            DOM.snapmakerCanvasWrap.classList.toggle('pb-4', isCover);
        }
    }

    function setupEventListeners() {
        const openFilePicker = (e) => {
            if (e) e.stopPropagation();
            DOM.fileInput.click();
        };

        DOM.uploadScreen.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            openFilePicker();
        });
        setupDropTarget(DOM.uploadScreen, (files) => handleFiles(files));
        setupDropTarget(DOM.editorScreen, (files) => handleFiles(files, true));

        DOM.fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length) {
                handleFiles(e.target.files, state.images.length > 0);
            }
            e.target.value = '';
        });

        document.addEventListener('paste', (e) => {
            const items = e.clipboardData && e.clipboardData.items;
            if (!items) return;
            const files = [];
            for (const item of items) {
                if (item.type && item.type.startsWith('image/')) {
                    const file = item.getAsFile();
                    if (file) files.push(file);
                }
            }
            if (files.length) {
                e.preventDefault();
                handleFiles(files, state.images.length > 0);
            }
        });

        DOM.btnFitContain.addEventListener('click', () => setFitMode('contain'));
        DOM.btnFitCover.addEventListener('click', () => setFitMode('cover'));
        DOM.btnMakerworldLandscape.addEventListener('click', () => setMakerworldOrientation('landscape'));
        DOM.btnMakerworldPortrait.addEventListener('click', () => setMakerworldOrientation('portrait'));

        DOM.bgType.addEventListener('change', (e) => {
            state.bgType = e.target.value;
            updateBgUI();
            if (state.bgType === 'custom' && !bgCustomImage) {
                DOM.bgCustomImageInput.click();
            }
            renderAll();
            scheduleCultsEstimate();
        });
        DOM.btnBgCustomImage.addEventListener('click', () => DOM.bgCustomImageInput.click());
        DOM.btnClearBgCustomImage.addEventListener('click', clearBgCustomImage);
        DOM.bgCustomImageInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) handleBgCustomImage(e.target.files[0]);
        });
        DOM.bgColor.addEventListener('input', (e) => { state.bgColor = e.target.value; renderAll(); scheduleCultsEstimate(); });
        DOM.bgGradientStart.addEventListener('input', (e) => { state.bgGradientStart = e.target.value; renderAll(); scheduleCultsEstimate(); });
        DOM.bgGradientEnd.addEventListener('input', (e) => { state.bgGradientEnd = e.target.value; renderAll(); scheduleCultsEstimate(); });
        DOM.bgGradientDirection.addEventListener('change', (e) => { state.bgGradientDirection = e.target.value; renderAll(); scheduleCultsEstimate(); });
        DOM.bgTexture.addEventListener('change', (e) => { state.bgTexture = e.target.value; renderAll(); scheduleCultsEstimate(); });
        DOM.bgTextureScale.addEventListener('input', (e) => {
            state.bgTextureScale = parseFloat(e.target.value);
            DOM.textureScaleValDisplay.textContent = `${state.bgTextureScale.toFixed(1)}x`;
            renderAll();
            scheduleCultsEstimate();
        });
        DOM.bgTextureBlur.addEventListener('input', (e) => {
            state.bgTextureBlur = parseFloat(e.target.value);
            DOM.textureBlurValDisplay.textContent = `${state.bgTextureBlur}px`;
            renderAll();
            scheduleCultsEstimate();
        });
        DOM.bgTextureBrightness.addEventListener('input', (e) => {
            state.bgTextureBrightness = parseFloat(e.target.value);
            DOM.textureBrightnessValDisplay.textContent = `${state.bgTextureBrightness.toFixed(1)}x`;
            renderAll();
            scheduleCultsEstimate();
        });
        DOM.bgTextureColor.addEventListener('input', (e) => {
            state.bgTextureColor = e.target.value;
            renderAll();
            scheduleCultsEstimate();
        });
        DOM.bgBlur.addEventListener('input', (e) => {
            state.blurVal = parseInt(e.target.value, 10);
            DOM.blurValDisplay.textContent = `${state.blurVal}px`;
            renderAll();
            scheduleCultsEstimate();
        });
        DOM.edgeSoftness.addEventListener('input', (e) => {
            state.edgeSoftness = parseInt(e.target.value, 10);
            DOM.edgeSoftnessValDisplay.textContent = `${state.edgeSoftness}px`;
            renderAll();
            scheduleCultsEstimate();
        });

        DOM.zoomCtrl.addEventListener('input', (e) => {
            const active = getActiveImage();
            if (!active) return;
            active.zoom = parseFloat(e.target.value);
            DOM.zoomValDisplay.textContent = `${active.zoom.toFixed(2)}x`;
            renderAll();
            scheduleCultsEstimate();
        });
        DOM.panXCtrl.addEventListener('input', (e) => {
            const active = getActiveImage();
            if (!active) return;
            active.panX = parseInt(e.target.value, 10);
            renderAll();
            scheduleCultsEstimate();
        });
        DOM.panYCtrl.addEventListener('input', (e) => {
            const active = getActiveImage();
            if (!active) return;
            active.panY = parseInt(e.target.value, 10);
            renderAll();
            scheduleCultsEstimate();
        });

        setupReferenceDrag();
        setupPlatformCropInteractions();

        DOM.btnReset.addEventListener('click', resetControls);
        DOM.btnUploadNew.addEventListener('click', openFilePicker);
        DOM.btnAddImages.addEventListener('click', openFilePicker);
        DOM.btnRemoveImage.addEventListener('click', removeActiveImage);
        DOM.btnDownloadHeader.addEventListener('click', generateZip);
        DOM.btnClearProject.addEventListener('click', clearProject);

        DOM.imageRole.addEventListener('change', (e) => {
            const active = getActiveImage();
            if (!active) return;
            active.role = e.target.value;
            renderFilmstrip();
            updateChecklist();
        });

        DOM.btnAutoCrop.addEventListener('click', autoCropSubject);

        const bindColor = (ctrl, valEl, key) => {
            ctrl.addEventListener('input', (e) => {
                const active = getActiveImage();
                if (!active) return;
                active.color[key] = parseInt(e.target.value, 10);
                valEl.textContent = String(active.color[key]);
                renderAll();
                scheduleCultsEstimate();
            });
        };
        bindColor(DOM.exposureCtrl, DOM.exposureVal, 'exposure');
        bindColor(DOM.contrastCtrl, DOM.contrastVal, 'contrast');
        bindColor(DOM.temperatureCtrl, DOM.temperatureVal, 'temperature');
        bindColor(DOM.vignetteCtrl, DOM.vignetteVal, 'vignette');

        DOM.safeMarginToggle.addEventListener('change', (e) => {
            state.showSafeMargins = e.target.checked;
            renderAll();
        });

        DOM.btnLogoUpload.addEventListener('click', () => DOM.logoInput.click());
        DOM.btnClearLogo.addEventListener('click', clearLogo);
        DOM.logoInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) handleLogoFile(e.target.files[0]);
        });
        DOM.logoPosition.addEventListener('change', (e) => {
            state.logo.position = e.target.value;
            renderAll();
            scheduleCultsEstimate();
        });
        DOM.logoScale.addEventListener('input', (e) => {
            state.logo.scale = parseInt(e.target.value, 10);
            DOM.logoScaleVal.textContent = `${state.logo.scale}%`;
            renderAll();
            scheduleCultsEstimate();
        });
        DOM.logoOpacity.addEventListener('input', (e) => {
            state.logo.opacity = parseInt(e.target.value, 10);
            DOM.logoOpacityVal.textContent = `${state.logo.opacity}%`;
            renderAll();
            scheduleCultsEstimate();
        });

        DOM.btnSaveBrandKit.addEventListener('click', saveBrandKit);
        DOM.btnApplyBrandKit.addEventListener('click', applyBrandKit);

        const syncName = (value) => {
            state.projectName = value || 'Untitled Project';
            syncProjectNameInputs();
        };
        DOM.projectName.addEventListener('input', (e) => syncName(e.target.value));
        DOM.projectNameMobile.addEventListener('input', (e) => syncName(e.target.value));

        DOM.btnSaveProject.addEventListener('click', () => saveProjectToStorage(true));
        DOM.btnLoadProject.addEventListener('click', () => loadProjectFromStorage(true));
        DOM.btnLoadProjectUpload.addEventListener('click', (e) => {
            e.stopPropagation();
            loadProjectFromStorage(true);
        });
        DOM.btnExportProjectJson.addEventListener('click', exportProjectJson);
        DOM.btnImportProjectJson.addEventListener('click', () => DOM.projectJsonInput.click());
        DOM.btnImportProjectJsonUpload.addEventListener('click', (e) => {
            e.stopPropagation();
            DOM.projectJsonInput.click();
        });
        DOM.projectJsonInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) importProjectJson(e.target.files[0]);
            e.target.value = '';
        });
    }

    function setupDropTarget(el, onFiles) {
        if (!el) return;
        el.addEventListener('dragover', (e) => {
            e.preventDefault();
            el.classList.add('drop-active', 'border-teal-500');
        });
        el.addEventListener('dragleave', (e) => {
            e.preventDefault();
            el.classList.remove('drop-active', 'border-teal-500');
        });
        el.addEventListener('drop', (e) => {
            e.preventDefault();
            el.classList.remove('drop-active', 'border-teal-500');
            if (e.dataTransfer.files && e.dataTransfer.files.length) {
                onFiles(e.dataTransfer.files);
            }
        });
    }

    function setFitMode(mode) {
        state.fitMode = mode;
        if (mode === 'contain') {
            DOM.btnFitContain.classList.add('bg-teal-700', 'text-white', 'shadow');
            DOM.btnFitContain.classList.remove('text-gray-400', 'hover:text-white');
            DOM.btnFitCover.classList.remove('bg-teal-700', 'text-white', 'shadow');
            DOM.btnFitCover.classList.add('text-gray-400', 'hover:text-white');
            DOM.bgSettingsPanel.style.display = 'flex';
        } else {
            DOM.btnFitCover.classList.add('bg-teal-700', 'text-white', 'shadow');
            DOM.btnFitCover.classList.remove('text-gray-400', 'hover:text-white');
            DOM.btnFitContain.classList.remove('bg-teal-700', 'text-white', 'shadow');
            DOM.btnFitContain.classList.add('text-gray-400', 'hover:text-white');
            DOM.bgSettingsPanel.style.display = 'none';
            const active = getActiveImage();
            if (active) {
                getPlatformIds().forEach((platformId) => {
                    ensurePlatformTransform(active, platformId);
                    syncPlatformCropControls(platformId);
                });
            }
        }
        updateCropModeUI();
        renderAll();
        scheduleCultsEstimate();
    }

    function setMakerworldOrientation(orientation) {
        state.makerworldOrientation = orientation;
        const isPortrait = orientation === 'portrait';
        DOM.btnMakerworldPortrait.classList.toggle('bg-teal-700', isPortrait);
        DOM.btnMakerworldPortrait.classList.toggle('text-white', isPortrait);
        DOM.btnMakerworldPortrait.classList.toggle('text-gray-400', !isPortrait);
        DOM.btnMakerworldLandscape.classList.toggle('bg-teal-700', !isPortrait);
        DOM.btnMakerworldLandscape.classList.toggle('text-white', !isPortrait);
        DOM.btnMakerworldLandscape.classList.toggle('text-gray-400', isPortrait);
        DOM.makerworldRatio.textContent = isPortrait ? '3:4 portrait' : '4:3 landscape';
        const canvas = document.getElementById('canvas-makerworld');
        canvas.classList.toggle('aspect-[4/3]', !isPortrait);
        canvas.classList.toggle('aspect-[3/4]', isPortrait);
        renderAll();
        scheduleCultsEstimate();
    }

    function updateBgUI() {
        DOM.bgColorPickerWrap.classList.add('hidden');
        DOM.bgGradientWrap.classList.add('hidden');
        DOM.bgTextureWrap.classList.add('hidden');
        DOM.bgCustomImageWrap.classList.add('hidden');
        DOM.bgBlurWrap.classList.add('hidden');

        if (state.bgType === 'color') DOM.bgColorPickerWrap.classList.remove('hidden');
        if (state.bgType === 'gradient') DOM.bgGradientWrap.classList.remove('hidden');
        if (state.bgType === 'texture') DOM.bgTextureWrap.classList.remove('hidden');
        if (state.bgType === 'custom') {
            DOM.bgCustomImageWrap.classList.remove('hidden');
            DOM.bgBlurWrap.classList.remove('hidden');
            syncBgCustomImageUI();
        }
        if (state.bgType === 'blur') DOM.bgBlurWrap.classList.remove('hidden');
    }

    function syncBgCustomImageUI() {
        const hasImage = Boolean(bgCustomImage);
        DOM.bgCustomImageName.textContent = hasImage ? state.bgCustomImageName : 'No background image selected';
        DOM.bgCustomImageName.classList.toggle('text-gray-300', hasImage);
        DOM.bgCustomImageName.classList.toggle('text-gray-500', !hasImage);
        DOM.btnClearBgCustomImage.classList.toggle('hidden', !hasImage);
        DOM.btnBgCustomImage.innerHTML = hasImage
            ? '<i class="fa-solid fa-image mr-2"></i>Replace background'
            : '<i class="fa-solid fa-image mr-2"></i>Choose background';
    }

    function clearBgCustomImage() {
        bgCustomImage = null;
        state.bgCustomImageName = '';
        state.bgCustomImageDataUrl = '';
        DOM.bgCustomImageInput.value = '';
        syncBgCustomImageUI();
        renderAll();
        scheduleCultsEstimate();
    }

    function handleBgCustomImage(file) {
        if (!file.type.startsWith('image/')) {
            showToast('Please upload a valid background image.', false);
            return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                bgCustomImage = img;
                state.bgCustomImageName = file.name;
                state.bgCustomImageDataUrl = event.target.result;
                state.bgType = 'custom';
                DOM.bgType.value = 'custom';
                updateBgUI();
                renderAll();
                scheduleCultsEstimate();
                showToast('Custom background loaded.', true);
            };
            img.onerror = () => showToast('Could not load background image.', false);
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }

    function updateLogoUI() {
        const hasLogo = Boolean(logoImage);
        DOM.logoName.textContent = hasLogo ? state.logo.name : 'No logo selected';
        DOM.logoName.classList.toggle('text-gray-300', hasLogo);
        DOM.logoName.classList.toggle('text-gray-500', !hasLogo);
        DOM.btnClearLogo.classList.toggle('hidden', !hasLogo);
        DOM.logoControls.classList.toggle('hidden', !hasLogo);
        DOM.logoPosition.value = state.logo.position;
        DOM.logoScale.value = state.logo.scale;
        DOM.logoScaleVal.textContent = `${state.logo.scale}%`;
        DOM.logoOpacity.value = state.logo.opacity;
        DOM.logoOpacityVal.textContent = `${state.logo.opacity}%`;
    }

    function clearLogo() {
        logoImage = null;
        state.logo.dataUrl = '';
        state.logo.name = '';
        DOM.logoInput.value = '';
        updateLogoUI();
        renderAll();
        scheduleCultsEstimate();
    }

    function handleLogoFile(file) {
        if (!file.type.startsWith('image/')) {
            showToast('Please upload a valid logo image.', false);
            return;
        }
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                logoImage = img;
                state.logo.dataUrl = event.target.result;
                state.logo.name = file.name;
                updateLogoUI();
                renderAll();
                scheduleCultsEstimate();
                showToast('Logo watermark loaded.', true);
            };
            img.onerror = () => showToast('Could not load logo image.', false);
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }

    function drawBlurredCoverBackground(ctx, image, cw, ch) {
        const iw = image.width;
        const ih = image.height;
        const coverScale = Math.max(cw / iw, ch / ih);
        const bgW = iw * coverScale;
        const bgH = ih * coverScale;
        const bgX = (cw - bgW) / 2;
        const bgY = (ch - bgH) / 2;
        ctx.filter = `blur(${state.blurVal}px) brightness(0.6)`;
        ctx.drawImage(image, bgX, bgY, bgW, bgH);
        ctx.filter = 'none';
    }

    function resetControls() {
        const active = getActiveImage();
        if (!active) return;
        active.zoom = 1.0;
        active.panX = 0;
        active.panY = 0;
        active.platformTransforms = {};
        active.color = defaultColorAdjust();
        state.bgTextureBlur = 0;
        state.bgTextureBrightness = 1.0;
        state.bgTextureColor = '#ffffff';
        state.blurVal = 20;
        state.edgeSoftness = 0;

        syncActiveControlsToDom();
        getPlatformIds().forEach((platformId) => {
            ensurePlatformTransform(active, platformId);
            syncPlatformCropControls(platformId);
        });
        DOM.bgTextureBlur.value = 0;
        DOM.textureBlurValDisplay.textContent = '0px';
        DOM.bgTextureBrightness.value = 1;
        DOM.textureBrightnessValDisplay.textContent = '1.0x';
        DOM.bgTextureColor.value = '#ffffff';
        DOM.bgBlur.value = 20;
        DOM.blurValDisplay.textContent = '20px';
        DOM.edgeSoftness.value = 0;
        DOM.edgeSoftnessValDisplay.textContent = '0px';
        renderAll();
        scheduleCultsEstimate();
    }

    function syncActiveControlsToDom() {
        const active = getActiveImage();
        if (!active) return;
        DOM.imageRole.value = active.role;
        DOM.zoomCtrl.value = active.zoom;
        DOM.zoomValDisplay.textContent = `${active.zoom.toFixed(2)}x`;
        DOM.panXCtrl.value = active.panX;
        DOM.panYCtrl.value = active.panY;
        DOM.exposureCtrl.value = active.color.exposure;
        DOM.exposureVal.textContent = String(active.color.exposure);
        DOM.contrastCtrl.value = active.color.contrast;
        DOM.contrastVal.textContent = String(active.color.contrast);
        DOM.temperatureCtrl.value = active.color.temperature;
        DOM.temperatureVal.textContent = String(active.color.temperature);
        DOM.vignetteCtrl.value = active.color.vignette;
        DOM.vignetteVal.textContent = String(active.color.vignette);
        getPlatformIds().forEach(syncPlatformCropControls);
    }

    function syncPanControls() {
        const active = getActiveImage();
        if (!active) return;
        DOM.panXCtrl.value = active.panX;
        DOM.panYCtrl.value = active.panY;
    }

    function syncProjectNameInputs() {
        if (DOM.projectName) DOM.projectName.value = state.projectName;
        if (DOM.projectNameMobile) DOM.projectNameMobile.value = state.projectName;
    }

    function setupReferenceDrag() {
        let dragStart = null;
        const centerSnapThreshold = 2;

        DOM.referenceCanvas.addEventListener('pointerdown', (event) => {
            const sourceImage = getSourceImage();
            if (!sourceImage || state.fitMode === 'cover') return;
            const active = getActiveImage();
            dragStart = { x: event.clientX, y: event.clientY, panX: active.panX, panY: active.panY };
            DOM.referenceCanvas.setPointerCapture(event.pointerId);
            DOM.referenceCanvas.classList.replace('cursor-grab', 'cursor-grabbing');
        });

        DOM.referenceCanvas.addEventListener('pointermove', (event) => {
            if (!dragStart) return;
            const sourceImage = getSourceImage();
            const active = getActiveImage();
            if (!sourceImage || !active) return;
            const rect = DOM.referenceCanvas.getBoundingClientRect();
            const canvasDeltaX = (event.clientX - dragStart.x) * (DOM.referenceCanvas.width / rect.width);
            const canvasDeltaY = (event.clientY - dragStart.y) * (DOM.referenceCanvas.height / rect.height);
            const scale = getImageScale(sourceImage, DOM.referenceCanvas.width, DOM.referenceCanvas.height, active.zoom);
            const panX = Math.max(-100, Math.min(100, dragStart.panX + (canvasDeltaX * 200 / (sourceImage.width * scale))));
            const panY = Math.max(-100, Math.min(100, dragStart.panY + (canvasDeltaY * 200 / (sourceImage.height * scale))));
            active.panX = Math.abs(panX) < centerSnapThreshold ? 0 : panX;
            active.panY = Math.abs(panY) < centerSnapThreshold ? 0 : panY;
            syncPanControls();
            renderAll();
            scheduleCultsEstimate();
        });

        const finishDrag = () => {
            dragStart = null;
            DOM.referenceCanvas.classList.replace('cursor-grabbing', 'cursor-grab');
        };
        DOM.referenceCanvas.addEventListener('pointerup', finishDrag);
        DOM.referenceCanvas.addEventListener('pointercancel', finishDrag);
    }

    function setupPlatformCropInteractions() {
        const centerSnapThreshold = 2;
        const dragState = { platformId: null, start: null };

        document.querySelectorAll('[data-platform-canvas]').forEach((canvas) => {
            const platformId = canvas.getAttribute('data-platform-canvas');

            canvas.addEventListener('pointerdown', (event) => {
                const sourceImage = getSourceImage();
                const active = getActiveImage();
                if (!sourceImage || !active || state.fitMode !== 'cover') return;
                const transform = ensurePlatformTransform(active, platformId);
                dragState.platformId = platformId;
                dragState.start = {
                    x: event.clientX,
                    y: event.clientY,
                    panX: transform.panX,
                    panY: transform.panY
                };
                canvas.setPointerCapture(event.pointerId);
                canvas.classList.replace('cursor-grab', 'cursor-grabbing');
            });

            canvas.addEventListener('pointermove', (event) => {
                if (!dragState.start || dragState.platformId !== platformId) return;
                const sourceImage = getSourceImage();
                const active = getActiveImage();
                if (!sourceImage || !active) return;
                const transform = ensurePlatformTransform(active, platformId);
                const rect = canvas.getBoundingClientRect();
                const canvasDeltaX = (event.clientX - dragState.start.x) * (canvas.width / rect.width);
                const canvasDeltaY = (event.clientY - dragState.start.y) * (canvas.height / rect.height);
                const scale = getImageScale(sourceImage, canvas.width, canvas.height, transform.zoom);
                const panX = Math.max(-100, Math.min(100, dragState.start.panX + (canvasDeltaX * 200 / (sourceImage.width * scale))));
                const panY = Math.max(-100, Math.min(100, dragState.start.panY + (canvasDeltaY * 200 / (sourceImage.height * scale))));
                transform.panX = Math.abs(panX) < centerSnapThreshold ? 0 : panX;
                transform.panY = Math.abs(panY) < centerSnapThreshold ? 0 : panY;
                syncPlatformCropControls(platformId);
                renderPlatform(platformId);
                scheduleCultsEstimate();
            });

            const finishDrag = () => {
                if (dragState.platformId === platformId) {
                    dragState.platformId = null;
                    dragState.start = null;
                }
                if (state.fitMode === 'cover') {
                    canvas.classList.replace('cursor-grabbing', 'cursor-grab');
                }
            };
            canvas.addEventListener('pointerup', finishDrag);
            canvas.addEventListener('pointercancel', finishDrag);
        });

        document.querySelectorAll('[data-platform-zoom]').forEach((input) => {
            input.addEventListener('input', (event) => {
                const platformId = event.target.getAttribute('data-platform-zoom');
                const active = getActiveImage();
                if (!active) return;
                const transform = ensurePlatformTransform(active, platformId);
                transform.zoom = parseFloat(event.target.value);
                const zoomVal = document.querySelector(`[data-platform-zoom-val="${platformId}"]`);
                if (zoomVal) zoomVal.textContent = `${transform.zoom.toFixed(2)}x`;
                renderPlatform(platformId);
                scheduleCultsEstimate();
            });
        });

        document.querySelectorAll('[data-platform-pan-x]').forEach((input) => {
            input.addEventListener('input', (event) => {
                const platformId = event.target.getAttribute('data-platform-pan-x');
                const active = getActiveImage();
                if (!active) return;
                ensurePlatformTransform(active, platformId).panX = parseInt(event.target.value, 10);
                renderPlatform(platformId);
                scheduleCultsEstimate();
            });
        });

        document.querySelectorAll('[data-platform-pan-y]').forEach((input) => {
            input.addEventListener('input', (event) => {
                const platformId = event.target.getAttribute('data-platform-pan-y');
                const active = getActiveImage();
                if (!active) return;
                ensurePlatformTransform(active, platformId).panY = parseInt(event.target.value, 10);
                renderPlatform(platformId);
                scheduleCultsEstimate();
            });
        });

        document.querySelectorAll('[data-platform-reset]').forEach((button) => {
            button.addEventListener('click', (event) => {
                const platformId = event.currentTarget.getAttribute('data-platform-reset');
                const active = getActiveImage();
                if (!active) return;
                active.platformTransforms[platformId] = defaultTransform();
                syncPlatformCropControls(platformId);
                renderPlatform(platformId);
                scheduleCultsEstimate();
            });
        });
    }

    function showToast(msg, isSuccess = true) {
        DOM.toastMsg.textContent = msg;
        DOM.toastIcon.className = isSuccess
            ? 'fa-solid fa-circle-check text-green-400'
            : 'fa-solid fa-circle-exclamation text-red-400';
        DOM.toast.classList.remove('opacity-0', 'translate-y-10', 'pointer-events-none');
        setTimeout(() => {
            DOM.toast.classList.add('opacity-0', 'translate-y-10', 'pointer-events-none');
        }, 3000);
    }

    function fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('read failed'));
            reader.readAsDataURL(file);
        });
    }

    function loadHtmlImage(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('image load failed'));
            img.src = dataUrl;
        });
    }

    async function handleFiles(fileList, append = false) {
        const files = Array.from(fileList).filter((f) => f.type && f.type.startsWith('image/'));
        if (!files.length) {
            showToast('Please upload valid image files.', false);
            return;
        }

        if (!append) {
            state.images = [];
            state.activeImageId = null;
        }

        let firstNewId = null;
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                const dataUrl = await fileToDataUrl(file);
                const image = await loadHtmlImage(dataUrl);
                const role = (!append && state.images.length === 0 && i === 0) ? 'hero' : 'gallery';
                const entry = createImageEntry(uid(), file.name || `image-${state.images.length + 1}`, dataUrl, role);
                entry.image = image;
                state.images.push(entry);
                if (!firstNewId) firstNewId = entry.id;
            } catch (err) {
                console.error(err);
                showToast(`Could not load ${file.name || 'image'}.`, false);
            }
        }

        if (!state.images.length) return;

        if (!append || !state.activeImageId) {
            state.activeImageId = firstNewId || state.images[0].id;
        }

        showEditor();
        renderFilmstrip();
        syncActiveControlsToDom();
        setFitMode(state.fitMode);
        renderAll();
        scheduleCultsEstimate();
        updateChecklist();
        showToast(`${files.length} image${files.length > 1 ? 's' : ''} loaded.`, true);
    }

    function showEditor() {
        DOM.heroSection.classList.add('hidden');
        DOM.uploadScreen.classList.add('hidden');
        DOM.editorScreen.classList.remove('hidden');
        DOM.btnDownloadHeader.classList.remove('hidden');
    }

    function showUpload() {
        DOM.heroSection.classList.remove('hidden');
        DOM.uploadScreen.classList.remove('hidden');
        DOM.editorScreen.classList.add('hidden');
        DOM.btnDownloadHeader.classList.add('hidden');
    }

    function renderFilmstrip() {
        DOM.filmstrip.innerHTML = '';
        DOM.batchCount.textContent = `${state.images.length} image${state.images.length === 1 ? '' : 's'}`;
        state.images.forEach((entry, index) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `filmstrip-item relative shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-gray-700 bg-black ${entry.id === state.activeImageId ? 'active' : ''}`;
            btn.title = `${index + 1}. ${entry.name} (${entry.role})`;
            btn.innerHTML = `
                <img src="${entry.dataUrl}" alt="" class="w-full h-full object-cover">
                <span class="absolute bottom-0 left-0 right-0 bg-black/70 text-[10px] text-center text-gray-200 py-0.5 capitalize">${entry.role}</span>
            `;
            btn.addEventListener('click', () => setActiveImage(entry.id));
            DOM.filmstrip.appendChild(btn);
        });
        updateChecklist();
    }

    function setActiveImage(id) {
        if (state.activeImageId === id) return;
        state.activeImageId = id;
        renderFilmstrip();
        syncActiveControlsToDom();
        renderAll();
        scheduleCultsEstimate();
    }

    function removeActiveImage() {
        if (!state.images.length) return;
        const idx = state.images.findIndex((img) => img.id === state.activeImageId);
        if (idx < 0) return;
        state.images.splice(idx, 1);
        if (!state.images.length) {
            clearProject();
            return;
        }
        state.activeImageId = state.images[Math.max(0, idx - 1)].id;
        renderFilmstrip();
        syncActiveControlsToDom();
        renderAll();
        scheduleCultsEstimate();
    }

    function clearProject() {
        state.images = [];
        state.activeImageId = null;
        lastOcrSummary = 'Waiting…';
        cultsSizeText = '—';
        if (DOM.ocrChecklistSummary) DOM.ocrChecklistSummary.textContent = lastOcrSummary;
        if (DOM.cultsSizeEstimate) DOM.cultsSizeEstimate.textContent = cultsSizeText;
        showUpload();
        renderFilmstrip();
    }

    function updateChecklist() {
        const counts = { hero: 0, gallery: 0, detail: 0 };
        state.images.forEach((img) => {
            if (counts[img.role] !== undefined) counts[img.role] += 1;
        });
        if (DOM.rolesChecklistSummary) {
            DOM.rolesChecklistSummary.textContent = `H${counts.hero} · G${counts.gallery} · D${counts.detail}`;
        }
        if (DOM.ocrChecklistSummary) DOM.ocrChecklistSummary.textContent = lastOcrSummary;
        if (DOM.cultsSizeEstimate) DOM.cultsSizeEstimate.textContent = cultsSizeText;
    }

    function scheduleCultsEstimate() {
        clearTimeout(cultsEstimateTimeout);
        cultsEstimateTimeout = setTimeout(updateCultsSizeEstimate, 500);
    }

    async function updateCultsSizeEstimate() {
        const active = getActiveImage();
        if (!active || !active.image) {
            cultsSizeText = '—';
            updateChecklist();
            return;
        }
        try {
            const platform = getPlatforms().find((p) => p.id === 'cults3d');
            // Estimate on a smaller canvas then scale byte count roughly to full export
            const estimateCanvas = document.createElement('canvas');
            const previewW = 1200;
            const previewH = 1200;
            renderCanvas(estimateCanvas, previewW, previewH, getTransformForPlatform('cults3d'), {
                sourceImage: active.image,
                color: active.color,
                drawOverlays: false
            });
            const blob = await canvasToJpegBlob(estimateCanvas, 0.9);
            if (!blob) {
                cultsSizeText = '—';
            } else {
                const areaScale = (platform.width * platform.height) / (previewW * previewH);
                const estimated = Math.min(platform.maxBytes, Math.round(blob.size * Math.sqrt(areaScale)));
                const mb = estimated / (1024 * 1024);
                const ok = estimated <= platform.maxBytes;
                cultsSizeText = `~${mb.toFixed(1)} MB${ok ? '' : ' (over)'}`;
                DOM.cultsSizeEstimate.classList.toggle('text-red-400', !ok);
                DOM.cultsSizeEstimate.classList.toggle('text-pink-300', ok);
            }
        } catch (err) {
            console.error(err);
            cultsSizeText = '—';
        }
        updateChecklist();
    }

    function autoCropSubject() {
        const sourceImage = getSourceImage();
        const active = getActiveImage();
        if (!sourceImage || !active) return;

        const sample = document.createElement('canvas');
        const maxDim = 160;
        const scale = Math.min(1, maxDim / Math.max(sourceImage.width, sourceImage.height));
        sample.width = Math.max(1, Math.round(sourceImage.width * scale));
        sample.height = Math.max(1, Math.round(sourceImage.height * scale));
        const ctx = sample.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(sourceImage, 0, 0, sample.width, sample.height);
        const { data, width, height } = ctx.getImageData(0, 0, sample.width, sample.height);

        const lum = new Float32Array(width * height);
        let sum = 0;
        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
            const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
            lum[p] = y;
            sum += y;
        }
        const mean = sum / lum.length;

        const score = new Float32Array(width * height);
        let maxScore = 0;
        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const i = y * width + x;
                const gx = Math.abs(lum[i - 1] - lum[i + 1]);
                const gy = Math.abs(lum[i - width] - lum[i + width]);
                const edge = gx + gy;
                const contrast = Math.abs(lum[i] - mean);
                const s = edge * 1.4 + contrast * 0.6;
                score[i] = s;
                if (s > maxScore) maxScore = s;
            }
        }

        const threshold = maxScore * 0.28;
        let minX = width;
        let minY = height;
        let maxX = 0;
        let maxY = 0;
        let hits = 0;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (score[y * width + x] >= threshold) {
                    hits += 1;
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                }
            }
        }

        if (hits < 20) {
            showToast('Could not detect a clear subject. Adjust crop manually.', false);
            return;
        }

        // Expand box slightly
        const padX = (maxX - minX) * 0.12;
        const padY = (maxY - minY) * 0.12;
        minX = Math.max(0, minX - padX);
        minY = Math.max(0, minY - padY);
        maxX = Math.min(width - 1, maxX + padX);
        maxY = Math.min(height - 1, maxY + padY);

        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const boxW = Math.max(8, maxX - minX);
        const boxH = Math.max(8, maxY - minY);

        // Map subject center to pan: image center is 0,0; edges approach ±100
        const panX = Math.max(-100, Math.min(100, ((width / 2) - cx) / (width / 2) * 100));
        const panY = Math.max(-100, Math.min(100, ((height / 2) - cy) / (height / 2) * 100));
        const fillRatio = Math.max(boxW / width, boxH / height);
        const zoom = Math.max(0.5, Math.min(3, 0.92 / fillRatio));

        if (state.fitMode === 'cover') {
            getPlatformIds().forEach((platformId) => {
                const t = ensurePlatformTransform(active, platformId);
                t.zoom = zoom;
                t.panX = panX;
                t.panY = panY;
                syncPlatformCropControls(platformId);
            });
        } else {
            active.zoom = zoom;
            active.panX = panX;
            active.panY = panY;
            syncActiveControlsToDom();
        }

        renderAll();
        scheduleCultsEstimate();
        showToast('Auto-crop applied from subject analysis.', true);
    }

    function renderPlatform(platformId) {
        const sourceImage = getSourceImage();
        const active = getActiveImage();
        if (!sourceImage || !active) return;
        const platform = getPlatforms().find((item) => item.id === platformId);
        if (!platform) return;
        const canvas = document.getElementById(`canvas-${platform.id}`);
        if (!canvas) return;
        const previewW = platform.previewWidth || platform.width;
        const previewH = platform.previewHeight || platform.height;
        renderCanvas(canvas, previewW, previewH, getTransformForPlatform(platform.id), {
            sourceImage,
            color: active.color,
            drawOverlays: true
        });
        if (platform.checkText) {
            triggerTextCheck(canvas);
        }
    }

    function renderAll() {
        const sourceImage = getSourceImage();
        const active = getActiveImage();
        if (!sourceImage || !active) return;

        if (state.fitMode === 'contain') {
            renderCanvas(DOM.referenceCanvas, 800, 600, getTransformForPlatform(null), {
                sourceImage,
                color: active.color,
                drawOverlays: true
            });
        }

        getPlatforms().forEach((platform) => {
            renderPlatform(platform.id);
        });
    }

    function canvasToJpegBlob(canvas, quality) {
        return new Promise((resolve) => {
            canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
        });
    }

    async function exportPlatformBlob(platform, imageEntry) {
        const exportCanvas = document.createElement('canvas');
        let width = platform.width;
        let height = platform.height;
        const transform = state.fitMode === 'cover'
            ? ensurePlatformTransform(imageEntry, platform.id)
            : { zoom: imageEntry.zoom, panX: imageEntry.panX, panY: imageEntry.panY };

        renderCanvas(exportCanvas, width, height, transform, {
            sourceImage: imageEntry.image,
            color: imageEntry.color,
            drawOverlays: false
        });

        let quality = 0.95;
        let blob = await canvasToJpegBlob(exportCanvas, quality);

        if (!platform.maxBytes) {
            return { blob, width, height };
        }

        while (blob && blob.size > platform.maxBytes && quality > 0.55) {
            quality = Math.round((quality - 0.05) * 100) / 100;
            blob = await canvasToJpegBlob(exportCanvas, quality);
        }

        while (blob && blob.size > platform.maxBytes && width > 800) {
            width = Math.round(width * 0.85);
            height = Math.round(height * 0.85);
            width = Math.min(width, 8000);
            height = Math.min(height, 8000);
            renderCanvas(exportCanvas, width, height, transform, {
                sourceImage: imageEntry.image,
                color: imageEntry.color,
                drawOverlays: false
            });
            quality = 0.9;
            blob = await canvasToJpegBlob(exportCanvas, quality);
            while (blob && blob.size > platform.maxBytes && quality > 0.55) {
                quality = Math.round((quality - 0.05) * 100) / 100;
                blob = await canvasToJpegBlob(exportCanvas, quality);
            }
        }

        return { blob, width, height };
    }

    function getTexturePattern(ctx, type) {
        const patCanvas = document.createElement('canvas');
        const pCtx = patCanvas.getContext('2d');

        if (type === 'texture_dot') {
            patCanvas.width = 20; patCanvas.height = 20;
            pCtx.fillStyle = '#111827';
            pCtx.fillRect(0, 0, 20, 20);
            pCtx.fillStyle = '#374151';
            pCtx.beginPath();
            pCtx.arc(10, 10, 3, 0, Math.PI * 2);
            pCtx.fill();
        } else if (type === 'texture_line') {
            patCanvas.width = 40; patCanvas.height = 40;
            pCtx.fillStyle = '#1f2937';
            pCtx.fillRect(0, 0, 40, 40);
            pCtx.strokeStyle = '#111827';
            pCtx.lineWidth = 4;
            pCtx.beginPath();
            pCtx.moveTo(0, 40);
            pCtx.lineTo(40, 0);
            pCtx.moveTo(-10, 10);
            pCtx.lineTo(10, -10);
            pCtx.moveTo(30, 50);
            pCtx.lineTo(50, 30);
            pCtx.stroke();
        } else if (type === 'texture_grid') {
            patCanvas.width = 32; patCanvas.height = 32;
            pCtx.fillStyle = '#172033';
            pCtx.fillRect(0, 0, 32, 32);
            pCtx.strokeStyle = '#334155';
            pCtx.lineWidth = 1;
            pCtx.beginPath();
            pCtx.moveTo(0, 0);
            pCtx.lineTo(32, 0);
            pCtx.moveTo(0, 0);
            pCtx.lineTo(0, 32);
            pCtx.stroke();
        } else if (type === 'texture_crosshatch') {
            patCanvas.width = 24; patCanvas.height = 24;
            pCtx.fillStyle = '#1c1917';
            pCtx.fillRect(0, 0, 24, 24);
            pCtx.strokeStyle = '#57534e';
            pCtx.lineWidth = 1;
            pCtx.beginPath();
            pCtx.moveTo(0, 24);
            pCtx.lineTo(24, 0);
            pCtx.moveTo(0, 0);
            pCtx.lineTo(24, 24);
            pCtx.stroke();
        } else if (type === 'texture_checkerboard') {
            patCanvas.width = 32; patCanvas.height = 32;
            pCtx.fillStyle = '#111827';
            pCtx.fillRect(0, 0, 32, 32);
            pCtx.fillStyle = '#1f2937';
            pCtx.fillRect(0, 0, 16, 16);
            pCtx.fillRect(16, 16, 16, 16);
        } else if (type === 'texture_wave') {
            patCanvas.width = 48; patCanvas.height = 24;
            pCtx.fillStyle = '#0c4a6e';
            pCtx.fillRect(0, 0, 48, 24);
            pCtx.strokeStyle = '#38bdf8';
            pCtx.lineWidth = 2;
            pCtx.beginPath();
            pCtx.moveTo(0, 6);
            pCtx.quadraticCurveTo(12, 0, 24, 6);
            pCtx.quadraticCurveTo(36, 12, 48, 6);
            pCtx.moveTo(0, 18);
            pCtx.quadraticCurveTo(12, 12, 24, 18);
            pCtx.quadraticCurveTo(36, 24, 48, 18);
            pCtx.stroke();
        } else if (type === 'texture_hex') {
            patCanvas.width = 36; patCanvas.height = 42;
            pCtx.fillStyle = '#1e1b4b';
            pCtx.fillRect(0, 0, 36, 42);
            pCtx.strokeStyle = '#6366f1';
            pCtx.lineWidth = 1;
            for (let y = -21; y < 63; y += 21) {
                for (let x = -18; x < 54; x += 36) {
                    const centerX = x + (Math.round((y + 21) / 21) % 2) * 18;
                    pCtx.beginPath();
                    for (let i = 0; i < 6; i++) {
                        const angle = Math.PI / 3 * i;
                        const pointX = centerX + 12 * Math.cos(angle);
                        const pointY = y + 12 * Math.sin(angle);
                        if (i === 0) pCtx.moveTo(pointX, pointY);
                        else pCtx.lineTo(pointX, pointY);
                    }
                    pCtx.closePath();
                    pCtx.stroke();
                }
            }
        } else if (type === 'texture_brick') {
            patCanvas.width = 48; patCanvas.height = 32;
            pCtx.fillStyle = '#3f1d1d';
            pCtx.fillRect(0, 0, 48, 32);
            pCtx.strokeStyle = '#a85a4a';
            pCtx.lineWidth = 2;
            pCtx.beginPath();
            pCtx.moveTo(0, 0); pCtx.lineTo(48, 0);
            pCtx.moveTo(0, 16); pCtx.lineTo(48, 16);
            pCtx.moveTo(24, 0); pCtx.lineTo(24, 16);
            pCtx.moveTo(0, 16); pCtx.lineTo(0, 32);
            pCtx.moveTo(48, 16); pCtx.lineTo(48, 32);
            pCtx.stroke();
        } else if (type === 'texture_triangle') {
            patCanvas.width = 40; patCanvas.height = 35;
            pCtx.fillStyle = '#172554';
            pCtx.fillRect(0, 0, 40, 35);
            pCtx.strokeStyle = '#60a5fa';
            pCtx.lineWidth = 1;
            pCtx.beginPath();
            pCtx.moveTo(0, 35); pCtx.lineTo(20, 0); pCtx.lineTo(40, 35);
            pCtx.moveTo(0, 0); pCtx.lineTo(40, 0);
            pCtx.stroke();
        } else if (type === 'texture_plaid') {
            patCanvas.width = 40; patCanvas.height = 40;
            pCtx.fillStyle = '#1e293b';
            pCtx.fillRect(0, 0, 40, 40);
            pCtx.fillStyle = '#475569';
            pCtx.fillRect(0, 0, 8, 40);
            pCtx.fillRect(20, 0, 4, 40);
            pCtx.fillStyle = 'rgba(148, 163, 184, 0.45)';
            pCtx.fillRect(0, 0, 40, 8);
            pCtx.fillRect(0, 20, 40, 4);
        } else if (type === 'texture_star') {
            patCanvas.width = 36; patCanvas.height = 36;
            pCtx.fillStyle = '#312e81';
            pCtx.fillRect(0, 0, 36, 36);
            pCtx.fillStyle = '#fef3c7';
            for (const [x, y, radius] of [[8, 9, 2], [27, 7, 1.5], [19, 24, 2.5], [4, 29, 1]]) {
                pCtx.beginPath();
                for (let i = 0; i < 10; i++) {
                    const angle = -Math.PI / 2 + i * Math.PI / 5;
                    const r = i % 2 === 0 ? radius : radius / 2;
                    const pointX = x + r * Math.cos(angle);
                    const pointY = y + r * Math.sin(angle);
                    if (i === 0) pCtx.moveTo(pointX, pointY);
                    else pCtx.lineTo(pointX, pointY);
                }
                pCtx.fill();
            }
        } else if (type === 'texture_circuit') {
            patCanvas.width = 48; patCanvas.height = 48;
            pCtx.fillStyle = '#052e16';
            pCtx.fillRect(0, 0, 48, 48);
            pCtx.strokeStyle = '#34d399';
            pCtx.lineWidth = 2;
            pCtx.beginPath();
            pCtx.moveTo(0, 12); pCtx.lineTo(18, 12); pCtx.lineTo(24, 18); pCtx.lineTo(48, 18);
            pCtx.moveTo(12, 48); pCtx.lineTo(12, 30); pCtx.lineTo(30, 30); pCtx.lineTo(36, 24); pCtx.lineTo(36, 0);
            pCtx.stroke();
            pCtx.fillStyle = '#a7f3d0';
            pCtx.fillRect(21, 15, 6, 6);
            pCtx.fillRect(9, 27, 6, 6);
        } else if (type === 'texture_topography') {
            patCanvas.width = 56; patCanvas.height = 56;
            pCtx.fillStyle = '#422006';
            pCtx.fillRect(0, 0, 56, 56);
            pCtx.strokeStyle = '#fbbf24';
            pCtx.lineWidth = 1;
            for (let radius = 9; radius <= 31; radius += 7) {
                pCtx.beginPath();
                pCtx.ellipse(28, 28, radius, radius * 0.65, -0.4, 0, Math.PI * 2);
                pCtx.stroke();
            }
        } else if (type === 'texture_confetti') {
            patCanvas.width = 48; patCanvas.height = 48;
            pCtx.fillStyle = '#4c1d95';
            pCtx.fillRect(0, 0, 48, 48);
            const pieces = [[8, 8, '#facc15', 0.8], [29, 9, '#fb7185', -0.5], [18, 25, '#22d3ee', 0.4], [39, 32, '#a3e635', -0.8], [7, 40, '#f97316', 0.2]];
            pieces.forEach(([x, y, color, rotation]) => {
                pCtx.save();
                pCtx.translate(x, y);
                pCtx.rotate(rotation);
                pCtx.fillStyle = color;
                pCtx.fillRect(-2, -5, 4, 10);
                pCtx.restore();
            });
        }
        const pattern = ctx.createPattern(patCanvas, 'repeat');
        pattern.setTransform(new DOMMatrix().scale(state.bgTextureScale));
        return pattern;
    }

    function getGradient(ctx, width, height) {
        let x1 = 0;
        let y1 = 0;
        let x2 = width;
        let y2 = height;

        if (state.bgGradientDirection === 'horizontal') {
            y2 = 0;
        } else if (state.bgGradientDirection === 'vertical') {
            x2 = 0;
        } else if (state.bgGradientDirection === 'diagonal-reverse') {
            y1 = height;
            y2 = 0;
        }

        const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
        gradient.addColorStop(0, state.bgGradientStart);
        gradient.addColorStop(1, state.bgGradientEnd);
        return gradient;
    }

    function applyColorAdjustments(ctx, cw, ch, color) {
        if (!color) return;
        const { exposure, contrast, temperature, vignette } = color;
        if (!exposure && !contrast && !temperature && !vignette) return;

        // Composite filters — avoid getImageData on large Cults canvases
        if (exposure || contrast) {
            const brightness = 1 + (exposure / 100);
            const contrastPct = 100 + contrast;
            const tmp = document.createElement('canvas');
            tmp.width = cw;
            tmp.height = ch;
            const tctx = tmp.getContext('2d');
            tctx.filter = `brightness(${brightness}) contrast(${contrastPct}%)`;
            tctx.drawImage(ctx.canvas, 0, 0);
            ctx.clearRect(0, 0, cw, ch);
            ctx.drawImage(tmp, 0, 0);
        }

        if (temperature) {
            ctx.save();
            ctx.globalCompositeOperation = temperature > 0 ? 'soft-light' : 'soft-light';
            const alpha = Math.min(0.45, Math.abs(temperature) / 100 * 0.55);
            ctx.fillStyle = temperature > 0
                ? `rgba(255, 170, 80, ${alpha})`
                : `rgba(80, 140, 255, ${alpha})`;
            ctx.fillRect(0, 0, cw, ch);
            ctx.restore();
        }

        if (vignette > 0) {
            const grd = ctx.createRadialGradient(
                cw / 2, ch / 2, Math.min(cw, ch) * 0.25,
                cw / 2, ch / 2, Math.sqrt(cw * cw + ch * ch) / 2
            );
            grd.addColorStop(0, 'rgba(0,0,0,0)');
            grd.addColorStop(1, `rgba(0,0,0,${(vignette / 100) * 0.75})`);
            ctx.fillStyle = grd;
            ctx.fillRect(0, 0, cw, ch);
        }
    }

    function drawLogo(ctx, cw, ch) {
        if (!logoImage) return;
        const maxLogoW = cw * (state.logo.scale / 100);
        const ratio = logoImage.height / logoImage.width;
        const logoW = maxLogoW;
        const logoH = maxLogoW * ratio;
        const margin = Math.min(cw, ch) * 0.04;
        let x = margin;
        let y = margin;
        const pos = state.logo.position;
        if (pos.includes('right')) x = cw - logoW - margin;
        if (pos.includes('bottom')) y = ch - logoH - margin;
        if (pos === 'center') {
            x = (cw - logoW) / 2;
            y = (ch - logoH) / 2;
        }
        ctx.save();
        ctx.globalAlpha = state.logo.opacity / 100;
        ctx.drawImage(logoImage, x, y, logoW, logoH);
        ctx.restore();
    }

    function drawSafeMargins(ctx, cw, ch) {
        if (!state.showSafeMargins) return;
        const insetX = cw * SAFE_MARGIN_PCT;
        const insetY = ch * SAFE_MARGIN_PCT;
        ctx.save();
        ctx.strokeStyle = 'rgba(45, 212, 191, 0.85)';
        ctx.lineWidth = Math.max(1, Math.min(cw, ch) * 0.004);
        ctx.setLineDash([Math.max(4, cw * 0.01), Math.max(3, cw * 0.008)]);
        ctx.strokeRect(insetX, insetY, cw - insetX * 2, ch - insetY * 2);
        ctx.restore();
    }

    function renderCanvas(canvas, targetWidth, targetHeight, transform, options = {}) {
        const sourceImage = options.sourceImage || getSourceImage();
        const color = options.color || (getActiveImage() && getActiveImage().color) || defaultColorAdjust();
        const drawOverlays = options.drawOverlays !== false;

        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        const activeTransform = transform || defaultTransform();

        const iw = sourceImage.width;
        const ih = sourceImage.height;
        const cw = canvas.width;
        const ch = canvas.height;

        ctx.clearRect(0, 0, cw, ch);

        const scale = getImageScale(sourceImage, cw, ch, activeTransform.zoom);
        const scaledW = iw * scale;
        const scaledH = ih * scale;
        const offsetX = (scaledW * (activeTransform.panX / 200));
        const offsetY = (scaledH * (activeTransform.panY / 200));
        const x = (cw - scaledW) / 2 + offsetX;
        const y = (ch - scaledH) / 2 + offsetY;

        if (state.fitMode === 'contain') {
            if (state.bgType === 'blur') {
                drawBlurredCoverBackground(ctx, sourceImage, cw, ch);
            } else if (state.bgType === 'custom') {
                if (bgCustomImage) {
                    drawBlurredCoverBackground(ctx, bgCustomImage, cw, ch);
                } else {
                    ctx.fillStyle = '#111827';
                    ctx.fillRect(0, 0, cw, ch);
                }
            } else if (state.bgType === 'color') {
                ctx.fillStyle = state.bgColor;
                ctx.fillRect(0, 0, cw, ch);
            } else if (state.bgType === 'texture') {
                ctx.save();
                ctx.filter = `blur(${state.bgTextureBlur}px) brightness(${state.bgTextureBrightness})`;
                ctx.fillStyle = getTexturePattern(ctx, state.bgTexture);
                ctx.fillRect(0, 0, cw, ch);
                if (state.bgTextureColor && state.bgTextureColor !== '#ffffff') {
                    ctx.globalCompositeOperation = 'color';
                    ctx.fillStyle = state.bgTextureColor;
                    ctx.fillRect(0, 0, cw, ch);
                }
                ctx.restore();
            } else if (state.bgType === 'gradient') {
                ctx.fillStyle = getGradient(ctx, cw, ch);
                ctx.fillRect(0, 0, cw, ch);
            }
        }

        if (state.fitMode === 'contain' && state.edgeSoftness > 0) {
            const edgeSoftness = Math.min(state.edgeSoftness, scaledW / 2, scaledH / 2);
            const foregroundCanvas = document.createElement('canvas');
            foregroundCanvas.width = cw;
            foregroundCanvas.height = ch;
            const foregroundCtx = foregroundCanvas.getContext('2d');

            foregroundCtx.drawImage(sourceImage, x, y, scaledW, scaledH);
            foregroundCtx.globalCompositeOperation = 'destination-in';

            const horizontalMask = foregroundCtx.createLinearGradient(x, 0, x + scaledW, 0);
            horizontalMask.addColorStop(0, 'transparent');
            horizontalMask.addColorStop(edgeSoftness / scaledW, 'black');
            horizontalMask.addColorStop(1 - edgeSoftness / scaledW, 'black');
            horizontalMask.addColorStop(1, 'transparent');
            foregroundCtx.fillStyle = horizontalMask;
            foregroundCtx.fillRect(x, y, scaledW, scaledH);

            const verticalMask = foregroundCtx.createLinearGradient(0, y, 0, y + scaledH);
            verticalMask.addColorStop(0, 'transparent');
            verticalMask.addColorStop(edgeSoftness / scaledH, 'black');
            verticalMask.addColorStop(1 - edgeSoftness / scaledH, 'black');
            verticalMask.addColorStop(1, 'transparent');
            foregroundCtx.fillStyle = verticalMask;
            foregroundCtx.fillRect(x, y, scaledW, scaledH);

            ctx.drawImage(foregroundCanvas, 0, 0);
        } else {
            ctx.drawImage(sourceImage, x, y, scaledW, scaledH);
        }

        applyColorAdjustments(ctx, cw, ch, color);
        drawLogo(ctx, cw, ch);
        if (drawOverlays) drawSafeMargins(ctx, cw, ch);
    }

    function getImageScale(sourceImage, canvasWidth, canvasHeight, zoom) {
        const baseScale = state.fitMode === 'contain'
            ? Math.min(canvasWidth / sourceImage.width, canvasHeight / sourceImage.height)
            : Math.max(canvasWidth / sourceImage.width, canvasHeight / sourceImage.height);
        return baseScale * zoom;
    }

    function triggerTextCheck(sourceCanvas) {
        DOM.snapmakerStatus.className = 'absolute bottom-0 left-0 w-full p-2 text-xs font-semibold flex items-center justify-center gap-2 bg-teal-900 text-teal-200 h-10';
        DOM.snapmakerStatus.innerHTML = '<div class="spinner border-teal-400 border-l-white"></div> Scanning for text (Rules check)...';
        DOM.snapmakerCard.classList.remove('border-b-green-500', 'border-b-red-500');
        DOM.snapmakerCard.classList.add('border-b-gray-800');
        lastOcrSummary = 'Scanning…';
        updateChecklist();

        clearTimeout(textCheckTimeout);

        textCheckTimeout = setTimeout(async () => {
            if (!tesseractWorker) {
                DOM.snapmakerStatus.innerHTML = '<i class="fa-solid fa-triangle-exclamation text-yellow-400"></i> OCR Engine Not Loaded';
                DOM.snapmakerStatus.className = 'absolute bottom-0 left-0 w-full p-2 text-xs font-semibold flex items-center justify-center gap-2 bg-yellow-900 text-yellow-200 h-10';
                lastOcrSummary = 'OCR unavailable';
                updateChecklist();
                return;
            }

            const ocrCanvas = document.getElementById('canvas-ocr');
            ocrCanvas.width = 800;
            ocrCanvas.height = 800 * (sourceCanvas.height / sourceCanvas.width);
            const ocrCtx = ocrCanvas.getContext('2d');
            ocrCtx.drawImage(sourceCanvas, 0, 0, ocrCanvas.width, ocrCanvas.height);

            try {
                const ret = await tesseractWorker.recognize(ocrCanvas);
                const textFound = ret.data.words.some(({ text, confidence }) => {
                    const cleanText = text.replace(/[^a-zA-Z0-9]/g, '');
                    return cleanText.length > 3 && confidence >= MIN_TEXT_CONFIDENCE;
                });

                if (textFound) {
                    DOM.snapmakerStatus.className = 'absolute bottom-0 left-0 w-full p-2 text-xs font-semibold flex items-center justify-center gap-2 bg-red-900 text-red-200 h-10';
                    DOM.snapmakerStatus.innerHTML = '<i class="fa-solid fa-circle-xmark text-red-400 text-base"></i> Text Detected (Violates Snapmaker Rules)';
                    DOM.snapmakerCard.classList.remove('border-b-gray-800');
                    DOM.snapmakerCard.classList.add('border-b-red-500');
                    lastOcrSummary = 'Text detected';
                } else {
                    DOM.snapmakerStatus.className = 'absolute bottom-0 left-0 w-full p-2 text-xs font-semibold flex items-center justify-center gap-2 bg-green-900 text-green-200 h-10';
                    DOM.snapmakerStatus.innerHTML = '<i class="fa-solid fa-circle-check text-green-400 text-base"></i> No Text Detected (Rules Passed)';
                    DOM.snapmakerCard.classList.remove('border-b-gray-800');
                    DOM.snapmakerCard.classList.add('border-b-green-500');
                    lastOcrSummary = 'No text';
                }
                updateChecklist();
            } catch (err) {
                console.error('OCR Error', err);
                DOM.snapmakerStatus.innerHTML = 'Error checking text';
                lastOcrSummary = 'OCR error';
                updateChecklist();
            }
        }, 800);
    }

    function exportFileName(imageEntry, index, platform, width, height) {
        const nn = String(index + 1).padStart(2, '0');
        const role = ROLES.includes(imageEntry.role) ? imageEntry.role : 'gallery';
        return `${slugify(state.projectName)}_${nn}-${role}_${platform.name}_${width}x${height}.jpg`;
    }

    async function generateZip() {
        if (!state.images.length) return;

        const btnOriginalHtml = DOM.btnDownloadHeader.innerHTML;
        DOM.btnDownloadHeader.innerHTML = '<div class="spinner border-white border-l-transparent"></div> Bundling...';
        DOM.btnDownloadHeader.disabled = true;
        DOM.btnDownloadHeader.classList.add('opacity-80', 'cursor-not-allowed');

        try {
            const zip = new JSZip();
            const platforms = getPlatforms();
            const jobs = [];

            state.images.forEach((imageEntry, index) => {
                platforms.forEach((platform) => {
                    jobs.push(async () => {
                        const { blob, width, height } = await exportPlatformBlob(platform, imageEntry);
                        zip.file(exportFileName(imageEntry, index, platform, width, height), blob);
                    });
                });
            });

            const concurrency = 3;
            for (let i = 0; i < jobs.length; i += concurrency) {
                await Promise.all(jobs.slice(i, i + concurrency).map((fn) => fn()));
            }

            const content = await zip.generateAsync({ type: 'blob' });
            saveAs(content, `${slugify(state.projectName)}_LayerLens.zip`);
            showToast('Zip bundle generated successfully!', true);
        } catch (err) {
            console.error('Zip Error', err);
            showToast('Error generating zip bundle.', false);
        } finally {
            DOM.btnDownloadHeader.innerHTML = btnOriginalHtml;
            DOM.btnDownloadHeader.disabled = false;
            DOM.btnDownloadHeader.classList.remove('opacity-80', 'cursor-not-allowed');
        }
    }

    function serializeProject() {
        return {
            version: 1,
            projectName: state.projectName,
            activeImageId: state.activeImageId,
            fitMode: state.fitMode,
            bgType: state.bgType,
            bgColor: state.bgColor,
            bgGradientStart: state.bgGradientStart,
            bgGradientEnd: state.bgGradientEnd,
            bgGradientDirection: state.bgGradientDirection,
            bgTexture: state.bgTexture,
            bgTextureScale: state.bgTextureScale,
            bgTextureBlur: state.bgTextureBlur,
            bgTextureBrightness: state.bgTextureBrightness,
            bgTextureColor: state.bgTextureColor,
            bgCustomImageName: state.bgCustomImageName,
            bgCustomImageDataUrl: state.bgCustomImageDataUrl || '',
            blurVal: state.blurVal,
            edgeSoftness: state.edgeSoftness,
            makerworldOrientation: state.makerworldOrientation,
            showSafeMargins: state.showSafeMargins,
            logo: { ...state.logo },
            images: state.images.map((img) => ({
                id: img.id,
                name: img.name,
                dataUrl: img.dataUrl,
                role: img.role,
                zoom: img.zoom,
                panX: img.panX,
                panY: img.panY,
                platformTransforms: img.platformTransforms,
                color: img.color
            }))
        };
    }

    async function hydrateProject(data) {
        if (!data || !Array.isArray(data.images)) {
            throw new Error('Invalid project data');
        }

        state.projectName = data.projectName || 'Untitled Project';
        state.fitMode = data.fitMode || 'contain';
        state.bgType = data.bgType || 'blur';
        state.bgColor = data.bgColor || '#111827';
        state.bgGradientStart = data.bgGradientStart || '#4c1d95';
        state.bgGradientEnd = data.bgGradientEnd || '#f97316';
        state.bgGradientDirection = data.bgGradientDirection || 'diagonal';
        state.bgTexture = data.bgTexture || 'texture_dot';
        state.bgTextureScale = data.bgTextureScale ?? 1;
        state.bgTextureBlur = data.bgTextureBlur ?? 0;
        state.bgTextureBrightness = data.bgTextureBrightness ?? 1;
        state.bgTextureColor = data.bgTextureColor || '#ffffff';
        state.bgCustomImageName = data.bgCustomImageName || '';
        state.bgCustomImageDataUrl = data.bgCustomImageDataUrl || '';
        state.blurVal = data.blurVal ?? 20;
        state.edgeSoftness = data.edgeSoftness ?? 0;
        state.makerworldOrientation = data.makerworldOrientation || 'landscape';
        state.showSafeMargins = Boolean(data.showSafeMargins);
        state.logo = {
            dataUrl: (data.logo && data.logo.dataUrl) || '',
            name: (data.logo && data.logo.name) || '',
            position: (data.logo && data.logo.position) || 'bottom-right',
            scale: (data.logo && data.logo.scale) ?? 15,
            opacity: (data.logo && data.logo.opacity) ?? 70
        };

        bgCustomImage = null;
        if (state.bgCustomImageDataUrl) {
            try {
                bgCustomImage = await loadHtmlImage(state.bgCustomImageDataUrl);
            } catch (e) {
                bgCustomImage = null;
            }
        }

        logoImage = null;
        if (state.logo.dataUrl) {
            try {
                logoImage = await loadHtmlImage(state.logo.dataUrl);
            } catch (e) {
                logoImage = null;
            }
        }

        const loaded = [];
        for (const raw of data.images) {
            if (!raw || !raw.dataUrl) continue;
            const entry = createImageEntry(raw.id || uid(), raw.name || 'image', raw.dataUrl, raw.role || 'gallery');
            entry.zoom = raw.zoom ?? 1;
            entry.panX = raw.panX ?? 0;
            entry.panY = raw.panY ?? 0;
            entry.platformTransforms = raw.platformTransforms || {};
            entry.color = { ...defaultColorAdjust(), ...(raw.color || {}) };
            try {
                entry.image = await loadHtmlImage(raw.dataUrl);
                loaded.push(entry);
            } catch (e) {
                console.error('Failed to load project image', e);
            }
        }

        if (!loaded.length) throw new Error('No images in project');

        state.images = loaded;
        state.activeImageId = loaded.some((i) => i.id === data.activeImageId)
            ? data.activeImageId
            : loaded[0].id;

        syncProjectNameInputs();
        DOM.bgType.value = state.bgType;
        DOM.bgColor.value = state.bgColor;
        DOM.bgGradientStart.value = state.bgGradientStart;
        DOM.bgGradientEnd.value = state.bgGradientEnd;
        DOM.bgGradientDirection.value = state.bgGradientDirection;
        DOM.bgTexture.value = state.bgTexture;
        DOM.bgTextureScale.value = state.bgTextureScale;
        DOM.textureScaleValDisplay.textContent = `${Number(state.bgTextureScale).toFixed(1)}x`;
        DOM.bgTextureBlur.value = state.bgTextureBlur;
        DOM.textureBlurValDisplay.textContent = `${state.bgTextureBlur}px`;
        DOM.bgTextureBrightness.value = state.bgTextureBrightness;
        DOM.textureBrightnessValDisplay.textContent = `${Number(state.bgTextureBrightness).toFixed(1)}x`;
        DOM.bgTextureColor.value = state.bgTextureColor;
        DOM.bgBlur.value = state.blurVal;
        DOM.blurValDisplay.textContent = `${state.blurVal}px`;
        DOM.edgeSoftness.value = state.edgeSoftness;
        DOM.edgeSoftnessValDisplay.textContent = `${state.edgeSoftness}px`;
        DOM.safeMarginToggle.checked = state.showSafeMargins;
        updateBgUI();
        updateLogoUI();
        setMakerworldOrientation(state.makerworldOrientation);
        showEditor();
        renderFilmstrip();
        syncActiveControlsToDom();
        setFitMode(state.fitMode);
        renderAll();
        scheduleCultsEstimate();
        updateChecklist();
    }

    function saveProjectToStorage(showMessage) {
        try {
            const payload = serializeProject();
            localStorage.setItem(PROJECT_KEY, JSON.stringify(payload));
            if (showMessage) showToast('Project saved to this browser.', true);
        } catch (err) {
            console.error(err);
            showToast('Could not save project (storage full or blocked).', false);
        }
    }

    async function loadProjectFromStorage(showMessage) {
        try {
            const raw = localStorage.getItem(PROJECT_KEY);
            if (!raw) {
                showToast('No saved project found.', false);
                return;
            }
            await hydrateProject(JSON.parse(raw));
            if (showMessage) showToast('Project loaded.', true);
        } catch (err) {
            console.error(err);
            showToast('Could not load saved project.', false);
        }
    }

    function exportProjectJson() {
        if (!state.images.length) {
            showToast('Load images before exporting a project.', false);
            return;
        }
        const blob = new Blob([JSON.stringify(serializeProject(), null, 2)], { type: 'application/json' });
        saveAs(blob, `${slugify(state.projectName)}_LayerLens.json`);
        showToast('Project JSON downloaded.', true);
    }

    function importProjectJson(file) {
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                await hydrateProject(JSON.parse(reader.result));
                showToast('Project JSON imported.', true);
            } catch (err) {
                console.error(err);
                showToast('Invalid project JSON.', false);
            }
        };
        reader.onerror = () => showToast('Could not read project file.', false);
        reader.readAsText(file);
    }

    function saveBrandKit() {
        const active = getActiveImage();
        const kit = {
            fitMode: state.fitMode,
            bgType: state.bgType,
            bgColor: state.bgColor,
            bgGradientStart: state.bgGradientStart,
            bgGradientEnd: state.bgGradientEnd,
            bgGradientDirection: state.bgGradientDirection,
            bgTexture: state.bgTexture,
            bgTextureScale: state.bgTextureScale,
            bgTextureBlur: state.bgTextureBlur,
            bgTextureBrightness: state.bgTextureBrightness,
            bgTextureColor: state.bgTextureColor,
            bgCustomImageName: state.bgCustomImageName,
            bgCustomImageDataUrl: state.bgCustomImageDataUrl || '',
            blurVal: state.blurVal,
            edgeSoftness: state.edgeSoftness,
            logo: { ...state.logo },
            colorAdjust: active ? { ...active.color } : defaultColorAdjust()
        };
        try {
            localStorage.setItem(BRANDKIT_KEY, JSON.stringify(kit));
            showToast('Brand kit saved.', true);
        } catch (err) {
            console.error(err);
            showToast('Could not save brand kit.', false);
        }
    }

    async function applyBrandKit() {
        try {
            const raw = localStorage.getItem(BRANDKIT_KEY);
            if (!raw) {
                showToast('No brand kit saved yet.', false);
                return;
            }
            const kit = JSON.parse(raw);
            state.fitMode = kit.fitMode || state.fitMode;
            state.bgType = kit.bgType || state.bgType;
            state.bgColor = kit.bgColor || state.bgColor;
            state.bgGradientStart = kit.bgGradientStart || state.bgGradientStart;
            state.bgGradientEnd = kit.bgGradientEnd || state.bgGradientEnd;
            state.bgGradientDirection = kit.bgGradientDirection || state.bgGradientDirection;
            state.bgTexture = kit.bgTexture || state.bgTexture;
            state.bgTextureScale = kit.bgTextureScale ?? state.bgTextureScale;
            state.bgTextureBlur = kit.bgTextureBlur ?? state.bgTextureBlur;
            state.bgTextureBrightness = kit.bgTextureBrightness ?? state.bgTextureBrightness;
            state.bgTextureColor = kit.bgTextureColor || state.bgTextureColor;
            state.bgCustomImageName = kit.bgCustomImageName || '';
            state.bgCustomImageDataUrl = kit.bgCustomImageDataUrl || '';
            state.blurVal = kit.blurVal ?? state.blurVal;
            state.edgeSoftness = kit.edgeSoftness ?? state.edgeSoftness;
            if (kit.logo) {
                state.logo = {
                    dataUrl: kit.logo.dataUrl || '',
                    name: kit.logo.name || '',
                    position: kit.logo.position || 'bottom-right',
                    scale: kit.logo.scale ?? 15,
                    opacity: kit.logo.opacity ?? 70
                };
            }

            bgCustomImage = null;
            if (state.bgCustomImageDataUrl) {
                try { bgCustomImage = await loadHtmlImage(state.bgCustomImageDataUrl); } catch (e) { bgCustomImage = null; }
            }
            logoImage = null;
            if (state.logo.dataUrl) {
                try { logoImage = await loadHtmlImage(state.logo.dataUrl); } catch (e) { logoImage = null; }
            }

            if (kit.colorAdjust && getActiveImage()) {
                getActiveImage().color = { ...defaultColorAdjust(), ...kit.colorAdjust };
            }

            DOM.bgType.value = state.bgType;
            DOM.bgColor.value = state.bgColor;
            DOM.bgGradientStart.value = state.bgGradientStart;
            DOM.bgGradientEnd.value = state.bgGradientEnd;
            DOM.bgGradientDirection.value = state.bgGradientDirection;
            DOM.bgTexture.value = state.bgTexture;
            DOM.bgTextureScale.value = state.bgTextureScale;
            DOM.textureScaleValDisplay.textContent = `${Number(state.bgTextureScale).toFixed(1)}x`;
            DOM.bgTextureBlur.value = state.bgTextureBlur;
            DOM.textureBlurValDisplay.textContent = `${state.bgTextureBlur}px`;
            DOM.bgTextureBrightness.value = state.bgTextureBrightness;
            DOM.textureBrightnessValDisplay.textContent = `${Number(state.bgTextureBrightness).toFixed(1)}x`;
            DOM.bgTextureColor.value = state.bgTextureColor;
            DOM.bgBlur.value = state.blurVal;
            DOM.blurValDisplay.textContent = `${state.blurVal}px`;
            DOM.edgeSoftness.value = state.edgeSoftness;
            DOM.edgeSoftnessValDisplay.textContent = `${state.edgeSoftness}px`;
            updateBgUI();
            updateLogoUI();
            syncActiveControlsToDom();
            setFitMode(state.fitMode);
            renderAll();
            scheduleCultsEstimate();
            showToast('Brand kit applied.', true);
        } catch (err) {
            console.error(err);
            showToast('Could not apply brand kit.', false);
        }
    }

    // Boot
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
