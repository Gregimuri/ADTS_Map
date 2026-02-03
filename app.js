// ========== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ==========
let map;
let markerCluster;
let allPoints = [];
let activeFilters = {
    projects: [],
    regions: [],
    statuses: [],
    managers: [],
    sheets: [] // Добавляем фильтр по листам
};

let updateInterval;
let markersMap = new Map();
let isLoading = false;
let lastUpdateTime = null;
let updateTimerInterval = null;
let availableSheets = []; // Список доступных листов
let sheetPointsCache = new Map(); // Кэш точек по листам
let sheetsInfoCache = null; // Кэш информации о листах
let lastSheetsFetchTime = null; // Время последнего получения информации о листах

// Динамические настройки из данных
let dynamicStatusMapping = {};
let dynamicStatusColors = {
    'default': '#95a5a6'
};

// Цветовая схема для статусов ADTS
const ADTS_STATUS_COLORS = {
    // Основные статусы
    'Выполнен': '#2ecc71',           // зеленый
    'Нет оборудования': '#e74c3c',   // красный
    'В очереди': '#3498db',          // синий
    'Первичный': '#f1c40f',          // желтый
    'Финальный': '#9b59b6',          // фиолетовый
    'Доработка после монтажа': '#95a5a6', // серый
    
    // Альтернативные названия
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
    console.log('Инициализация приложения ADTS с поддержкой листов...');
    initMap();
    showDemoData();
    loadAvailableSheets(); // Сначала загружаем доступные листы
    setupAutoUpdate();
    startUpdateTimer();
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
                const markers = cluster.getAllChildMarkers();
                
                let color = dynamicStatusColors.default;
                const statuses = markers.map(m => m.options.status);
                
                // Находим цвет для кластера на основе статусов точек
                const priorityOrder = [
                    'Нет оборудования',
                    'Доработка после монтажа',
                    'В очереди',
                    'Первичный',
                    'Финальный',
                    'Выполнен'
                ];
                
                for (const priorityStatus of priorityOrder) {
                    if (statuses.includes(priorityStatus)) {
                        color = ADTS_STATUS_COLORS[priorityStatus] || dynamicStatusColors.default;
                        break;
                    }
                }
                
                const size = Math.min(40 + Math.sqrt(count) * 5, 60);
                
                return L.divIcon({
                    html: `<div style="background:${color}; color:white; width:${size}px; height:${size}px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; border:3px solid white; box-shadow:0 2px 8px rgba(0,0,0,0.4); font-size:${Math.min(14 + count/10, 18)}px;">${count}</div>`,
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
    
    // Автоматическое удаление через указанное время
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
            const diff = Math.floor((now - lastUpdateTime) / 1000); // разница в секундах
            
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

// ========== РАБОТА С ЛИСТАМИ GOOGLE ТАБЛИЦЫ ==========

async function loadAvailableSheets() {
    if (!CONFIG.SHEETS.enabled) {
        console.log('Поддержка листов выключена в конфигурации');
        updateSheetsFilter([]);
        loadData(); // Загружаем данные обычным способом
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
            .map(sheet => {
                const title = sheet.title.$t;
                return {
                    id: sheet.id.$t.split('/').pop(),
                    title: title,
                    gid: sheet.id.$t.split('/').pop()
                };
            })
            .filter(sheet => {
                // Исключаем системные листы
                const lowerTitle = sheet.title.toLowerCase();
                const excluded = CONFIG.SHEETS.excludedSheets || [];
                return !excluded.some(excludedName => 
                    lowerTitle.includes(excludedName.toLowerCase())
                );
            });
        
        console.log(`Найдено листов: ${availableSheets.length}`, availableSheets.map(s => s.title));
        
        if (availableSheets.length === 0) {
            console.warn('Не найдено подходящих листов, использую первый лист по умолчанию');
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
        
        // Загружаем данные с выбранных листов
        if (availableSheets.length > 0) {
            const selectedSheets = getSelectedSheets();
            if (selectedSheets.length === 0) {
                // По умолчанию выбираем все листы
                selectAllSheets();
            }
            loadData();
        } else {
            showDemoData(); // Показываем демо-данные если нет листов
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
        
        // Помечаем выбранные
        if (selectedValues.includes(sheet.title)) {
            option.selected = true;
        }
        
        sheetSelect.appendChild(option);
    });
    
    // Если нет выбранных листов, выбираем все
    if (selectedValues.length === 0 && sheets.length > 0) {
        selectAllSheets();
    }
    
    console.log(`Добавлено ${sheets.length} листов в фильтр`);
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

// ========== ЗАГРУЗКА ДАННЫХ С ЛИСТОВ ==========

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
        
        console.log('Начинаю загрузку данных ADTS с листов...');
        
        let allData = [];
        
        if (CONFIG.SHEETS.enabled && availableSheets.length > 0) {
            // Загружаем данные с выбранных листов
            const selectedSheets = getSelectedSheets();
            const sheetsToLoad = selectedSheets.length > 0 ? 
                selectedSheets : availableSheets.map(s => s.title);
            
            console.log(`Загружаю данные с ${sheetsToLoad.length} листов:`, sheetsToLoad);
            
            for (const sheetName of sheetsToLoad) {
                try {
                    console.log(`Загружаю лист: ${sheetName}`);
                    
                    // Проверяем кэш
                    if (sheetPointsCache.has(sheetName)) {
                        const cachedPoints = sheetPointsCache.get(sheetName);
                        console.log(`Использую кэш для листа ${sheetName}: ${cachedPoints.length} точек`);
                        allData = allData.concat(cachedPoints);
                        continue;
                    }
                    
                    const sheetData = await loadSheetData(sheetName);
                    
                    if (sheetData && sheetData.length > 0) {
                        // Обрабатываем данные и добавляем информацию о листе
                        const processedPoints = processData(sheetData, sheetName);
                        
                        // Добавляем координаты
                        const pointsWithCoords = await addCoordinatesFast(processedPoints);
                        
                        // Сохраняем в кэш
                        sheetPointsCache.set(sheetName, pointsWithCoords);
                        
                        allData = allData.concat(pointsWithCoords);
                        
                        console.log(`Лист "${sheetName}" обработан: ${pointsWithCoords.length} точек`);
                    } else {
                        console.warn(`Лист "${sheetName}" пуст или не содержит данных`);
                    }
                    
                } catch (sheetError) {
                    console.error(`Ошибка загрузки листа "${sheetName}":`, sheetError);
                    showNotification(`Ошибка загрузки листа "${sheetName}"`, 'warning');
                }
            }
        } else {
            // Загрузка с одного листа (старый метод)
            console.log('Использую метод загрузки с одного листа');
            const data = await loadDataAsCSV();
            
            if (!data || data.length === 0) {
                throw new Error('Не удалось загрузить данные');
            }
            
            const processedPoints = processData(data, 'Основной лист');
            allData = await addCoordinatesFast(processedPoints);
        }
        
        if (allData.length === 0) {
            throw new Error('Не удалось загрузить данные с выбранных листов');
        }
        
        console.log(`Всего загружено точек: ${allData.length} с ${availableSheets.length} листов`);
        
        allPoints = allData;
        
        // Определяем динамические настройки на основе данных
        determineDynamicSettings(allPoints);
        
        // Показываем несколько точек для отладки
        if (allPoints.length > 0 && CONFIG.DEBUG.logLevel === 'debug') {
            console.log('Примеры обработанных точек ADTS:');
            const groupedBySheet = {};
            allPoints.forEach(point => {
                if (!groupedBySheet[point.sheet]) {
                    groupedBySheet[point.sheet] = 0;
                }
                groupedBySheet[point.sheet]++;
            });
            console.log('Точек по листам:', groupedBySheet);
            allPoints.slice(0, 3).forEach((point, i) => {
                console.log(`${i+1}. Лист: "${point.sheet}" | Название: "${point.name}" | Статус: "${point.status}"`);
            });
        }
        
        updateFilters();
        updateStatistics();
        updateStatusStatistics();
        updateLegend();
        showPointsOnMap();
        updateLastUpdateTime();
        
        closeModal();
        updateStatus(`Загружено: ${allPoints.length} точек с ${availableSheets.length} листов`, 'success');
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
    console.log(`Загружаю данные с листа: ${sheetName}`);
    
    // URL для загрузки конкретного листа в формате CSV
    const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
    
    console.log(`URL для листа ${sheetName}: ${url}`);
    
    try {
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} для листа ${sheetName}`);
        }
        
        const csvText = await response.text();
        const parsedData = parseCSV(csvText);
        
        console.log(`Лист "${sheetName}" распарсен: ${parsedData.length} строк`);
        return parsedData;
        
    } catch (error) {
        console.error(`Ошибка загрузки листа "${sheetName}":`, error);
        
        // Пробуем альтернативный метод
        try {
            console.log(`Пробую альтернативный метод для листа "${sheetName}"`);
            const altUrl = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/export?format=csv&sheet=${encodeURIComponent(sheetName)}`;
            const altResponse = await fetch(altUrl);
            
            if (!altResponse.ok) {
                throw new Error(`Альтернативный метод тоже не сработал: ${altResponse.status}`);
            }
            
            const altCsvText = await altResponse.text();
            const altParsedData = parseCSV(altCsvText);
            
            console.log(`Альтернативный метод для "${sheetName}" успешен: ${altParsedData.length} строк`);
            return altParsedData;
            
        } catch (altError) {
            console.error(`Альтернативный метод для "${sheetName}" тоже не сработал:`, altError);
            throw error; // Пробрасываем оригинальную ошибку
        }
    }
}

// Старый метод для обратной совместимости
async function loadDataAsCSV() {
    const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/export?format=csv`;
    
    console.log(`Загружаю CSV: ${url}`);
    
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
            let quoteChar = '';
            
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const nextChar = i + 1 < line.length ? line[i + 1] : '';
                
                if ((char === '"' || char === "'") && !inQuotes) {
                    inQuotes = true;
                    quoteChar = char;
                    continue;
                }
                
                if (char === quoteChar && inQuotes) {
                    if (nextChar === quoteChar) {
                        current += char;
                        i++;
                        continue;
                    }
                    inQuotes = false;
                    quoteChar = '';
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
                if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || 
                    (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
                    cleaned = cleaned.substring(1, cleaned.length - 1);
                }
                cleaned = cleaned.replace(/""/g, '"');
                cleaned = cleaned.replace(/\r/g, '');
                return cleaned;
            });
            
            if (cleanedRow.some(cell => cell.trim() !== '')) {
                result.push(cleanedRow);
            }
        }
        
        console.log(`CSV распарсен: ${result.length} строк`);
        return result;
        
    } catch (error) {
        console.error('Ошибка парсинга CSV:', error);
        return [];
    }
}

// ========== ОБРАБОТКА ДАННЫХ С УЧЕТОМ ЛИСТА ==========

function processData(rows, sheetName = '') {
    console.log(`Начинаю обработку данных с листа "${sheetName}"...`);
    
    if (!rows || rows.length < 2) {
        return [];
    }
    
    const points = [];
    const headers = rows[0].map(h => h.toString().trim());
    
    console.log(`Лист "${sheetName}": ${headers.length} столбцов`);
    
    const colIndices = findColumnIndices(headers);
    
    const useSimpleApproach = headers.length < 3 || 
                              Object.values(colIndices).filter(idx => idx !== -1).length < 3;
    
    if (useSimpleApproach) {
        console.log(`Использую простой подход к парсингу данных для листа "${sheetName}"`);
        return processDataSimple(rows, sheetName);
    }
    
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        
        if (!row || row.length === 0) {
            continue;
        }
        
        const point = {
            id: `point_${sheetName}_${i}_${Date.now()}`,
            sheetRow: i + 1,
            sheet: sheetName, // Добавляем информацию о листе
            name: '',
            region: '',
            address: '',
            status: '',
            manager: '',
            contractor: '',
            project: '',
            originalAddress: '',
            originalStatus: '',
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
        
        point.originalAddress = point.address || '';
        point.originalStatus = point.status || '';
        
        // Нормализуем статус для ADTS
        if (point.status) {
            const normalizedStatus = normalizeADTSStatus(point.status);
            point.status = normalizedStatus;
        }
        
        // Если project не указан, используем название листа
        if (!point.project || point.project.trim() === '') {
            point.project = sheetName;
        }
        
        if (!point.address && point.region && point.region.includes(',')) {
            point.address = point.region;
            point.region = '';
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
    
    console.log(`Лист "${sheetName}" обработан: ${points.length} точек`);
    return points;
}

function processDataSimple(rows, sheetName = '') {
    console.log(`Использую простой метод обработки данных для листа "${sheetName}"...`);
    
    const points = [];
    const headers = rows[0] || [];
    
    let nameIndex = 0;
    let regionIndex = -1;
    let addressIndex = -1;
    let statusIndex = -1;
    let projectIndex = -1;
    
    headers.forEach((header, index) => {
        const h = header.toLowerCase();
        if (h.includes('название') || h.includes('имя') || h.includes('точка')) nameIndex = index;
        else if (h.includes('регион')) regionIndex = index;
        else if (h.includes('адрес')) addressIndex = index;
        else if (h.includes('статус')) statusIndex = index;
        else if (h.includes('проект')) projectIndex = index;
    });
    
    if (regionIndex === -1 && headers.length > 1) regionIndex = 1;
    if (addressIndex === -1 && headers.length > 2) addressIndex = 2;
    if (statusIndex === -1 && headers.length > 3) statusIndex = 3;
    if (projectIndex === -1 && headers.length > 4) projectIndex = 4;
    
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
            isMock: true,
            dateAdded: new Date().toISOString().split('T')[0]
        };
        
        if (row.length > nameIndex) point.name = cleanString(row[nameIndex]);
        if (regionIndex !== -1 && row.length > regionIndex) point.region = cleanString(row[regionIndex]);
        if (addressIndex !== -1 && row.length > addressIndex) point.address = cleanString(row[addressIndex]);
        if (statusIndex !== -1 && row.length > statusIndex) point.status = cleanString(row[statusIndex]);
        if (projectIndex !== -1 && row.length > projectIndex) point.project = cleanString(row[projectIndex]);
        
        if (row.length > 5) point.manager = cleanString(row[5]);
        if (row.length > 6) point.contractor = cleanString(row[6]);
        
        // Если project не указан, используем название листа
        if (!point.project || point.project.trim() === '') {
            point.project = sheetName;
        }
        
        // Нормализуем статус для ADTS
        if (point.status) {
            point.originalStatus = point.status;
            point.status = normalizeADTSStatus(point.status);
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
        
        if (point.name) {
            points.push(point);
        }
    }
    
    console.log(`Лист "${sheetName}" обработан (простой метод): ${points.length} точек`);
    return points;
}

// ========== ФИЛЬТРАЦИЯ С УЧЕТОМ ЛИСТОВ ==========

function updateFilters() {
    console.log('Обновляю фильтры ADTS с учетом листов...');
    
    const filters = {
        projects: new Set(),
        regions: new Set(),
        statuses: new Set(),
        managers: new Set(),
        sheets: new Set() // Добавляем фильтр по листам
    };
    
    allPoints.forEach(point => {
        if (point.project && point.project.trim() !== '') filters.projects.add(point.project);
        if (point.region && point.region.trim() !== '') filters.regions.add(point.region);
        
        // Используем нормализованный статус для фильтров
        const normalizedStatus = normalizeADTSStatus(point.status);
        if (normalizedStatus && normalizedStatus.trim() !== '') filters.statuses.add(normalizedStatus);
        
        if (point.manager && point.manager.trim() !== '') filters.managers.add(point.manager);
        if (point.sheet && point.sheet.trim() !== '') filters.sheets.add(point.sheet);
    });
    
    // Сортируем фильтры для удобства
    fillFilter('filter-project', Array.from(filters.projects).sort());
    fillFilter('filter-region', Array.from(filters.regions).sort());
    fillFilter('filter-status', Array.from(filters.statuses).sort());
    fillFilter('filter-manager', Array.from(filters.managers).sort());
    
    // Фильтр по листам обновляем отдельно (он уже есть)
    console.log('Доступные фильтры ADTS:');
    console.log('- Проекты:', Array.from(filters.projects).length);
    console.log('- Регионы:', Array.from(filters.regions).length);
    console.log('- Статусы:', Array.from(filters.statuses));
    console.log('- Менеджеры:', Array.from(filters.managers).length);
    console.log('- Листы:', Array.from(filters.sheets).length);
    
    // Обновляем подсказки
    updateFilterCounts();
}

function applyFilters() {
    console.log('Применяю фильтры ADTS...');
    
    activeFilters.projects = getSelectedValues('filter-project');
    activeFilters.regions = getSelectedValues('filter-region');
    activeFilters.statuses = getSelectedValues('filter-status');
    activeFilters.managers = getSelectedValues('filter-manager');
    activeFilters.sheets = getSelectedValues('filter-sheets'); // Добавляем фильтр по листам
    
    console.log('Активные фильтры:', activeFilters);
    
    showPointsOnMap();
    updateFilterCounts();
    showNotification('Фильтры применены', 'success');
}

function filterPoints() {
    const filtered = allPoints.filter(point => {
        const filters = [
            { key: 'project', value: point.project, active: activeFilters.projects },
            { key: 'region', value: point.region, active: activeFilters.regions },
            { key: 'status', value: normalizeADTSStatus(point.status), active: activeFilters.statuses },
            { key: 'manager', value: point.manager, active: activeFilters.managers },
            { key: 'sheet', value: point.sheet, active: activeFilters.sheets } // Фильтр по листу
        ];
        
        for (const filter of filters) {
            if (filter.active.length > 0) {
                if (!filter.value || !filter.active.includes(filter.value)) {
                    return false;
                }
            }
        }
        
        return true;
    });
    
    return filtered;
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
    
    console.log(`Поиск ADTS: "${query}"`);
    
    const results = allPoints.filter(point => {
        const normalizedStatus = normalizeADTSStatus(point.status).toLowerCase();
        return (
            (point.name && point.name.toLowerCase().includes(query)) ||
            (point.address && point.address.toLowerCase().includes(query)) ||
            (point.region && point.region.toLowerCase().includes(query)) ||
            (point.manager && point.manager.toLowerCase().includes(query)) ||
            (point.project && point.project.toLowerCase().includes(query)) ||
            normalizedStatus.includes(query)
        );
    });
    
    console.log(`Найдено результатов ADTS: ${results.length}`);
    
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
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
        }
    }
    
    showNotification(`Найдено ${results.length} точек ADTS`, 'success');
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
            <div class="point-details-status" style="background: ${color}; color: ${['#f1c40f'].includes(color) ? '#2c3e50' : 'white'};">
                ${statusIcon} ${normalizedStatus}
            </div>
        </div>
        
        <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
            ${point.address ? `
                <p style="margin-bottom: 12px;">
                    <strong style="color: #3498db; display: block; margin-bottom: 5px;">
                        <i class="fas fa-map-marker-alt"></i> Адрес:
                    </strong>
                    <span style="font-size: 14px; line-height: 1.4;">${point.address}</span>
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
            
            ${point.project ? `
                <p style="margin-bottom: 12px;">
                    <strong style="color: #3498db; display: block; margin-bottom: 5px;">
                        <i class="fas fa-project-diagram"></i> Проект:
                    </strong>
                    <span style="font-size: 14px;">${point.project}</span>
                </p>
            ` : ''}
            
            ${point.lat && point.lng ? `
                <p style="margin: 0;">
                    <strong style="color: #3498db; display: block; margin-bottom: 5px;">
                        <i class="fas fa-crosshairs"></i> Координаты:
                    </strong>
                    <span style="font-size: 14px; font-family: monospace;">${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}</span>
                </p>
            ` : ''}
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 14px;">
            ${point.manager ? `
                <div>
                    <strong style="color: #3498db; display: block; margin-bottom: 5px;">
                        <i class="fas fa-user-tie"></i> Менеджер:
                    </strong>
                    <span>${point.manager}</span>
                </div>
            ` : ''}
            
            ${point.contractor ? `
                <div>
                    <strong style="color: #3498db; display: block; margin-bottom: 5px;">
                        <i class="fas fa-hard-hat"></i> Подрядчик:
                    </strong>
                    <span>${point.contractor}</span>
                </div>
            ` : ''}
        </div>
        
        ${point.isMock ? `
            <div style="margin-top: 20px; padding: 12px; background: #f39c12; color: white; border-radius: 8px; font-size: 13px; display: flex; align-items: center; gap: 10px;">
                <i class="fas fa-exclamation-triangle" style="font-size: 16px;"></i>
                <div>
                    <strong>Приблизительные координаты</strong>
                    <div style="font-size: 12px; opacity: 0.9; margin-top: 3px;">Точное местоположение неизвестно</div>
                </div>
            </div>
        ` : ''}
        
        <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 11px; color: #95a5a6;">
            <div>ID: ${point.id}</div>
            <div>Строка в таблице: ${point.sheetRow}</div>
            ${point.originalStatus ? `<div>Исходный статус: ${point.originalStatus}</div>` : ''}
            ${point.dateAdded ? `<div>Добавлено: ${point.dateAdded}</div>` : ''}
        </div>
    `;
    
    infoSection.style.display = 'block';
    infoSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
    const totalHintElement = document.getElementById('total-hint');
    const accuracyHintElement = document.getElementById('accuracy-hint');
    
    if (totalPointsElement) totalPointsElement.textContent = allPoints.length;
    if (shownPointsElement) shownPointsElement.textContent = shownPoints;
    if (accuracyElement) accuracyElement.textContent = `${exactPoints}/${approximatePoints}`;
    
    // Обновляем проценты
    if (shownPercentageElement && allPoints.length > 0) {
        const percentage = Math.round((shownPoints / allPoints.length) * 100);
        shownPercentageElement.textContent = `${percentage}% от общего числа`;
    }
    
    // Обновляем подсказки
    if (totalHintElement) {
        totalHintElement.textContent = `${filteredPoints.length} отфильтровано`;
    }
    
    if (accuracyHintElement) {
        accuracyHintElement.textContent = `Точные: ${exactPoints}, Приблизительные: ${approximatePoints}`;
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
        'Доработка после монтажа': 0,
        'Не указан': 0
    };
    
    filteredPoints.forEach(point => {
        const normalizedStatus = normalizeADTSStatus(point.status);
        if (statusCounts.hasOwnProperty(normalizedStatus)) {
            statusCounts[normalizedStatus]++;
        } else {
            statusCounts['Не указан']++;
        }
    });
    
    // Обновляем счетчики в легенде
    Object.keys(statusCounts).forEach(status => {
        if (status !== 'Не указан') {
            const elementId = `count-${status.toLowerCase().replace(/\s+/g, '-').replace(/после-монтажа/, '')}`;
            const element = document.getElementById(elementId);
            if (element) {
                element.textContent = statusCounts[status];
                // Динамически изменяем размер индикатора в зависимости от количества
                const count = statusCounts[status];
                const maxCount = Math.max(...Object.values(statusCounts));
                const size = 12 + (count / maxCount) * 8; // от 12px до 20px
                const indicator = element.parentElement?.querySelector('.status-indicator');
                if (indicator) {
                    indicator.style.width = `${size}px`;
                    indicator.style.height = `${size}px`;
                }
            }
        }
    });
    
    // Обновляем круговую диаграмму в статистике (если есть)
    updateStatusChart(statusCounts);
}

function updateStatusChart(statusCounts) {
    const chartElement = document.getElementById('status-chart');
    if (!chartElement) return;
    
    const total = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    if (total === 0) return;
    
    let percentages = {};
    Object.keys(statusCounts).forEach(status => {
        percentages[status] = (statusCounts[status] / total) * 100;
    });
    
    // Создаем conic-gradient для круговой диаграммы
    let gradientParts = [];
    let accumulated = 0;
    
    const statusOrder = ['Выполнен', 'Финальный', 'Первичный', 'В очереди', 'Нет оборудования', 'Доработка после монтажа', 'Не указан'];
    
    statusOrder.forEach((status, index) => {
        if (percentages[status] > 0) {
            const color = getStatusColor(status);
            const start = accumulated;
            const end = accumulated + percentages[status];
            gradientParts.push(`${color} ${start}% ${end}%`);
            accumulated = end;
        }
    });
    
    chartElement.style.background = `conic-gradient(${gradientParts.join(', ')})`;
    chartElement.title = `Статусы ADTS: ${Object.entries(statusCounts).map(([s, c]) => `${s}: ${c}`).join(', ')}`;
}

function updateFilterCounts() {
    const updateCount = (selectId, countElementId) => {
        const select = document.getElementById(selectId);
        const countElement = document.getElementById(countElementId);
        if (select && countElement) {
            const selectedCount = Array.from(select.selectedOptions).filter(opt => opt.value !== '').length;
            const totalCount = Math.min(select.options.length - 1, CONFIG.FILTERS.maxVisibleOptions); // исключаем "Все"
            
            if (selectedCount === 0) {
                countElement.textContent = `Все (${totalCount})`;
            } else {
                countElement.textContent = `${selectedCount} выбрано`;
            }
        }
    };
    
    updateCount('filter-project', 'project-count');
    updateCount('filter-region', 'region-count');
    updateCount('filter-status', 'status-count');
    updateCount('filter-manager', 'manager-count');
}

function updateLegend() {
    const container = document.getElementById('legend');
    if (!container) return;
    
    let legendHTML = '<h5 style="color: #2c3e50; margin-bottom: 15px; display: flex; align-items: center; gap: 8px;"><i class="fas fa-palette"></i> Статусы ADTS</h5>';
    
    const statuses = [
        { name: 'Выполнен', color: '#2ecc71', icon: 'check-circle' },
        { name: 'Нет оборудования', color: '#e74c3c', icon: 'times-circle' },
        { name: 'В очереди', color: '#3498db', icon: 'clock' },
        { name: 'Первичный', color: '#f1c40f', icon: 'hammer' },
        { name: 'Финальный', color: '#9b59b6', icon: 'check-double' },
        { name: 'Доработка после монтажа', color: '#95a5a6', icon: 'tools' }
    ];
    
    // Получаем количество точек по каждому статусу
    const statusCounts = {};
    const filteredPoints = filterPoints();
    
    statuses.forEach(status => {
        statusCounts[status.name] = filteredPoints.filter(p => 
            normalizeADTSStatus(p.status) === status.name
        ).length;
    });
    
    statuses.forEach(status => {
        const count = statusCounts[status.name] || 0;
        const filteredCount = filteredPoints.filter(p => 
            normalizeADTSStatus(p.status) === status.name
        ).length;
        
        legendHTML += `
            <div class="legend-item" style="
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 10px;
                padding: 8px 10px;
                background: ${status.color}15;
                border-radius: 6px;
                border-left: 4px solid ${status.color};
                transition: all 0.3s;
                cursor: pointer;
            " onclick="filterByStatus('${status.name}')" title="Нажмите для фильтрации по статусу '${status.name}'">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="
                        width: 16px;
                        height: 16px;
                        border-radius: 50%;
                        background: ${status.color};
                        border: 2px solid white;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: ${status.color === '#f1c40f' ? '#2c3e50' : 'white'};
                        font-size: 8px;
                    ">
                        <i class="fas fa-${status.icon}"></i>
                    </div>
                    <span style="font-size: 13px; color: #2c3e50; font-weight: 500;">${status.name}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 12px; color: #7f8c8d;">${filteredCount}</span>
                    <span style="font-size: 11px; color: #bdc3c7; background: rgba(0,0,0,0.05); padding: 2px 6px; border-radius: 10px;">
                        ${count}
                    </span>
                </div>
            </div>
        `;
    });
    
    // Добавляем общую статистику
    const totalFiltered = filteredPoints.length;
    const totalAll = allPoints.length;
    const percentage = totalAll > 0 ? Math.round((totalFiltered / totalAll) * 100) : 0;
    
    legendHTML += `
        <div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee; font-size: 12px; color: #7f8c8d;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                <span>Показано:</span>
                <span style="font-weight: 600; color: #2c3e50;">${totalFiltered}</span>
            </div>
            <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                <span>Всего точек:</span>
                <span style="font-weight: 600; color: #2c3e50;">${totalAll}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
                <span>Покрытие:</span>
                <span style="font-weight: 600; color: #2c3e50;">${percentage}%</span>
            </div>
        </div>
    `;
    
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
        showNotification('Карта центрирована на выбранной точке', 'info');
    } else {
        const bounds = L.latLngBounds(pointsWithCoords.map(p => [p.lat, p.lng]));
        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
            showNotification(`Карта центрирована на ${pointsWithCoords.length} точках`, 'info');
        }
    }
}

// ========== АВТООБНОВЛЕНИЕ ==========

function setupAutoUpdate() {
    if (CONFIG.UPDATE?.auto && CONFIG.UPDATE.interval > 0) {
        if (updateInterval) {
            clearInterval(updateInterval);
        }
        
        updateInterval = setInterval(() => {
            if (!isLoading) {
                console.log('Автообновление данных...');
                loadData();
            }
        }, CONFIG.UPDATE.interval);
        
        console.log(`Автообновление настроено: каждые ${CONFIG.UPDATE.interval/1000} сек`);
    }
}

// ========== ДЕМО-ДАННЫЕ С ЛИСТАМИ ==========

function showDemoData() {
    console.log('Показываем демо-данные ADTS с листами...');
    
    allPoints = [
        {
            id: 'demo_adts_1',
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
            isMock: false,
            dateAdded: '2024-01-15'
        },
        {
            id: 'demo_adts_2',
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
            isMock: false,
            dateAdded: '2024-02-10'
        },
        {
            id: 'demo_adts_3',
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
            isMock: true,
            dateAdded: '2024-03-05'
        },
        {
            id: 'demo_adts_4',
            name: 'Торговый центр ADTS',
            region: 'Краснодарский край',
            address: 'г. Краснодар, ул. Красная, 100',
            status: 'Первичный монтаж',
            manager: 'Смирнова Ольга',
            contractor: 'Кузнецов Михаил',
            project: 'ADTS Юг',
            sheet: 'Юг',
            lat: 45.0355,
            lng: 38.9753,
            isMock: true,
            dateAdded: '2024-03-20'
        },
        {
            id: 'demo_adts_5',
            name: 'Молл ADTS Premium',
            region: 'Свердловская область',
            address: 'г. Екатеринбург, пр-кт Ленина, 50',
            status: 'Финальный этап',
            manager: 'Васильев А.А.',
            contractor: 'Николаев Н.Н.',
            project: 'ADTS Урал',
            sheet: 'Урал',
            lat: 56.8389,
            lng: 60.6057,
            isMock: true,
            dateAdded: '2024-04-01'
        },
        {
            id: 'demo_adts_6',
            name: 'Универмаг ADTS №606',
            region: 'Новосибирская область',
            address: 'г. Новосибирск, ул. Советская, 35',
            status: 'Доработка после монтажа',
            manager: 'Козлова Е.В.',
            contractor: 'ООО "ТехноМонтаж"',
            project: 'ADTS Сибирь',
            sheet: 'Сибирь',
            lat: 55.0084,
            lng: 82.9357,
            isMock: true,
            dateAdded: '2024-04-15'
        },
        {
            id: 'demo_adts_7',
            name: 'Дискаунтер ADTS',
            region: 'Ростовская область',
            address: 'г. Ростов-на-Дону, ул. Большая Садовая, 10',
            status: 'Ожидание оборудования',
            manager: 'Алексеев С.С.',
            contractor: 'Петров П.П.',
            project: 'ADTS Юг',
            sheet: 'Юг',
            lat: 47.2224,
            lng: 39.7189,
            isMock: true,
            dateAdded: '2024-05-01'
        },
        {
            id: 'demo_adts_8',
            name: 'Супермаркет у дома ADTS',
            region: 'Татарстан',
            address: 'г. Казань, ул. Баумана, 45',
            status: 'План',
            manager: 'Галиева А.Р.',
            contractor: 'ИП Хусаинов',
            project: 'ADTS Поволжье',
            sheet: 'Поволжье',
            lat: 55.7961,
            lng: 49.1064,
            isMock: true,
            dateAdded: '2024-05-10'
        }
    ];
    
    // Добавляем демо-листы
    availableSheets = [
        { id: '1', title: 'Москва', gid: '0' },
        { id: '2', title: 'Московская область', gid: '1' },
        { id: '3', title: 'Сибирь', gid: '2' },
        { id: '4', title: 'Юг', gid: '3' },
        { id: '5', title: 'Урал', gid: '4' },
        { id: '6', title: 'Поволжье', gid: '5' }
    ];
    
    // Определяем динамические настройки для демо-данных
    determineDynamicSettings(allPoints);
    
    // Обновляем фильтр листов
    updateSheetsFilter(availableSheets);
    
    // Выбираем все листы по умолчанию
    selectAllSheets();
    
    updateFilters();
    updateStatistics();
    updateStatusStatistics();
    updateLegend();
    updateLastUpdateTime();
    showPointsOnMap();
    
    updateStatus('Демо-данные ADTS загружены', 'warning');
    showNotification('Используются демо-данные ADTS с листами', 'warning');
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

function getRandomCoordinate(address, region = '') {
    const regionCenters = {
        // Москва и область
        'Москва': { lat: 55.7558, lng: 37.6173 },
        'Московская': { lat: 55.7558, lng: 37.6173 },
        'Московская обл.': { lat: 55.7558, lng: 37.6173 },
        'Московская область': { lat: 55.7558, lng: 37.6173 },
        
        // Санкт-Петербург и область
        'Санкт-Петербург': { lat: 59.9343, lng: 30.3351 },
        'Ленинградская': { lat: 59.9343, lng: 30.3351 },
        'Ленинградская обл.': { lat: 59.9343, lng: 30.3351 },
        
        // Края
        'Алтайский': { lat: 52.5186, lng: 85.1019 },
        'Алтайский край': { lat: 52.5186, lng: 85.1019 },
        
        'Краснодарский': { lat: 45.0355, lng: 38.9753 },
        'Краснодарский край': { lat: 45.0355, lng: 38.9753 },
        'Краснодар': { lat: 45.0355, lng: 38.9753 },
        
        'Красноярский': { lat: 56.0184, lng: 92.8672 },
        'Красноярский край': { lat: 56.0184, lng: 92.8672 },
        
        'Ставропольский': { lat: 45.0433, lng: 41.9691 },
        'Ставропольский край': { lat: 45.0433, lng: 41.9691 },
        
        'Пермский': { lat: 58.0105, lng: 56.2502 },
        'Пермский край': { lat: 58.0105, lng: 56.2502 },
        
        // Области
        'Архангельская': { lat: 64.5393, lng: 40.5187 },
        'Архангельская обл.': { lat: 64.5393, lng: 40.5187 },
        
        'Астраханская': { lat: 46.3479, lng: 48.0336 },
        'Астраханская обл.': { lat: 46.3479, lng: 48.0336 },
        
        'Белгородская': { lat: 50.5952, lng: 36.5872 },
        'Белгородская обл.': { lat: 50.5952, lng: 36.5872 },
        
        'Брянская': { lat: 53.2434, lng: 34.3642 },
        'Брянская обл.': { lat: 53.2434, lng: 34.3642 },
        
        'Владимирская': { lat: 56.1290, lng: 40.4070 },
        'Владимирская обл.': { lat: 56.1290, lng: 40.4070 },
        
        'Волгоградская': { lat: 48.7080, lng: 44.5133 },
        'Волгоградская обл.': { lat: 48.7080, lng: 44.5133 },
        'Волгоградская об.': { lat: 48.7080, lng: 44.5133 },
        
        'Вологодская': { lat: 59.2181, lng: 39.8886 },
        'Вологодская обл.': { lat: 59.2181, lng: 39.8886 },
        
        'Воронежская': { lat: 51.6755, lng: 39.2089 },
        'Воронежская обл.': { lat: 51.6755, lng: 39.2089 },
        
        'Ивановская': { lat: 57.0004, lng: 40.9739 },
        'Ивановская обл.': { lat: 57.0004, lng: 40.9739 },
        
        'Иркутская': { lat: 52.2896, lng: 104.2806 },
        'Иркутская обл.': { lat: 52.2896, lng: 104.2806 },
        
        'Калужская': { lat: 54.5138, lng: 36.2612 },
        'Калужская обл.': { lat: 54.5138, lng: 36.2612 },
        
        'Кемеровская': { lat: 55.3547, lng: 86.0873 },
        'Кемеровская обл.': { lat: 55.3547, lng: 86.0873 },
        
        'Кировская': { lat: 58.6035, lng: 49.6680 },
        'Кировская обл.': { lat: 58.6035, lng: 49.6680 },
        'Кировская обл': { lat: 58.6035, lng: 49.6680 },
        
        'Костромская': { lat: 58.5500, lng: 43.6833 },
        'Костромская обл.': { lat: 58.5500, lng: 43.6833 },
        
        'Курганская': { lat: 55.4410, lng: 65.3411 },
        'Курганская обл.': { lat: 55.4410, lng: 65.3411 },
        
        'Курская': { lat: 51.7370, lng: 36.1874 },
        'Курская обл.': { lat: 51.7370, lng: 36.1874 },
        
        'Липецкая': { lat: 52.6088, lng: 39.5992 },
        'Липецкая обл.': { lat: 52.6088, lng: 39.5992 },
        
        'Мурманская': { lat: 68.9585, lng: 33.0827 },
        'Мурманская облас.': { lat: 68.9585, lng: 33.0827 },
        
        'Нижегородская': { lat: 56.3269, lng: 44.0065 },
        'Нижегородская обл.': { lat: 56.3269, lng: 44.0065 },
        
        'Новгородская': { lat: 58.5228, lng: 31.2698 },
        'Новгородская обл.': { lat: 58.5228, lng: 31.2698 },
        
        'Новосибирская': { lat: 55.0084, lng: 82.9357 },
        'Новосибирская обл.': { lat: 55.0084, lng: 82.9357 },
        'Новосибирск': { lat: 55.0084, lng: 82.9357 },
        
        'Омская': { lat: 54.9914, lng: 73.3715 },
        'Омская обл.': { lat: 54.9914, lng: 73.3715 },
        
        'Оренбургская': { lat: 51.7682, lng: 55.0974 },
        'Оренбургская обл.': { lat: 51.7682, lng: 55.0974 },
        
        'Орловская': { lat: 52.9671, lng: 36.0696 },
        'Орловская обл.': { lat: 52.9671, lng: 36.0696 },
        
        'Пензенская': { lat: 53.2007, lng: 45.0046 },
        'Пензенская обл.': { lat: 53.2007, lng: 45.0046 },
        
        'Псковская': { lat: 57.8194, lng: 28.3318 },
        'Псковская обл.': { lat: 57.8194, lng: 28.3318 },
        
        'Ростовская': { lat: 47.2224, lng: 39.7189 },
        'Ростовская обл.': { lat: 47.2224, lng: 39.7189 },
        
        'Рязанская': { lat: 54.6269, lng: 39.6916 },
        'Рязанская обл.': { lat: 54.6269, lng: 39.6916 },
        
        'Самарская': { lat: 53.1959, lng: 50.1002 },
        'Самарская обл.': { lat: 53.1959, lng: 50.1002 },
        
        'Свердловская': { lat: 56.8389, lng: 60.6057 },
        'Свердловская обл.': { lat: 56.8389, lng: 60.6057 },
        
        'Смоленская': { lat: 54.7826, lng: 32.0453 },
        'Смоленская обл.': { lat: 54.7826, lng: 32.0453 },
        
        'Тамбовская': { lat: 52.7212, lng: 41.4523 },
        'Тамбовская обл.': { lat: 52.7212, lng: 41.4523 },
        'Тамбовская область': { lat: 52.7212, lng: 41.4523 },
        
        'Тверская': { lat: 56.8587, lng: 35.9176 },
        'Тверская обл.': { lat: 56.8587, lng: 35.9176 },
        'Тверская обл': { lat: 56.8587, lng: 35.9176 },
        
        'Томская': { lat: 56.4846, lng: 84.9476 },
        'Томская обл.': { lat: 56.4846, lng: 84.9476 },
        
        'Тульская': { lat: 54.1920, lng: 37.6173 },
        'Тульская обл.': { lat: 54.1920, lng: 37.6173 },
        
        'Тюменская': { lat: 57.1530, lng: 65.5343 },
        'Тюменская обл.': { lat: 57.1530, lng: 65.5343 },
        
        'Ульяновская': { lat: 54.3142, lng: 48.4031 },
        'Ульяновская обл.': { lat: 54.3142, lng: 48.4031 },
        
        'Челябинская': { lat: 55.1644, lng: 61.4368 },
        'Челябинская обл.': { lat: 55.1644, lng: 61.4368 },
        
        'Ярославская': { lat: 57.6261, lng: 39.8845 },
        'Ярославская обл.': { lat: 57.6261, lng: 39.8845 },
        
        // Республики
        'Татарстан': { lat: 55.7961, lng: 49.1064 },
        'Респ. Татарстан': { lat: 55.7961, lng: 49.1064 },
        
        'Башкортостан': { lat: 54.7351, lng: 55.9587 },
        'Респ. Башкортостан': { lat: 54.7351, lng: 55.9587 },
        
        'Удмуртская': { lat: 57.0670, lng: 53.0270 },
        'Удмуртская респ.': { lat: 57.0670, lng: 53.0270 },
        
        'Чувашская': { lat: 56.1439, lng: 47.2489 },
        'Чувашская респ.': { lat: 56.1439, lng: 47.2489 },
        
        'Марий Эл': { lat: 56.6380, lng: 47.8951 },
        'Респ. Марий Эл': { lat: 56.6380, lng: 47.8951 },
        
        'Мордовия': { lat: 54.1874, lng: 45.1839 },
        'Респ. Мордовия': { lat: 54.1874, lng: 45.1839 },
        
        'Адыгея': { lat: 44.6098, lng: 40.1006 },
        'Респ. Адыгея': { lat: 44.6098, lng: 40.1006 },
        
        'Дагестан': { lat: 42.9849, lng: 47.5047 },
        'Респ. Дагестан': { lat: 42.9849, lng: 47.5047 },
        
        'Кабардино-Балкар': { lat: 43.4847, lng: 43.6071 },
        'Кабардино-Балкарская': { lat: 43.4847, lng: 43.6071 },
        'Кабардино-Балкар.': { lat: 43.4847, lng: 43.6071 },
        
        'Калмыкия': { lat: 46.3079, lng: 44.2700 },
        'Калмыкия респ.': { lat: 46.3079, lng: 44.2700 },
        'Республика Калмыкия': { lat: 46.3079, lng: 44.2700 },
        
        'Карачаево-Черкесская': { lat: 43.9159, lng: 41.7740 },
        'Карачаево-Черкесская Республика': { lat: 43.9159, lng: 41.7740 },
        
        'Карелия': { lat: 61.7850, lng: 34.3468 },
        
        'Коми': { lat: 61.6688, lng: 50.8354 },
        'Коми респ.': { lat: 61.6688, lng: 50.8354 },
        
        'Северная Осетия': { lat: 43.0241, lng: 44.6814 },
        
        'Хакасия': { lat: 53.7224, lng: 91.4435 },
        'Хакассия': { lat: 53.7224, lng: 91.4435 },
        
        // Автономные округа
        'ХМАО': { lat: 61.0032, lng: 69.0189 },
        
        'ЯНАО': { lat: 66.5299, lng: 66.6136 },
        
        // Города
        'Сочи': { lat: 43.5855, lng: 39.7231 },
        
        // По умолчанию - центр России
        'default': { lat: 55.7558, lng: 37.6173 }
    };
    
    let baseLat = 55.7558;
    let baseLng = 37.6173;
    let radius = 0.3;
    
    if (region) {
        const regionStr = region.toString().trim().toLowerCase();
        
        for (const [key, coords] of Object.entries(regionCenters)) {
            if (regionStr.includes(key.toLowerCase()) || key.toLowerCase().includes(regionStr)) {
                baseLat = coords.lat;
                baseLng = coords.lng;
                radius = 0.5; // Увеличиваем радиус для регионов
                break;
            }
        }
    }
    
    const randomLat = baseLat + (Math.random() - 0.5) * radius * 2;
    const randomLng = baseLng + (Math.random() - 0.5) * radius * 3;
    
    return {
        lat: randomLat,
        lng: randomLng,
        source: 'approximate',
        isExact: false,
        isMock: true,
        region: region
    };
}

// ========== ЭКСПОРТ ФУНКЦИЙ ==========

window.loadData = loadData;
window.clearFilters = clearFilters;
window.applyFilters = applyFilters;
window.searchPoints = searchPoints;
window.closeModal = closeModal;
window.filterPoints = filterPoints;
window.centerMapOnFilteredPoints = centerMapOnFilteredPoints;
window.updateLegend = updateLegend;
window.updateFilterCounts = updateFilterCounts;
window.updateLegendFromApp = updateLegend;
window.loadAvailableSheets = loadAvailableSheets;
window.getSelectedSheets = getSelectedSheets;
window.selectAllSheets = selectAllSheets;

// Инициализация дополнительных обработчиков
setTimeout(() => {
    // Добавляем стили для анимации пульсации
    const style = document.createElement('style');
    style.textContent = `
        @keyframes pulse {
            0% { transform: scale(1); box-shadow: 0 3px 8px rgba(0,0,0,0.3); }
            50% { transform: scale(1.1); box-shadow: 0 5px 15px rgba(0,0,0,0.4); }
            100% { transform: scale(1); box-shadow: 0 3px 8px rgba(0,0,0,0.3); }
        }
        
        .custom-marker:hover {
            animation: pulse 0.5s infinite;
            transform: scale(1.1);
            z-index: 1000 !important;
        }
        
        .legend-item:hover {
            transform: translateX(5px);
            box-shadow: 0 3px 8px rgba(0,0,0,0.1);
            background: rgba(255,255,255,0.25) !important;
        }
        
        .adts-popup .leaflet-popup-content-wrapper {
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        }
        
        .adts-popup .leaflet-popup-tip {
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .loading-spinner {
            border: 3px solid rgba(255,255,255,0.1);
            border-radius: 50%;
            border-top: 3px solid #3498db;
            width: 30px;
            height: 30px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);
    
    console.log('ADTS Карта с поддержкой листов успешно инициализирована');
    
    // Добавляем тултипы для элементов интерфейса
    if (CONFIG.UI.enableTooltips) {
        const tooltipElements = document.querySelectorAll('[title]');
        tooltipElements.forEach(el => {
            el.setAttribute('data-tooltip', el.getAttribute('title'));
        });
    }
}, 1000);
