[file name]: app.js
[file content begin]
// ========== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ==========
let map;
let markerCluster;
let allPoints = [];
let activeFilters = {
    projects: [],
    regions: [],
    statuses: [],
    managers: [],
    sheets: []
};

let updateInterval;
let markersMap = new Map();
let isLoading = false;
let lastUpdateTime = null;
let updateTimerInterval = null;
let availableSheets = [];
let sheetPointsCache = new Map();
let sheetsInfoCache = null;
let lastSheetsFetchTime = null;

// Цветовая схема для статусов ADTS
const ADTS_STATUS_COLORS = {
    'Выполнен': '#2ecc71',
    'Нет оборудования': '#e74c3c',
    'В очереди': '#3498db',
    'Первичный': '#f1c40f',
    'Финальный': '#9b59b6',
    'Доработка после монтажа': '#95a5a6',
    'Выполнено': '#2ecc71',
    'Сдан': '#2ecc71',
    'Завершен': '#2ecc71',
    'Оборудования нет': '#e74c3c',
    'Нет оборудывания': '#e74c3c',
    'Ожидание оборудования': '#e74c3c',
    'Очередь': '#3498db',
    'В работе': '#3498db',
    'План': '#3498db',
    'Первичный монтаж': '#f1c40f',
    'Монтаж начальный': '#f1c40f',
    'Финальный монтаж': '#9b59b6',
    'Завершающий монтаж': '#9b59b6',
    'Доработка': '#95a5a6',
    'Реконструкция': '#95a5a6',
    'Переделка': '#95a5a6'
};

// ========== ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ==========

function initApp() {
    console.log('Инициализация приложения ADTS...');
    initMap();
    setupEventListeners();
    loadAvailableSheets();
    setupAutoUpdate();
    startUpdateTimer();
}

function setupEventListeners() {
    // Обработчики для поиска
    document.getElementById('search')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchPoints();
        }
    });
    
    document.getElementById('search-sidebar')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            searchPointsSidebar();
        }
    });
    
    // Обработчики для фильтров
    document.getElementById('filter-status')?.addEventListener('change', function() {
        updateLegend();
        updateFilterCounts();
    });
    
    document.getElementById('filter-region')?.addEventListener('change', function() {
        updateLegend();
        updateFilterCounts();
    });
    
    document.getElementById('filter-project')?.addEventListener('change', function() {
        updateLegend();
        updateFilterCounts();
    });
    
    document.getElementById('filter-manager')?.addEventListener('change', function() {
        updateLegend();
        updateFilterCounts();
    });
    
    document.getElementById('filter-sheets')?.addEventListener('change', function() {
        updateLegend();
        updateFilterCounts();
    });
}

document.addEventListener('DOMContentLoaded', initApp);

// ========== ИНИЦИАЛИЗАЦИЯ КАРТЫ ==========

function initMap() {
    console.log('Инициализация карты...');
    
    const mapElement = document.getElementById('map');
    if (!mapElement) {
        console.error('Элемент карты не найден!');
        showNotification('Ошибка: элемент карты не найден', 'error');
        return;
    }
    
    try {
        map = L.map('map').setView(CONFIG.MAP.center, CONFIG.MAP.zoom);
        
        L.tileLayer(CONFIG.MAP.tileLayer, {
            attribution: CONFIG.MAP.attribution,
            maxZoom: CONFIG.MAP.maxZoom,
            minZoom: CONFIG.MAP.minZoom
        }).addTo(map);
        
        markerCluster = L.markerClusterGroup({
            maxClusterRadius: CONFIG.MARKERS.clusterRadius,
            iconCreateFunction: function(cluster) {
                const count = cluster.getChildCount();
                const size = Math.min(40 + Math.sqrt(count) * 5, 60);
                
                return L.divIcon({
                    html: `<div style="background:#3498db; color:white; width:${size}px; height:${size}px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; border:3px solid white; box-shadow:0 2px 8px rgba(0,0,0,0.4); font-size:${Math.min(14 + count/10, 18)}px;">${count}</div>`,
                    className: 'custom-cluster',
                    iconSize: [size, size],
                    iconAnchor: [size/2, size/2]
                });
            },
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: true,
            zoomToBoundsOnClick: true
        }).addTo(map);
        
        console.log('Карта успешно инициализирована');
    } catch (error) {
        console.error('Ошибка инициализации карты:', error);
        showNotification('Ошибка загрузки карты', 'error');
    }
}

// ========== УТИЛИТЫ ==========

function updateStatus(message, type = 'success') {
    const statusElement = document.getElementById('status');
    if (statusElement) {
        let icon = 'circle';
        let color = '#2ecc71';
        
        switch(type) {
            case 'error': 
                icon = 'exclamation-circle';
                color = '#e74c3c';
                break;
            case 'warning':
                icon = 'exclamation-triangle';
                color = '#f39c12';
                break;
            case 'loading':
                icon = 'sync-alt fa-spin';
                color = '#3498db';
                break;
        }
        
        statusElement.innerHTML = `<i class="fas fa-${icon}" style="color: ${color};"></i> ${message}`;
    }
}

function showModal(title, message) {
    const modal = document.getElementById('modal');
    const titleElement = document.getElementById('modal-title');
    const messageElement = document.getElementById('modal-message');
    
    if (modal && titleElement && messageElement) {
        titleElement.textContent = title;
        messageElement.innerHTML = message;
        modal.style.display = 'flex';
    }
}

function closeModal() {
    const modal = document.getElementById('modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function showNotification(message, type = 'info', duration = 5000) {
    // Удаляем старые уведомления
    document.querySelectorAll('.notification').forEach(el => {
        if (el.parentElement) el.remove();
    });
    
    const notification = document.createElement('div');
    notification.className = 'notification';
    
    let icon = 'info-circle';
    let bgColor = '#3498db';
    
    switch(type) {
        case 'success':
            icon = 'check-circle';
            bgColor = '#2ecc71';
            break;
        case 'error':
            icon = 'exclamation-circle';
            bgColor = '#e74c3c';
            break;
        case 'warning':
            icon = 'exclamation-triangle';
            bgColor = '#f39c12';
            break;
    }
    
    notification.innerHTML = `
        <div style="
            background: ${bgColor};
            color: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 3000;
            display: flex;
            align-items: center;
            gap: 10px;
            animation: slideInRight 0.3s ease;
            max-width: 400px;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255,255,255,0.1);
            padding: 15px 20px;
        ">
            <i class="fas fa-${icon}" style="font-size: 18px;"></i>
            <span style="flex: 1; font-size: 14px;">${message}</span>
            <button onclick="this.parentElement.parentElement.remove()" 
                    style="background: none; border: none; color: white; cursor: pointer; font-size: 14px; opacity: 0.7; transition: opacity 0.2s;"
                    onmouseover="this.style.opacity='1'"
                    onmouseout="this.style.opacity='0.7'">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Автоматическое удаление
    if (duration > 0) {
        setTimeout(() => {
            if (notification.parentElement) {
                notification.style.animation = 'slideOutRight 0.3s ease';
                setTimeout(() => {
                    if (notification.parentElement) notification.remove();
                }, 300);
            }
        }, duration);
    }
}

// ========== ТАЙМЕР ОБНОВЛЕНИЯ ==========

function startUpdateTimer() {
    if (updateTimerInterval) {
        clearInterval(updateTimerInterval);
    }
    
    updateTimerInterval = setInterval(() => {
        const timerElement = document.getElementById('update-timer');
        if (!timerElement) return;
        
        if (lastUpdateTime) {
            const now = new Date();
            const diff = Math.floor((now - lastUpdateTime) / 1000);
            
            const minutes = Math.floor(diff / 60);
            const seconds = diff % 60;
            
            if (minutes > 0) {
                timerElement.textContent = `${minutes} мин ${seconds} сек назад`;
            } else {
                timerElement.textContent = `${seconds} сек назад`;
            }
        } else {
            timerElement.textContent = '--:--';
        }
    }, 1000);
}

function updateLastUpdateTime() {
    lastUpdateTime = new Date();
    const timeElement = document.getElementById('last-update');
    if (timeElement) {
        const now = new Date();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        timeElement.textContent = `${hours}:${minutes}`;
    }
}

// ========== НОРМАЛИЗАЦИЯ СТАТУСОВ ADTS ==========

function normalizeADTSStatus(status) {
    if (!status) return 'Не указан';
    
    const statusLower = status.toLowerCase().trim();
    
    if (statusLower.includes('выполнен') || statusLower.includes('сдан') || statusLower.includes('завершен')) 
        return 'Выполнен';
    if (statusLower.includes('нет оборуд') || statusLower.includes('оборудования нет') || statusLower.includes('ожидание оборуд')) 
        return 'Нет оборудования';
    if (statusLower.includes('очеред') || statusLower.includes('в работе') || statusLower.includes('план')) 
        return 'В очереди';
    if (statusLower.includes('первичн') || statusLower.includes('начальн') || statusLower.includes('первый')) 
        return 'Первичный';
    if (statusLower.includes('финальн') || statusLower.includes('завершающ') || statusLower.includes('окончат')) 
        return 'Финальный';
    if (statusLower.includes('доработк') || statusLower.includes('реконструкц') || statusLower.includes('передел')) 
        return 'Доработка после монтажа';
    
    return status;
}

function getStatusIcon(status) {
    const normalizedStatus = normalizeADTSStatus(status);
    
    switch(normalizedStatus) {
        case 'Выполнен':
            return '<i class="fas fa-check-circle"></i>';
        case 'Нет оборудования':
            return '<i class="fas fa-times-circle"></i>';
        case 'В очереди':
            return '<i class="fas fa-clock"></i>';
        case 'Первичный':
            return '<i class="fas fa-hammer"></i>';
        case 'Финальный':
            return '<i class="fas fa-check-double"></i>';
        case 'Доработка после монтажа':
            return '<i class="fas fa-tools"></i>';
        default:
            return '<i class="fas fa-map-marker-alt"></i>';
    }
}

function getStatusColor(status) {
    const normalizedStatus = normalizeADTSStatus(status);
    return ADTS_STATUS_COLORS[normalizedStatus] || '#95a5a6';
}

// ========== РАБОТА С ЛИСТАМИ ==========

async function loadAvailableSheets() {
    if (!CONFIG.SHEETS.enabled) {
        console.log('Поддержка листов выключена');
        loadData();
        return;
    }
    
    // Проверяем кэш
    const now = new Date();
    if (sheetsInfoCache && lastSheetsFetchTime && 
        (now - lastSheetsFetchTime) < CONFIG.SHEETS.cacheDuration) {
        console.log('Использую кэшированную информацию о листах');
        availableSheets = sheetsInfoCache;
        updateSheetsFilter(availableSheets);
        return;
    }
    
    try {
        console.log('Загружаю информацию о листах...');
        updateStatus('Получение списка листов...', 'loading');
        
        const url = `https://spreadsheets.google.com/feeds/worksheets/${CONFIG.SPREADSHEET_ID}/public/full?alt=json`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        const sheets = data.feed.entry || [];
        
        // Фильтруем листы
        availableSheets = sheets
            .map(sheet => ({
                id: sheet.id.$t.split('/').pop(),
                title: sheet.title.$t,
                gid: sheet.id.$t.split('/').pop()
            }))
            .filter(sheet => {
                // Исключаем системные листы
                const lowerTitle = sheet.title.toLowerCase();
                const excluded = CONFIG.SHEETS.excludedSheets || [];
                return !excluded.some(excludedName => 
                    lowerTitle.includes(excludedName.toLowerCase())
                );
            });
        
        console.log(`Найдено листов: ${availableSheets.length}`);
        
        if (availableSheets.length === 0) {
            console.warn('Не найдено подходящих листов');
            if (sheets.length > 0) {
                availableSheets = [{
                    id: sheets[0].id.$t.split('/').pop(),
                    title: sheets[0].title.$t,
                    gid: sheets[0].id.$t.split('/').pop()
                }];
            }
        }
        
        // Обновляем кэш
        sheetsInfoCache = availableSheets;
        lastSheetsFetchTime = now;
        
        // Обновляем фильтр листов
        updateSheetsFilter(availableSheets);
        
        if (availableSheets.length > 0) {
            loadData();
        } else {
            showDemoData();
        }
        
        updateStatus(`Найдено ${availableSheets.length} листов`, 'success');
        
    } catch (error) {
        console.error('Ошибка загрузки листов:', error);
        updateStatus('Ошибка загрузки листов', 'error');
        showNotification('Не удалось получить список листов. Использую демо-данные.', 'error');
        showDemoData();
    }
}

function updateSheetsFilter(sheets) {
    console.log('Обновляю фильтр листов...');
    
    const sheetSelect = document.getElementById('filter-sheets');
    if (!sheetSelect) {
        console.error('Элемент фильтра листов не найден');
        return;
    }
    
    // Сохраняем текущий выбор
    const selectedValues = getSelectedSheets();
    
    // Очищаем select
    sheetSelect.innerHTML = '<option value="">Все листы</option>';
    
    // Добавляем опции
    sheets.forEach(sheet => {
        const option = document.createElement('option');
        option.value = sheet.title;
        option.textContent = sheet.title;
        
        if (selectedValues.includes(sheet.title)) {
            option.selected = true;
        }
        
        sheetSelect.appendChild(option);
    });
    
    // Если нет выбранных листов, выбираем все
    if (selectedValues.length === 0 && sheets.length > 0) {
        selectAllSheets();
    }
}

function getSelectedSheets() {
    const sheetSelect = document.getElementById('filter-sheets');
    if (!sheetSelect) return [];
    
    return Array.from(sheetSelect.selectedOptions)
        .map(opt => opt.value)
        .filter(val => val !== '');
}

function selectAllSheets() {
    const sheetSelect = document.getElementById('filter-sheets');
    if (!sheetSelect || availableSheets.length === 0) return;
    
    Array.from(sheetSelect.options).forEach(option => {
        if (option.value !== '') {
            option.selected = true;
        }
    });
    
    activeFilters.sheets = availableSheets.map(sheet => sheet.title);
    console.log('Выбраны все листы:', activeFilters.sheets);
}

// ========== ЗАГРУЗКА ДАННЫХ ==========

async function loadData() {
    if (isLoading) {
        showNotification('Данные уже загружаются...', 'info', 2000);
        return;
    }
    
    isLoading = true;
    const refreshBtn = document.getElementById('refresh-btn');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Загрузка...';
    }
    
    try {
        updateStatus('Загрузка данных...', 'loading');
        showModal('Загрузка', '<div class="loader" style="margin: 20px auto;"></div><p>Подключение к Google Таблице...</p>');
        
        console.log('Начинаю загрузку данных...');
        
        let allData = [];
        
        if (CONFIG.SHEETS.enabled && availableSheets.length > 0) {
            const selectedSheets = getSelectedSheets();
            const sheetsToLoad = selectedSheets.length > 0 ? 
                selectedSheets : availableSheets.map(s => s.title);
            
            console.log(`Загружаю данные с ${sheetsToLoad.length} листов`);
            
            for (const sheetName of sheetsToLoad) {
                try {
                    console.log(`Загружаю лист: ${sheetName}`);
                    
                    // Проверяем кэш
                    if (sheetPointsCache.has(sheetName)) {
                        const cachedPoints = sheetPointsCache.get(sheetName);
                        allData = allData.concat(cachedPoints);
                        continue;
                    }
                    
                    const sheetData = await loadSheetData(sheetName);
                    
                    if (sheetData && sheetData.length > 0) {
                        const processedPoints = processData(sheetData, sheetName);
                        const pointsWithCoords = await addCoordinatesFast(processedPoints);
                        
                        sheetPointsCache.set(sheetName, pointsWithCoords);
                        allData = allData.concat(pointsWithCoords);
                        
                        console.log(`Лист "${sheetName}" обработан: ${pointsWithCoords.length} точек`);
                    }
                    
                } catch (sheetError) {
                    console.error(`Ошибка загрузки листа "${sheetName}":`, sheetError);
                }
            }
        } else {
            // Загрузка с одного листа
            const data = await loadDataAsCSV();
            
            if (!data || data.length === 0) {
                throw new Error('Не удалось загрузить данные');
            }
            
            const processedPoints = processData(data, 'Основной лист');
            allData = await addCoordinatesFast(processedPoints);
        }
        
        if (allData.length === 0) {
            throw new Error('Не удалось загрузить данные');
        }
        
        console.log(`Всего загружено точек: ${allData.length}`);
        
        allPoints = allData;
        
        updateFilters();
        updateStatistics();
        updateStatusStatistics();
        updateLegend();
        updateLastUpdateTime();
        showPointsOnMap();
        
        closeModal();
        updateStatus(`Загружено: ${allPoints.length} точек`, 'success');
        showNotification(`Данные успешно загружены: ${allPoints.length} точек`, 'success');
        
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        updateStatus('Ошибка загрузки', 'error');
        showNotification('Ошибка загрузки данных. Используются демо-данные.', 'error');
        
        if (allPoints.length === 0) {
            showDemoData();
        }
        
    } finally {
        isLoading = false;
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Обновить данные';
        }
    }
}

async function loadSheetData(sheetName) {
    const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
    
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const csvText = await response.text();
        return parseCSV(csvText);
        
    } catch (error) {
        console.error(`Ошибка загрузки листа "${sheetName}":`, error);
        
        // Пробуем альтернативный метод
        try {
            const altUrl = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/export?format=csv&sheet=${encodeURIComponent(sheetName)}`;
            const altResponse = await fetch(altUrl);
            
            if (!altResponse.ok) {
                throw new Error('Альтернативный метод тоже не сработал');
            }
            
            const altCsvText = await altResponse.text();
            return parseCSV(altCsvText);
            
        } catch (altError) {
            throw error;
        }
    }
}

async function loadDataAsCSV() {
    const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/export?format=csv`;
    
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const csvText = await response.text();
        return parseCSV(csvText);
        
    } catch (error) {
        console.error('Ошибка загрузки CSV:', error);
        return null;
    }
}

function parseCSV(csvText) {
    try {
        const lines = csvText.split('\n').filter(line => line.trim() !== '');
        const result = [];
        
        for (const line of lines) {
            const row = [];
            let current = '';
            let inQuotes = false;
            
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const nextChar = i + 1 < line.length ? line[i + 1] : '';
                
                if (char === '"' && !inQuotes) {
                    inQuotes = true;
                    continue;
                }
                
                if (char === '"' && inQuotes) {
                    if (nextChar === '"') {
                        current += char;
                        i++;
                        continue;
                    }
                    inQuotes = false;
                    continue;
                }
                
                if (char === ',' && !inQuotes) {
                    row.push(current.trim());
                    current = '';
                    continue;
                }
                
                current += char;
            }
            
            row.push(current.trim());
            
            const cleanedRow = row.map(cell => {
                let cleaned = cell;
                if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
                    cleaned = cleaned.substring(1, cleaned.length - 1);
                }
                cleaned = cleaned.replace(/""/g, '"');
                return cleaned;
            });
            
            if (cleanedRow.some(cell => cell.trim() !== '')) {
                result.push(cleanedRow);
            }
        }
        
        return result;
        
    } catch (error) {
        console.error('Ошибка парсинга CSV:', error);
        return [];
    }
}

// ========== ОБРАБОТКА ДАННЫХ ==========

function processData(rows, sheetName = '') {
    if (!rows || rows.length < 2) {
        return [];
    }
    
    const points = [];
    const headers = rows[0].map(h => h.toString().trim());
    
    const colIndices = findColumnIndices(headers);
    
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        
        if (!row || row.length === 0) {
            continue;
        }
        
        const point = {
            id: `point_${sheetName}_${i}_${Date.now()}`,
            sheetRow: i + 1,
            sheet: sheetName,
            name: '',
            region: '',
            address: '',
            status: '',
            manager: '',
            contractor: '',
            project: '',
            dateAdded: new Date().toISOString().split('T')[0]
        };
        
        Object.keys(colIndices).forEach(key => {
            const index = colIndices[key];
            if (index !== -1 && index < row.length) {
                const value = row[index].toString().trim();
                if (value && value !== 'undefined' && value !== 'null') {
                    point[key] = value;
                }
            }
        });
        
        point.name = cleanString(point.name);
        point.region = cleanString(point.region);
        point.address = cleanString(point.address);
        point.status = cleanString(point.status);
        point.manager = cleanString(point.manager);
        point.contractor = cleanString(point.contractor);
        point.project = cleanString(point.project);
        
        // Нормализуем статус
        if (point.status) {
            point.status = normalizeADTSStatus(point.status);
        }
        
        // Если project не указан, используем название листа
        if (!point.project || point.project.trim() === '') {
            point.project = sheetName;
        }
        
        if (!point.name || point.name.trim() === '') {
            if (point.address) {
                const firstPart = point.address.split(',')[0];
                point.name = firstPart.trim().substring(0, 30) + (firstPart.length > 30 ? '...' : '');
            } else if (point.region) {
                point.name = point.region + ' - Точка ADTS ' + i;
            } else {
                point.name = `Точка ADTS ${i} (${sheetName})`;
            }
        }
        
        if (point.name && (point.address || point.region || point.status)) {
            points.push(point);
        }
    }
    
    return points;
}

function cleanString(str) {
    if (!str) return '';
    return str.toString()
        .replace(/"/g, '')
        .replace(/'/g, '')
        .replace(/\r/g, '')
        .replace(/\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function findColumnIndices(headers) {
    const indices = {
        name: -1,
        region: -1,
        address: -1,
        status: -1,
        manager: -1,
        contractor: -1,
        project: -1
    };
    
    const headersLower = headers.map(h => h.toString().toLowerCase().trim());
    
    headersLower.forEach((header, index) => {
        if (header.includes('название') || header.includes('имя') || header.includes('точка')) {
            if (indices.name === -1) indices.name = index;
        }
        if (header.includes('регион') || header.includes('область')) {
            if (indices.region === -1) indices.region = index;
        }
        if (header.includes('адрес') || header.includes('улица')) {
            if (indices.address === -1) indices.address = index;
        }
        if (header.includes('статус') || header.includes('состояние')) {
            if (indices.status === -1) indices.status = index;
        }
        if (header.includes('менеджер') || header.includes('ответственный')) {
            if (indices.manager === -1) indices.manager = index;
        }
        if (header.includes('подрядчик') || header.includes('исполнитель')) {
            if (indices.contractor === -1) indices.contractor = index;
        }
        if (header.includes('проект')) {
            if (indices.project === -1) indices.project = index;
        }
    });
    
    return indices;
}

async function addCoordinatesFast(points) {
    return points.map(point => {
        if (!point.lat || !point.lng) {
            const coords = getRandomCoordinate(point.address || '', point.region || '');
            return { 
                ...point, 
                lat: coords.lat, 
                lng: coords.lng, 
                isMock: true
            };
        }
        return point;
    });
}

// ========== ОТОБРАЖЕНИЕ ТОЧЕК ==========

function showPointsOnMap() {
    markerCluster.clearLayers();
    markersMap.clear();
    
    const filteredPoints = filterPoints();
    
    filteredPoints.forEach(point => {
        if (point.lat && point.lng) {
            const marker = createMarker(point);
            markerCluster.addLayer(marker);
            markersMap.set(point.id, marker);
        }
    });
    
    updateStatistics();
    updateStatusStatistics();
    updateFilterCounts();
    
    // Центрируем карту если есть точки
    if (filteredPoints.length > 0 && filteredPoints.some(p => p.lat && p.lng)) {
        centerMapOnFilteredPoints();
    }
}

function createMarker(point) {
    const normalizedStatus = normalizeADTSStatus(point.status);
    const color = getStatusColor(point.status);
    const statusIcon = getStatusIcon(point.status);
    
    const icon = L.divIcon({
        html: `
            <div style="position: relative;" title="${point.name || 'Точка ADTS'} - ${normalizedStatus}">
                <div class="custom-marker" style="
                    background: ${color};
                    width: ${CONFIG.MARKERS.defaultSize}px;
                    height: ${CONFIG.MARKERS.defaultSize}px;
                    border-radius: 50%;
                    border: 3px solid white;
                    box-shadow: 0 3px 8px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: ${color === '#f1c40f' ? '#2c3e50' : 'white'};
                    font-weight: bold;
                    font-size: 14px;
                    transition: all 0.3s;
                    cursor: pointer;
                ">
                    ${statusIcon}
                </div>
                ${point.isMock ? '<div style="position: absolute; top: -4px; right: -4px; width: 12px; height: 12px; background: #f39c12; border-radius: 50%; border: 2px solid white;"></div>' : ''}
            </div>
        `,
        className: 'adts-marker',
        iconSize: [CONFIG.MARKERS.defaultSize, CONFIG.MARKERS.defaultSize],
        iconAnchor: [CONFIG.MARKERS.defaultSize/2, CONFIG.MARKERS.defaultSize]
    });
    
    const marker = L.marker([point.lat, point.lng], {
        icon: icon,
        title: `${point.name} - ${normalizedStatus}`,
        status: normalizedStatus,
        pointId: point.id
    });
    
    marker.bindPopup(createPopupContent(point), {
        maxWidth: CONFIG.MARKERS.popupMaxWidth,
        className: 'adts-popup'
    });
    
    marker.on('click', function() {
        showPointDetails(point);
    });
    
    marker.on('mouseover', function() {
        this.openPopup();
    });
    
    return marker;
}

function createPopupContent(point) {
    const normalizedStatus = normalizeADTSStatus(point.status);
    const color = getStatusColor(point.status);
    const statusIcon = getStatusIcon(point.status);
    
    return `
        <div style="min-width: 280px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
            <h4 style="margin: 0 0 12px 0; color: #2c3e50; border-bottom: 3px solid ${color}; padding-bottom: 8px;">
                ${point.name || 'Без названия'}
            </h4>
            
            <div style="margin-bottom: 15px;">
                <div style="font-size: 12px; color: #7f8c8d; margin-bottom: 5px;">Статус:</div>
                <div style="font-size: 14px; color: ${color}; font-weight: 600;">
                    ${statusIcon} ${normalizedStatus}
                </div>
            </div>
            
            ${point.address ? `
                <div style="margin-bottom: 12px;">
                    <div style="font-size: 12px; color: #7f8c8d; margin-bottom: 5px;">
                        <i class="fas fa-map-marker-alt"></i> Адрес:
                    </div>
                    <div style="font-size: 14px;">${point.address}</div>
                </div>
            ` : ''}
            
            ${point.sheet ? `
                <div style="margin-top: 10px; font-size: 11px; color: #3498db;">
                    <i class="fas fa-file-alt"></i> Лист: ${point.sheet}
                </div>
            ` : ''}
        </div>
    `;
}

// ========== ФИЛЬТРАЦИЯ ==========

function updateFilters() {
    const filters = {
        projects: new Set(),
        regions: new Set(),
        statuses: new Set(),
        managers: new Set(),
        sheets: new Set()
    };
    
    allPoints.forEach(point => {
        if (point.project) filters.projects.add(point.project);
        if (point.region) filters.regions.add(point.region);
        if (point.status) filters.statuses.add(normalizeADTSStatus(point.status));
        if (point.manager) filters.managers.add(point.manager);
        if (point.sheet) filters.sheets.add(point.sheet);
    });
    
    fillFilter('filter-project', Array.from(filters.projects).sort());
    fillFilter('filter-region', Array.from(filters.regions).sort());
    fillFilter('filter-status', Array.from(filters.statuses).sort());
    fillFilter('filter-manager', Array.from(filters.managers).sort());
}

function fillFilter(selectId, options) {
    const select = document.getElementById(selectId);
    if (!select) return;
    
    const selected = Array.from(select.selectedOptions).map(opt => opt.value);
    select.innerHTML = '<option value="">Все</option>';
    
    options.forEach(option => {
        if (option && option.trim() !== '') {
            const opt = document.createElement('option');
            opt.value = option;
            opt.textContent = option;
            
            if (selected.includes(option)) {
                opt.selected = true;
            }
            
            select.appendChild(opt);
        }
    });
}

function applyFilters() {
    activeFilters.projects = getSelectedValues('filter-project');
    activeFilters.regions = getSelectedValues('filter-region');
    activeFilters.statuses = getSelectedValues('filter-status');
    activeFilters.managers = getSelectedValues('filter-manager');
    activeFilters.sheets = getSelectedValues('filter-sheets');
    
    showPointsOnMap();
    updateFilterCounts();
    showNotification('Фильтры применены', 'success');
}

function clearFilters() {
    ['filter-sheets', 'filter-project', 'filter-region', 'filter-status', 'filter-manager'].forEach(id => {
        const select = document.getElementById(id);
        if (select) {
            Array.from(select.options).forEach(opt => opt.selected = false);
            if (select.options.length > 0) {
                select.options[0].selected = true;
            }
        }
    });
    
    activeFilters = {
        projects: [],
        regions: [],
        statuses: [],
        managers: [],
        sheets: []
    };
    
    showPointsOnMap();
    updateFilterCounts();
    showNotification('Фильтры сброшены', 'success');
}

function getSelectedValues(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return [];
    
    return Array.from(select.selectedOptions)
        .map(opt => opt.value)
        .filter(val => val !== '');
}

function filterPoints() {
    return allPoints.filter(point => {
        if (activeFilters.projects.length > 0 && !activeFilters.projects.includes(point.project)) return false;
        if (activeFilters.regions.length > 0 && !activeFilters.regions.includes(point.region)) return false;
        if (activeFilters.statuses.length > 0 && !activeFilters.statuses.includes(normalizeADTSStatus(point.status))) return false;
        if (activeFilters.managers.length > 0 && !activeFilters.managers.includes(point.manager)) return false;
        if (activeFilters.sheets.length > 0 && !activeFilters.sheets.includes(point.sheet)) return false;
        return true;
    });
}

// ========== ПОИСК ==========

function searchPoints() {
    const searchInput = document.getElementById('search');
    if (!searchInput) return;
    
    const query = searchInput.value.trim().toLowerCase();
    
    if (!query) {
        showNotification('Введите текст для поиска', 'info');
        return;
    }
    
    const results = allPoints.filter(point => {
        const normalizedStatus = normalizeADTSStatus(point.status).toLowerCase();
        return (
            (point.name && point.name.toLowerCase().includes(query)) ||
            (point.address && point.address.toLowerCase().includes(query)) ||
            (point.region && point.region.toLowerCase().includes(query)) ||
            normalizedStatus.includes(query)
        );
    });
    
    if (results.length === 0) {
        showNotification('Ничего не найдено', 'info');
        return;
    }
    
    markerCluster.clearLayers();
    
    results.forEach(point => {
        if (point.lat && point.lng) {
            const marker = createMarker(point);
            markerCluster.addLayer(marker);
        }
    });
    
    if (results.length > 0 && results.some(p => p.lat && p.lng)) {
        const bounds = L.latLngBounds(
            results
                .filter(p => p.lat && p.lng)
                .map(p => [p.lat, p.lng])
        );
        
        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }
    
    showNotification(`Найдено ${results.length} точек`, 'success');
}

function searchPointsSidebar() {
    const searchInput = document.getElementById('search-sidebar');
    const searchMapInput = document.getElementById('search');
    
    if (!searchInput || !searchMapInput) return;
    
    searchMapInput.value = searchInput.value;
    searchPoints();
}

// ========== ИНФОРМАЦИЯ О ТОЧКЕ ==========

function showPointDetails(point) {
    const container = document.getElementById('point-details');
    const infoSection = document.getElementById('point-info');
    
    if (!container || !infoSection) return;
    
    const normalizedStatus = normalizeADTSStatus(point.status);
    const color = getStatusColor(point.status);
    const statusIcon = getStatusIcon(point.status);
    
    container.innerHTML = `
        <div style="margin-bottom: 20px;">
            <h5 style="color: white; margin-bottom: 10px; font-size: 18px;">${point.name || 'Без названия'}</h5>
            <div style="background: ${color}; color: ${color === '#f1c40f' ? '#2c3e50' : 'white'}; padding: 8px 12px; border-radius: 6px; display: inline-flex; align-items: center; gap: 8px;">
                ${statusIcon} ${normalizedStatus}
            </div>
        </div>
        
        <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
            ${point.address ? `
                <p style="margin-bottom: 12px;">
                    <strong style="color: #3498db; display: block; margin-bottom: 5px;">
                        <i class="fas fa-map-marker-alt"></i> Адрес:
                    </strong>
                    <span style="font-size: 14px;">${point.address}</span>
                </p>
            ` : ''}
            
            ${point.region ? `
                <p style="margin-bottom: 12px;">
                    <strong style="color: #3498db; display: block; margin-bottom: 5px;">
                        <i class="fas fa-globe"></i> Регион:
                    </strong>
                    <span style="font-size: 14px;">${point.region}</span>
                </p>
            ` : ''}
            
            ${point.sheet ? `
                <p style="margin-bottom: 12px;">
                    <strong style="color: #3498db; display: block; margin-bottom: 5px;">
                        <i class="fas fa-file-alt"></i> Лист:
                    </strong>
                    <span style="font-size: 14px;">${point.sheet}</span>
                </p>
            ` : ''}
        </div>
    `;
    
    infoSection.style.display = 'block';
}

// ========== СТАТИСТИКА ==========

function updateStatistics() {
    const filteredPoints = filterPoints();
    const shownPoints = filteredPoints.filter(p => p.lat && p.lng).length;
    const exactPoints = filteredPoints.filter(p => p.lat && p.lng && !p.isMock).length;
    const approximatePoints = filteredPoints.filter(p => p.isMock).length;
    
    const totalPointsElement = document.getElementById('total-points');
    const shownPointsElement = document.getElementById('shown-points');
    const accuracyElement = document.getElementById('accuracy-stats');
    const shownPercentageElement = document.getElementById('shown-percentage');
    
    if (totalPointsElement) totalPointsElement.textContent = allPoints.length;
    if (shownPointsElement) shownPointsElement.textContent = shownPoints;
    if (accuracyElement) accuracyElement.textContent = `${exactPoints}/${approximatePoints}`;
    
    if (shownPercentageElement && allPoints.length > 0) {
        const percentage = Math.round((shownPoints / allPoints.length) * 100);
        shownPercentageElement.textContent = `${percentage}% от общего числа`;
    }
}

function updateStatusStatistics() {
    const filteredPoints = filterPoints();
    
    const statusCounts = {
        'Выполнен': 0,
        'Нет оборудования': 0,
        'В очереди': 0,
        'Первичный': 0,
        'Финальный': 0,
        'Доработка после монтажа': 0
    };
    
    filteredPoints.forEach(point => {
        const normalizedStatus = normalizeADTSStatus(point.status);
        if (statusCounts.hasOwnProperty(normalizedStatus)) {
            statusCounts[normalizedStatus]++;
        }
    });
    
    // Обновляем счетчики в легенде
    Object.keys(statusCounts).forEach(status => {
        const elementId = `count-${status.toLowerCase().replace(/\s+/g, '-').replace(/после-монтажа/, '')}`;
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = statusCounts[status];
        }
    });
}

function updateFilterCounts() {
    const updateCount = (selectId, countElementId) => {
        const select = document.getElementById(selectId);
        const countElement = document.getElementById(countElementId);
        if (select && countElement) {
            const selectedCount = Array.from(select.selectedOptions).filter(opt => opt.value !== '').length;
            if (selectedCount === 0) {
                countElement.textContent = `Все`;
            } else {
                countElement.textContent = `${selectedCount} выбрано`;
            }
        }
    };
    
    updateCount('filter-sheets', 'sheets-count');
    updateCount('filter-project', 'project-count');
    updateCount('filter-region', 'region-count');
    updateCount('filter-status', 'status-count');
    updateCount('filter-manager', 'manager-count');
}

function updateLegend() {
    const container = document.getElementById('legend');
    if (!container) return;
    
    const statuses = [
        { name: 'Выполнен', color: '#2ecc71', icon: 'check-circle' },
        { name: 'Нет оборудования', color: '#e74c3c', icon: 'times-circle' },
        { name: 'В очереди', color: '#3498db', icon: 'clock' },
        { name: 'Первичный', color: '#f1c40f', icon: 'hammer' },
        { name: 'Финальный', color: '#9b59b6', icon: 'check-double' },
        { name: 'Доработка после монтажа', color: '#95a5a6', icon: 'tools' }
    ];
    
    let legendHTML = '<h5 style="color: #2c3e50; margin-bottom: 15px;"><i class="fas fa-palette"></i> Статусы ADTS</h5>';
    
    const filteredPoints = filterPoints();
    
    statuses.forEach(status => {
        const count = filteredPoints.filter(p => 
            normalizeADTSStatus(p.status) === status.name
        ).length;
        
        legendHTML += `
            <div class="legend-item" onclick="filterByStatus('${status.name}')" title="Нажмите для фильтрации">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 16px; height: 16px; border-radius: 50%; background: ${status.color}; border: 2px solid white;"></div>
                    <span style="font-size: 13px; color: #2c3e50;">${status.name}</span>
                </div>
                <span style="font-size: 12px; color: #7f8c8d;">${count}</span>
            </div>
        `;
    });
    
    container.innerHTML = legendHTML;
}

// ========== ЦЕНТРИРОВАНИЕ КАРТЫ ==========

function centerMapOnFilteredPoints() {
    const filteredPoints = filterPoints();
    const pointsWithCoords = filteredPoints.filter(p => p.lat && p.lng);
    
    if (pointsWithCoords.length === 0) {
        showNotification('Нет точек с координатами для центрирования', 'warning');
        return;
    }
    
    if (pointsWithCoords.length === 1) {
        const point = pointsWithCoords[0];
        map.setView([point.lat, point.lng], 14);
    } else {
        const bounds = L.latLngBounds(pointsWithCoords.map(p => [p.lat, p.lng]));
        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }
}

function centerMap() {
    centerMapOnFilteredPoints();
}

// ========== АВТООБНОВЛЕНИЕ ==========

function setupAutoUpdate() {
    if (CONFIG.UPDATE?.auto && CONFIG.UPDATE.interval > 0) {
        if (updateInterval) {
            clearInterval(updateInterval);
        }
        
        updateInterval = setInterval(() => {
            if (!isLoading) {
                loadData();
            }
        }, CONFIG.UPDATE.interval);
    }
}

// ========== ДЕМО-ДАННЫЕ ==========

function showDemoData() {
    console.log('Показываем демо-данные...');
    
    allPoints = [
        {
            id: 'demo_1',
            name: 'Магазин ADTS №101',
            region: 'Москва',
            address: 'ул. Тверская, д. 15',
            status: 'Выполнено',
            manager: 'Иванов И.И.',
            contractor: 'ООО "МонтажСервис"',
            project: 'ADTS Москва 2024',
            sheet: 'Москва',
            lat: 55.7570,
            lng: 37.6145,
            isMock: false
        },
        {
            id: 'demo_2',
            name: 'Супермаркет ADTS №202',
            region: 'Московская область',
            address: 'г. Химки, ул. Ленина, 25',
            status: 'Нет оборудования',
            manager: 'Петров П.П.',
            contractor: 'ИП Сидоров',
            project: 'ADTS Подмосковье',
            sheet: 'Московская область',
            lat: 55.8890,
            lng: 37.4450,
            isMock: false
        },
        {
            id: 'demo_3',
            name: 'Гипермаркет ADTS №303',
            region: 'Алтайский край',
            address: 'Алтайский край, Мамонтово (с), ул. Партизанская, 158',
            status: 'В очереди на монтаж',
            manager: 'Казак Светлана',
            contractor: 'Дмитриев Александр',
            project: 'ADTS Сибирь',
            sheet: 'Сибирь',
            lat: 53.3481,
            lng: 83.7794,
            isMock: true
        }
    ];
    
    availableSheets = [
        { id: '1', title: 'Москва' },
        { id: '2', title: 'Московская область' },
        { id: '3', title: 'Сибирь' }
    ];
    
    updateSheetsFilter(availableSheets);
    selectAllSheets();
    
    updateFilters();
    updateStatistics();
    updateStatusStatistics();
    updateLegend();
    updateLastUpdateTime();
    showPointsOnMap();
    
    updateStatus('Демо-данные загружены', 'warning');
    showNotification('Используются демо-данные', 'warning');
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

function getRandomCoordinate(address, region = '') {
    const regionCenters = {
        'Москва': { lat: 55.7558, lng: 37.6173 },
        'Московская': { lat: 55.7558, lng: 37.6173 },
        'Алтайский': { lat: 52.5186, lng: 85.1019 },
        'default': { lat: 55.7558, lng: 37.6173 }
    };
    
    let baseLat = 55.7558;
    let baseLng = 37.6173;
    let radius = 0.3;
    
    if (region) {
        const regionStr = region.toString().trim().toLowerCase();
        
        for (const [key, coords] of Object.entries(regionCenters)) {
            if (regionStr.includes(key.toLowerCase())) {
                baseLat = coords.lat;
                baseLng = coords.lng;
                radius = 0.5;
                break;
            }
        }
    }
    
    const randomLat = baseLat + (Math.random() - 0.5) * radius * 2;
    const randomLng = baseLng + (Math.random() - 0.5) * radius * 3;
    
    return { lat: randomLat, lng: randomLng };
}

// ========== ГЛОБАЛЬНЫЕ ФУНКЦИИ ==========

window.loadData = loadData;
window.clearFilters = clearFilters;
window.applyFilters = applyFilters;
window.searchPoints = searchPoints;
window.searchPointsSidebar = searchPointsSidebar;
window.closeModal = closeModal;
window.centerMap = centerMap;
window.centerMapOnFilteredPoints = centerMapOnFilteredPoints;
window.updateLegend = updateLegend;
window.updateFilterCounts = updateFilterCounts;
window.updateLegendFromApp = updateLegend;
window.loadAvailableSheets = loadAvailableSheets;
window.getSelectedSheets = getSelectedSheets;
window.selectAllSheets = selectAllSheets;

// Функция для быстрого фильтра по статусу
window.filterByStatus = function(status) {
    const statusSelect = document.getElementById('filter-status');
    if (!statusSelect) return;
    
    Array.from(statusSelect.options).forEach(option => {
        option.selected = option.value === status;
    });
    
    applyFilters();
    showNotification(`Фильтр по статусу: ${status}`, 'success');
};
[file content end]
