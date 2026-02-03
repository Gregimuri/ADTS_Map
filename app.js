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

// Цветовая схема статусов ADTS (можно расширить)
const ADTS_STATUS_COLORS = {
    // Основные статусы
    'Выполнен': '#2ecc71',
    'Выполнено': '#2ecc71',
    'Завершен': '#2ecc71',
    'Сдан': '#2ecc71',
    'Готов': '#2ecc71',
    
    'Нет оборудования': '#e74c3c',
    'Нет оборудывания': '#e74c3c',
    'Оборудования нет': '#e74c3c',
    'Ожидание оборудования': '#e74c3c',
    
    'В очереди': '#3498db',
    'Очередь': '#3498db',
    'В работе': '#3498db',
    'План': '#3498db',
    'Запланирован': '#3498db',
    
    'Первичный': '#f1c40f',
    'Первичный монтаж': '#f1c40f',
    'Начальный': '#f1c40f',
    'Подготовка': '#f1c40f',
    
    'Финальный': '#9b59b6',
    'Финальный монтаж': '#9b59b6',
    'Завершение': '#9b59b6',
    'Окончательный': '#9b59b6',
    
    'Доработка': '#95a5a6',
    'Доработка после монтажа': '#95a5a6',
    'Реконструкция': '#95a5a6',
    'Переделка': '#95a5a6',
    'Ремонт': '#95a5a6'
};

// Статистика по листам
let sheetsStatistics = {};

// ========== ИНИЦИАЛИЗАЦИЯ ==========

function initApp() {
    console.log('🚀 Инициализация приложения ADTS...');
    initMap();
    setupEventListeners();
    loadAvailableSheets();
    setupAutoUpdate();
    startUpdateTimer();
    
    // Показываем информацию о конфигурации
    showConfigInfo();
}

function showConfigInfo() {
    console.log('ℹ️ Конфигурация:');
    console.log('- ID таблицы:', CONFIG.SPREADSHEET_ID);
    console.log('- Поддержка листов:', CONFIG.SHEETS.enabled);
    console.log('- Исключаемые листы:', CONFIG.SHEETS.excludedSheets);
}

function setupEventListeners() {
    // Поиск
    document.getElementById('search')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchPoints();
    });
    
    document.getElementById('search-sidebar')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchPointsSidebar();
    });
    
    // Фильтры
    ['filter-sheets', 'filter-project', 'filter-region', 'filter-status', 'filter-manager'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => {
            updateFilterCounts();
            updateLegend();
        });
    });
}

document.addEventListener('DOMContentLoaded', initApp);

// ========== КАРТА ==========

function initMap() {
    console.log('🗺️ Инициализация карты...');
    
    try {
        map = L.map('map').setView(CONFIG.MAP.center, CONFIG.MAP.zoom);
        
        L.tileLayer(CONFIG.MAP.tileLayer, {
            attribution: CONFIG.MAP.attribution,
            maxZoom: CONFIG.MAP.maxZoom,
            minZoom: CONFIG.MAP.minZoom
        }).addTo(map);
        
        markerCluster = L.markerClusterGroup({
            maxClusterRadius: CONFIG.MARKERS.clusterRadius,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: true,
            zoomToBoundsOnClick: true
        }).addTo(map);
        
        console.log('✅ Карта инициализирована');
        
    } catch (error) {
        console.error('❌ Ошибка инициализации карты:', error);
        showNotification('Ошибка загрузки карты', 'error');
    }
}

// ========== УТИЛИТЫ ==========

function updateStatus(message, type = 'success') {
    const statusElement = document.getElementById('status');
    if (!statusElement) return;
    
    let icon = 'circle';
    let color = '#2ecc71';
    
    switch(type) {
        case 'error': icon = 'exclamation-circle'; color = '#e74c3c'; break;
        case 'warning': icon = 'exclamation-triangle'; color = '#f39c12'; break;
        case 'loading': icon = 'sync-alt fa-spin'; color = '#3498db'; break;
    }
    
    statusElement.innerHTML = `<i class="fas fa-${icon}" style="color: ${color};"></i> ${message}`;
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
    if (modal) modal.style.display = 'none';
}

function showNotification(message, type = 'info', duration = 5000) {
    // Удаляем старые уведомления
    document.querySelectorAll('.notification').forEach(el => el.remove());
    
    const notification = document.createElement('div');
    notification.className = 'notification';
    
    let icon = 'info-circle';
    let bgColor = '#3498db';
    
    switch(type) {
        case 'success': icon = 'check-circle'; bgColor = '#2ecc71'; break;
        case 'error': icon = 'exclamation-circle'; bgColor = '#e74c3c'; break;
        case 'warning': icon = 'exclamation-triangle'; bgColor = '#f39c12'; break;
    }
    
    notification.innerHTML = `
        <div style="background: ${bgColor}; color: white; border-radius: 8px; padding: 15px 20px; display: flex; align-items: center; gap: 10px;">
            <i class="fas fa-${icon}" style="font-size: 18px;"></i>
            <span style="flex: 1; font-size: 14px;">${message}</span>
            <button onclick="this.parentElement.parentElement.remove()" 
                    style="background: none; border: none; color: white; cursor: pointer;">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    if (duration > 0) {
        setTimeout(() => notification.remove(), duration);
    }
}

// ========== ТАЙМЕРЫ ==========

function startUpdateTimer() {
    if (updateTimerInterval) clearInterval(updateTimerInterval);
    
    updateTimerInterval = setInterval(() => {
        const timerElement = document.getElementById('update-timer');
        if (!timerElement || !lastUpdateTime) return;
        
        const diff = Math.floor((new Date() - lastUpdateTime) / 1000);
        const minutes = Math.floor(diff / 60);
        const seconds = diff % 60;
        
        if (minutes > 0) {
            timerElement.textContent = `${minutes} мин ${seconds} сек назад`;
        } else {
            timerElement.textContent = `${seconds} сек назад`;
        }
    }, 1000);
}

function updateLastUpdateTime() {
    lastUpdateTime = new Date();
    const timeElement = document.getElementById('last-update');
    if (timeElement) {
        const now = new Date();
        timeElement.textContent = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    }
}

// ========== СТАТУСЫ ==========

function normalizeADTSStatus(status) {
    if (!status) return 'Не указан';
    
    const statusLower = status.toLowerCase().trim();
    
    // Приоритетный порядок проверки
    if (statusLower.includes('выполнен') || statusLower.includes('сдан') || statusLower.includes('готов') || statusLower.includes('завершен')) 
        return 'Выполнен';
    if (statusLower.includes('нет оборуд') || statusLower.includes('оборудования нет') || statusLower.includes('ожидание')) 
        return 'Нет оборудования';
    if (statusLower.includes('очеред') || statusLower.includes('в работе') || statusLower.includes('план') || statusLower.includes('запланирован')) 
        return 'В очереди';
    if (statusLower.includes('первичн') || statusLower.includes('начальн') || statusLower.includes('подготовк')) 
        return 'Первичный';
    if (statusLower.includes('финальн') || statusLower.includes('завершен') || statusLower.includes('окончат')) 
        return 'Финальный';
    if (statusLower.includes('доработк') || statusLower.includes('реконструкц') || statusLower.includes('передел') || statusLower.includes('ремонт')) 
        return 'Доработка';
    
    // Если не распознали, возвращаем оригинал
    return status;
}

function getStatusIcon(status) {
    const normalized = normalizeADTSStatus(status);
    
    switch(normalized) {
        case 'Выполнен': return '<i class="fas fa-check-circle"></i>';
        case 'Нет оборудования': return '<i class="fas fa-times-circle"></i>';
        case 'В очереди': return '<i class="fas fa-clock"></i>';
        case 'Первичный': return '<i class="fas fa-hammer"></i>';
        case 'Финальный': return '<i class="fas fa-check-double"></i>';
        case 'Доработка': return '<i class="fas fa-tools"></i>';
        default: return '<i class="fas fa-map-marker-alt"></i>';
    }
}

function getStatusColor(status) {
    const normalized = normalizeADTSStatus(status);
    return ADTS_STATUS_COLORS[normalized] || ADTS_STATUS_COLORS[normalized + ' монтаж'] || '#95a5a6';
}

// ========== РАБОТА С ЛИСТАМИ ==========

async function loadAvailableSheets() {
    if (!CONFIG.SHEETS.enabled) {
        console.log('Поддержка листов отключена');
        loadData();
        return;
    }
    
    // Проверяем кэш
    const now = new Date();
    if (sheetsInfoCache && lastSheetsFetchTime && 
        (now - lastSheetsFetchTime) < CONFIG.SHEETS.cacheDuration) {
        console.log('Использую кэшированные листы');
        availableSheets = sheetsInfoCache;
        updateSheetsFilter(availableSheets);
        return;
    }
    
    try {
        console.log('📋 Загружаю информацию о листах...');
        updateStatus('Получение списка листов...', 'loading');
        
        const url = `https://spreadsheets.google.com/feeds/worksheets/${CONFIG.SPREADSHEET_ID}/public/full?alt=json`;
        const response = await fetch(url);
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const data = await response.json();
        const sheets = data.feed.entry || [];
        
        console.log(`📄 Всего листов в таблице: ${sheets.length}`);
        
        // Обрабатываем листы
        availableSheets = sheets
            .map(sheet => ({
                id: sheet.id.$t.split('/').pop(),
                title: sheet.title.$t,
                gid: sheet.id.$t.split('/').pop()
            }))
            .filter(sheet => {
                const lowerTitle = sheet.title.toLowerCase();
                const excluded = CONFIG.SHEETS.excludedSheets || [];
                
                // Исключаем системные листы
                const shouldExclude = excluded.some(excludedName => 
                    lowerTitle.includes(excludedName.toLowerCase())
                );
                
                // Включаем только если не исключен
                return !shouldExclude;
            });
        
        // Если указаны конкретные листы для включения
        if (CONFIG.SHEETS.includedSheets.length > 0) {
            availableSheets = availableSheets.filter(sheet =>
                CONFIG.SHEETS.includedSheets.includes(sheet.title)
            );
        }
        
        console.log(`✅ Подходящих листов: ${availableSheets.length}`);
        console.log('📋 Список листов:', availableSheets.map(s => s.title));
        
        if (availableSheets.length === 0) {
            console.warn('Не найдено подходящих листов');
            if (sheets.length > 0) {
                // Берем первый неисключенный лист
                const firstSheet = sheets[0];
                availableSheets = [{
                    id: firstSheet.id.$t.split('/').pop(),
                    title: firstSheet.title.$t,
                    gid: firstSheet.id.$t.split('/').pop()
                }];
                console.log('🔄 Использую первый лист:', firstSheet.title.$t);
            }
        }
        
        // Кэшируем
        sheetsInfoCache = availableSheets;
        lastSheetsFetchTime = now;
        
        // Обновляем интерфейс
        updateSheetsFilter(availableSheets);
        
        if (availableSheets.length > 0) {
            // Автоматически выбираем все листы
            selectAllSheets();
            // Загружаем данные
            loadData();
        } else {
            showDemoData();
        }
        
        updateStatus(`Найдено ${availableSheets.length} листов`, 'success');
        
    } catch (error) {
        console.error('❌ Ошибка загрузки листов:', error);
        updateStatus('Ошибка загрузки листов', 'error');
        showNotification('Не удалось получить список листов. Проверьте ID таблицы.', 'error');
        
        // Показываем демо-данные с пояснением
        setTimeout(() => {
            showDemoData();
            showNotification('Используются демо-данные. Проверьте настройки.', 'warning');
        }, 1000);
    }
}

function updateSheetsFilter(sheets) {
    const sheetSelect = document.getElementById('filter-sheets');
    if (!sheetSelect) return;
    
    // Сохраняем текущий выбор
    const selectedValues = getSelectedSheets();
    
    // Очищаем и добавляем опции
    sheetSelect.innerHTML = '<option value="">Все листы</option>';
    
    sheets.forEach(sheet => {
        const option = document.createElement('option');
        option.value = sheet.title;
        option.textContent = sheet.title;
        
        // Если ранее был выбран или это первый запуск
        if (selectedValues.includes(sheet.title) || (selectedValues.length === 0 && sheets.length === 1)) {
            option.selected = true;
        }
        
        sheetSelect.appendChild(option);
    });
    
    // Обновляем счетчик
    updateFilterCounts();
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
    if (!sheetSelect) return;
    
    Array.from(sheetSelect.options).forEach(option => {
        if (option.value !== '') {
            option.selected = true;
        }
    });
    
    activeFilters.sheets = availableSheets.map(s => s.title);
    console.log('✅ Выбраны все листы');
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
        console.log('📥 Начинаю загрузку данных...');
        updateStatus('Загрузка данных...', 'loading');
        showModal('Загрузка', '<div style="text-align: center;"><div class="loader"></div><p>Подключение к Google Таблице...</p><p style="font-size: 12px; color: #95a5a6;">Пожалуйста, подождите</p></div>');
        
        let allData = [];
        sheetsStatistics = {}; // Сбрасываем статистику
        
        if (CONFIG.SHEETS.enabled && availableSheets.length > 0) {
            const selectedSheets = getSelectedSheets();
            const sheetsToLoad = selectedSheets.length > 0 ? selectedSheets : availableSheets.map(s => s.title);
            
            console.log(`📊 Загружаю данные с ${sheetsToLoad.length} листов`);
            
            for (const sheetName of sheetsToLoad) {
                try {
                    console.log(`📖 Обрабатываю лист: "${sheetName}"`);
                    
                    // Проверяем кэш
                    if (sheetPointsCache.has(sheetName)) {
                        const cachedPoints = sheetPointsCache.get(sheetName);
                        console.log(`⚡ Использую кэш для "${sheetName}": ${cachedPoints.length} точек`);
                        allData = allData.concat(cachedPoints);
                        continue;
                    }
                    
                    // Загружаем данные с листа
                    const sheetData = await loadSheetData(sheetName);
                    
                    if (!sheetData || sheetData.length === 0) {
                        console.warn(`⚠️ Лист "${sheetName}" пуст или не содержит данных`);
                        continue;
                    }
                    
                    console.log(`📝 Лист "${sheetName}": ${sheetData.length} строк`);
                    
                    // Обрабатываем данные
                    const processedPoints = processData(sheetData, sheetName);
                    console.log(`✅ Лист "${sheetName}" обработан: ${processedPoints.length} точек`);
                    
                    // Добавляем координаты
                    const pointsWithCoords = await addCoordinatesFast(processedPoints);
                    
                    // Сохраняем в кэш
                    sheetPointsCache.set(sheetName, pointsWithCoords);
                    
                    // Сохраняем статистику по листу
                    sheetsStatistics[sheetName] = {
                        total: pointsWithCoords.length,
                        withCoords: pointsWithCoords.filter(p => p.lat && p.lng).length,
                        statuses: {}
                    };
                    
                    // Собираем статистику по статусам
                    pointsWithCoords.forEach(point => {
                        const status = normalizeADTSStatus(point.status);
                        if (!sheetsStatistics[sheetName].statuses[status]) {
                            sheetsStatistics[sheetName].statuses[status] = 0;
                        }
                        sheetsStatistics[sheetName].statuses[status]++;
                    });
                    
                    allData = allData.concat(pointsWithCoords);
                    
                } catch (sheetError) {
                    console.error(`❌ Ошибка обработки листа "${sheetName}":`, sheetError);
                    showNotification(`Ошибка загрузки листа "${sheetName}"`, 'warning');
                }
            }
        } else {
            // Загрузка с одного листа (для обратной совместимости)
            console.log('📥 Загружаю данные с основного листа...');
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
        
        console.log(`🎉 Всего загружено: ${allData.length} точек`);
        
        // Логируем статистику по листам
        console.group('📊 Статистика по листам:');
        Object.keys(sheetsStatistics).forEach(sheetName => {
            const stats = sheetsStatistics[sheetName];
            console.log(`• ${sheetName}: ${stats.total} точек`);
        });
        console.groupEnd();
        
        // Обновляем данные
        allPoints = allData;
        
        // Обновляем интерфейс
        updateFilters();
        updateStatistics();
        updateStatusStatistics();
        updateLegend();
        updateLastUpdateTime();
        showPointsOnMap();
        
        // Закрываем модальное окно
        setTimeout(() => {
            closeModal();
            updateStatus(`Загружено: ${allData.length} точек`, 'success');
            showNotification(`Данные успешно загружены: ${allData.length} точек с ${Object.keys(sheetsStatistics).length} листов`, 'success', 3000);
        }, 500);
        
    } catch (error) {
        console.error('❌ Критическая ошибка загрузки:', error);
        updateStatus('Ошибка загрузки', 'error');
        
        setTimeout(() => {
            closeModal();
            
            if (allPoints.length === 0) {
                showNotification('Не удалось загрузить данные. Показываю демо-данные.', 'error');
                showDemoData();
            } else {
                showNotification('Ошибка обновления данных. Используются предыдущие данные.', 'warning');
            }
        }, 1000);
        
    } finally {
        isLoading = false;
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Обновить данные';
        }
    }
}

async function loadSheetData(sheetName) {
    // Пробуем разные форматы URL
    const urls = [
        `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`,
        `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/export?format=csv&sheet=${encodeURIComponent(sheetName)}`,
        `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(sheetName)}`
    ];
    
    for (const url of urls) {
        try {
            console.log(`🔗 Пробую URL: ${url}`);
            const response = await fetch(url);
            
            if (response.ok) {
                const csvText = await response.text();
                console.log(`✅ Успешно загружено с ${url}`);
                return parseCSV(csvText);
            }
        } catch (error) {
            console.log(`❌ Не удалось загрузить с ${url}:`, error.message);
            continue;
        }
    }
    
    throw new Error(`Не удалось загрузить данные листа "${sheetName}"`);
}

async function loadDataAsCSV() {
    const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/export?format=csv`;
    
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
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
        if (lines.length === 0) return [];
        
        const result = [];
        
        for (const line of lines) {
            const row = [];
            let current = '';
            let inQuotes = false;
            
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                
                if (char === '"') {
                    if (inQuotes && line[i + 1] === '"') {
                        current += '"';
                        i++;
                    } else {
                        inQuotes = !inQuotes;
                    }
                } else if (char === ',' && !inQuotes) {
                    row.push(current);
                    current = '';
                } else {
                    current += char;
                }
            }
            
            row.push(current);
            
            // Очищаем кавычки
            const cleanedRow = row.map(cell => {
                let cleaned = cell.trim();
                if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
                    cleaned = cleaned.slice(1, -1);
                }
                cleaned = cleaned.replace(/""/g, '"');
                return cleaned;
            });
            
            result.push(cleanedRow);
        }
        
        return result;
    } catch (error) {
        console.error('Ошибка парсинга CSV:', error);
        return [];
    }
}

// ========== ОБРАБОТКА ДАННЫХ ==========

function processData(rows, sheetName = '') {
    if (!rows || rows.length < 2) return [];
    
    const points = [];
    const headers = rows[0].map(h => h.toString().trim());
    
    // Определяем индексы столбцов
    const columnIndices = detectColumnIndices(headers);
    
    console.log(`🔍 Обнаружены столбцы для листа "${sheetName}":`, columnIndices);
    
    // Обрабатываем строки
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0) continue;
        
        const point = createPoint(row, columnIndices, sheetName, i);
        
        if (point && point.name) {
            points.push(point);
        }
    }
    
    return points;
}

function detectColumnIndices(headers) {
    const indices = {};
    const headersLower = headers.map(h => h.toLowerCase().trim());
    
    // Для каждого типа столбца проверяем все возможные названия
    const columnTypes = {
        name: getColumnNames('name'),
        region: getColumnNames('region'),
        address: getColumnNames('address'),
        status: getColumnNames('status'),
        manager: getColumnNames('manager'),
        contractor: getColumnNames('contractor'),
        project: getColumnNames('project')
    };
    
    Object.keys(columnTypes).forEach(type => {
        indices[type] = -1;
        
        for (const possibleName of columnTypes[type]) {
            const index = headersLower.findIndex(h => 
                h.includes(possibleName.toLowerCase()) || 
                possibleName.toLowerCase().includes(h)
            );
            
            if (index !== -1) {
                indices[type] = index;
                console.log(`✓ Столбец "${type}" найден как "${headers[index]}" (индекс ${index})`);
                break;
            }
        }
    });
    
    // Если не нашли столбец, пробуем определить по позиции
    if (indices.name === -1 && headers.length > 0) indices.name = 0;
    if (indices.address === -1 && headers.length > 1) indices.address = 1;
    if (indices.status === -1 && headers.length > 2) indices.status = 2;
    if (indices.region === -1 && headers.length > 3) indices.region = 3;
    
    return indices;
}

function createPoint(row, indices, sheetName, rowIndex) {
    const getValue = (type) => {
        const index = indices[type];
        return (index !== -1 && index < row.length) ? cleanString(row[index]) : '';
    };
    
    const point = {
        id: `point_${sheetName}_${rowIndex}_${Date.now()}`,
        sheetRow: rowIndex + 1,
        sheet: sheetName,
        name: getValue('name'),
        region: getValue('region'),
        address: getValue('address'),
        status: getValue('status'),
        manager: getValue('manager'),
        contractor: getValue('contractor'),
        project: getValue('project'),
        dateAdded: new Date().toISOString().split('T')[0]
    };
    
    // Нормализуем статус
    if (point.status) {
        point.originalStatus = point.status;
        point.status = normalizeADTSStatus(point.status);
    }
    
    // Если project не указан, используем название листа
    if (!point.project || point.project.trim() === '') {
        point.project = sheetName;
    }
    
    // Генерируем название если его нет
    if (!point.name || point.name.trim() === '') {
        if (point.address) {
            point.name = point.address.split(',')[0].trim().substring(0, 50);
        } else if (point.region) {
            point.name = `${point.region} - Точка ${rowIndex}`;
        } else {
            point.name = `Точка ${rowIndex} (${sheetName})`;
        }
    }
    
    return point;
}

function cleanString(str) {
    if (!str) return '';
    return str.toString()
        .replace(/["']/g, '')
        .replace(/[\r\n]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function addCoordinatesFast(points) {
    return points.map(point => {
        if (!point.lat || !point.lng) {
            const coords = getRandomCoordinate(point.address, point.region, point.sheet);
            return {
                ...point,
                lat: coords.lat,
                lng: coords.lng,
                isMock: true,
                accuracy: 'approximate'
            };
        }
        return { ...point, isMock: false, accuracy: 'exact' };
    });
}

// ========== ОТОБРАЖЕНИЕ ТОЧЕК ==========

function showPointsOnMap() {
    markerCluster.clearLayers();
    markersMap.clear();
    
    const filteredPoints = filterPoints();
    console.log(`📍 Показываю ${filteredPoints.length} точек на карте`);
    
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
    
    // Центрируем карту
    if (filteredPoints.length > 0) {
        setTimeout(() => centerMapOnFilteredPoints(), 100);
    }
}

function createMarker(point) {
    const status = normalizeADTSStatus(point.status);
    const color = getStatusColor(status);
    const iconHtml = getStatusIcon(status);
    
    const icon = L.divIcon({
        html: `
            <div style="position: relative;">
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
                    font-size: 14px;
                    cursor: pointer;
                ">
                    ${iconHtml}
                </div>
                ${point.isMock ? '<div style="position: absolute; top: -5px; right: -5px; width: 10px; height: 10px; background: #f39c12; border-radius: 50%; border: 2px solid white;"></div>' : ''}
            </div>
        `,
        className: 'adts-marker',
        iconSize: [CONFIG.MARKERS.defaultSize, CONFIG.MARKERS.defaultSize],
        iconAnchor: [CONFIG.MARKERS.defaultSize/2, CONFIG.MARKERS.defaultSize]
    });
    
    const marker = L.marker([point.lat, point.lng], { 
        icon: icon,
        title: `${point.name} - ${status}`
    });
    
    marker.bindPopup(createPopupContent(point), {
        maxWidth: CONFIG.MARKERS.popupMaxWidth
    });
    
    marker.on('click', () => showPointDetails(point));
    
    return marker;
}

function createPopupContent(point) {
    const status = normalizeADTSStatus(point.status);
    const color = getStatusColor(status);
    
    return `
        <div style="min-width: 250px; font-family: sans-serif;">
            <h4 style="margin: 0 0 10px 0; color: #2c3e50; border-bottom: 2px solid ${color}; padding-bottom: 5px;">
                ${point.name || 'Точка ADTS'}
            </h4>
            
            <div style="margin-bottom: 10px;">
                <div style="font-size: 12px; color: #7f8c8d;">Статус:</div>
                <div style="color: ${color}; font-weight: bold;">${status}</div>
            </div>
            
            ${point.address ? `
                <div style="margin-bottom: 10px;">
                    <div style="font-size: 12px; color: #7f8c8d;">Адрес:</div>
                    <div>${point.address}</div>
                </div>
            ` : ''}
            
            ${point.sheet ? `
                <div style="font-size: 11px; color: #3498db; margin-top: 10px;">
                    <i class="fas fa-file-alt"></i> Лист: ${point.sheet}
                </div>
            ` : ''}
            
            ${point.isMock ? `
                <div style="margin-top: 10px; padding: 5px; background: #f39c12; color: white; border-radius: 4px; font-size: 11px;">
                    <i class="fas fa-exclamation-triangle"></i> Приблизительные координаты
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
    
    // Сортируем и заполняем фильтры
    fillFilter('filter-project', Array.from(filters.projects).sort());
    fillFilter('filter-region', Array.from(filters.regions).sort());
    fillFilter('filter-status', Array.from(filters.statuses).sort());
    fillFilter('filter-manager', Array.from(filters.managers).sort());
    
    console.log('✅ Фильтры обновлены');
    console.log('- Проектов:', filters.projects.size);
    console.log('- Регионов:', filters.regions.size);
    console.log('- Статусов:', filters.statuses.size);
    console.log('- Менеджеров:', filters.managers.size);
    console.log('- Листов:', filters.sheets.size);
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
    console.log('🔍 Применяю фильтры...');
    
    activeFilters.projects = getSelectedValues('filter-project');
    activeFilters.regions = getSelectedValues('filter-region');
    activeFilters.statuses = getSelectedValues('filter-status');
    activeFilters.managers = getSelectedValues('filter-manager');
    activeFilters.sheets = getSelectedValues('filter-sheets');
    
    console.log('Активные фильтры:', activeFilters);
    
    showPointsOnMap();
    showNotification('Фильтры применены', 'success');
}

function clearFilters() {
    console.log('🧹 Сбрасываю фильтры...');
    
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
        // Проверяем фильтр по листам
        if (activeFilters.sheets.length > 0 && !activeFilters.sheets.includes(point.sheet)) {
            return false;
        }
        
        // Проверяем фильтр по проектам
        if (activeFilters.projects.length > 0 && !activeFilters.projects.includes(point.project)) {
            return false;
        }
        
        // Проверяем фильтр по регионам
        if (activeFilters.regions.length > 0 && !activeFilters.regions.includes(point.region)) {
            return false;
        }
        
        // Проверяем фильтр по статусам
        if (activeFilters.statuses.length > 0) {
            const normalizedStatus = normalizeADTSStatus(point.status);
            if (!activeFilters.statuses.includes(normalizedStatus)) {
                return false;
            }
        }
        
        // Проверяем фильтр по менеджерам
        if (activeFilters.managers.length > 0 && !activeFilters.managers.includes(point.manager)) {
            return false;
        }
        
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
    
    console.log(`🔎 Поиск: "${query}"`);
    
    const results = allPoints.filter(point => {
        const searchFields = [
            point.name,
            point.address,
            point.region,
            point.manager,
            point.project,
            point.sheet,
            point.status
        ];
        
        return searchFields.some(field => 
            field && field.toLowerCase().includes(query)
        );
    });
    
    if (results.length === 0) {
        showNotification('Ничего не найдено', 'info');
        return;
    }
    
    // Показываем только найденные точки
    markerCluster.clearLayers();
    results.forEach(point => {
        if (point.lat && point.lng) {
            const marker = createMarker(point);
            markerCluster.addLayer(marker);
        }
    });
    
    // Центрируем карту на результатах
    if (results.length > 0) {
        const bounds = L.latLngBounds(
            results.filter(p => p.lat && p.lng).map(p => [p.lat, p.lng])
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
    
    if (searchInput && searchMapInput) {
        searchMapInput.value = searchInput.value;
        searchPoints();
    }
}

// ========== ИНФОРМАЦИЯ О ТОЧКЕ ==========

function showPointDetails(point) {
    const container = document.getElementById('point-details');
    const infoSection = document.getElementById('point-info');
    
    if (!container || !infoSection) return;
    
    const status = normalizeADTSStatus(point.status);
    const color = getStatusColor(status);
    
    container.innerHTML = `
        <div style="margin-bottom: 20px;">
            <h5 style="color: white; margin-bottom: 10px; font-size: 18px;">${point.name}</h5>
            <div style="background: ${color}; color: ${color === '#f1c40f' ? '#2c3e50' : 'white'}; padding: 8px 12px; border-radius: 6px; display: inline-flex; align-items: center; gap: 8px;">
                ${getStatusIcon(status)} ${status}
            </div>
        </div>
        
        <div style="background: rgba(255,255,255,0.1); padding: 15px; border-radius: 8px; margin-bottom: 20px;">
            ${point.address ? `
                <p style="margin-bottom: 12px;">
                    <strong style="color: #3498db;">Адрес:</strong><br>
                    <span style="font-size: 14px;">${point.address}</span>
                </p>
            ` : ''}
            
            ${point.region ? `
                <p style="margin-bottom: 12px;">
                    <strong style="color: #3498db;">Регион:</strong><br>
                    <span style="font-size: 14px;">${point.region}</span>
                </p>
            ` : ''}
            
            ${point.project ? `
                <p style="margin-bottom: 12px;">
                    <strong style="color: #3498db;">Проект:</strong><br>
                    <span style="font-size: 14px;">${point.project}</span>
                </p>
            ` : ''}
            
            ${point.sheet ? `
                <p style="margin-bottom: 12px;">
                    <strong style="color: #3498db;">Лист:</strong><br>
                    <span style="font-size: 14px; color: #3498db;">${point.sheet}</span>
                </p>
            ` : ''}
            
            ${point.manager ? `
                <p style="margin-bottom: 12px;">
                    <strong style="color: #3498db;">Менеджер:</strong><br>
                    <span style="font-size: 14px;">${point.manager}</span>
                </p>
            ` : ''}
        </div>
        
        ${point.isMock ? `
            <div style="margin-top: 20px; padding: 10px; background: #f39c12; color: white; border-radius: 6px; font-size: 13px;">
                <i class="fas fa-exclamation-triangle"></i> Приблизительные координаты
            </div>
        ` : ''}
    `;
    
    infoSection.style.display = 'block';
    infoSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ========== СТАТИСТИКА ==========

function updateStatistics() {
    const filteredPoints = filterPoints();
    const totalPoints = allPoints.length;
    const shownPoints = filteredPoints.length;
    
    document.getElementById('total-points').textContent = totalPoints;
    document.getElementById('shown-points').textContent = shownPoints;
    
    // Точные vs приблизительные координаты
    const exactPoints = filteredPoints.filter(p => !p.isMock).length;
    const approxPoints = filteredPoints.filter(p => p.isMock).length;
    document.getElementById('accuracy-stats').textContent = `${exactPoints}/${approxPoints}`;
    
    // Процент показанных точек
    const percentage = totalPoints > 0 ? Math.round((shownPoints / totalPoints) * 100) : 0;
    document.getElementById('shown-percentage').textContent = `${percentage}%`;
}

function updateStatusStatistics() {
    const filteredPoints = filterPoints();
    const statusCounts = {};
    
    filteredPoints.forEach(point => {
        const status = normalizeADTSStatus(point.status);
        statusCounts[status] = (statusCounts[status] || 0) + 1;
    });
    
    // Обновляем счетчики в легенде
    const statusElements = {
        'Выполнен': 'count-completed',
        'Нет оборудования': 'count-no-equipment',
        'В очереди': 'count-queue',
        'Первичный': 'count-primary',
        'Финальный': 'count-final',
        'Доработка': 'count-rework'
    };
    
    Object.keys(statusElements).forEach(status => {
        const element = document.getElementById(statusElements[status]);
        if (element) {
            element.textContent = statusCounts[status] || 0;
        }
    });
}

function updateFilterCounts() {
    const filters = [
        { id: 'filter-sheets', countId: 'sheets-count', label: 'листов' },
        { id: 'filter-project', countId: 'project-count', label: 'проектов' },
        { id: 'filter-region', countId: 'region-count', label: 'регионов' },
        { id: 'filter-status', countId: 'status-count', label: 'статусов' },
        { id: 'filter-manager', countId: 'manager-count', label: 'менеджеров' }
    ];
    
    filters.forEach(({ id, countId, label }) => {
        const select = document.getElementById(id);
        const countElement = document.getElementById(countId);
        
        if (select && countElement) {
            const selected = Array.from(select.selectedOptions).filter(opt => opt.value !== '').length;
            const total = select.options.length - 1;
            
            if (selected === 0) {
                countElement.textContent = `Все ${label} (${total})`;
            } else {
                countElement.textContent = `${selected} из ${total} ${label}`;
            }
        }
    });
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
        { name: 'Доработка', color: '#95a5a6', icon: 'tools' }
    ];
    
    const filteredPoints = filterPoints();
    
    let html = '<h5 style="color: #2c3e50; margin-bottom: 15px;"><i class="fas fa-palette"></i> Статусы ADTS</h5>';
    
    statuses.forEach(status => {
        const count = filteredPoints.filter(p => 
            normalizeADTSStatus(p.status) === status.name
        ).length;
        
        html += `
            <div class="legend-item" onclick="filterByStatus('${status.name}')">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="width: 16px; height: 16px; background: ${status.color}; border-radius: 50%; border: 2px solid white;"></div>
                    <span>${status.name}</span>
                </div>
                <span style="font-size: 12px; color: #7f8c8d;">${count}</span>
            </div>
        `;
    });
    
    // Общая статистика
    const totalFiltered = filteredPoints.length;
    const totalAll = allPoints.length;
    const percentage = totalAll > 0 ? Math.round((totalFiltered / totalAll) * 100) : 0;
    
    html += `
        <div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee; font-size: 12px;">
            <div style="display: flex; justify-content: space-between;">
                <span>Показано:</span>
                <span>${totalFiltered}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
                <span>Всего:</span>
                <span>${totalAll}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
                <span>Покрытие:</span>
                <span>${percentage}%</span>
            </div>
        </div>
    `;
    
    container.innerHTML = html;
}

// ========== ЦЕНТРИРОВАНИЕ КАРТЫ ==========

function centerMapOnFilteredPoints() {
    const filteredPoints = filterPoints();
    const pointsWithCoords = filteredPoints.filter(p => p.lat && p.lng);
    
    if (pointsWithCoords.length === 0) {
        showNotification('Нет точек для центрирования', 'warning');
        return;
    }
    
    if (pointsWithCoords.length === 1) {
        map.setView([pointsWithCoords[0].lat, pointsWithCoords[0].lng], 14);
    } else {
        const bounds = L.latLngBounds(pointsWithCoords.map(p => [p.lat, p.lng]));
        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50] });
        }
    }
}

// ========== АВТООБНОВЛЕНИЕ ==========

function setupAutoUpdate() {
    if (CONFIG.UPDATE.auto && CONFIG.UPDATE.interval > 0) {
        if (updateInterval) clearInterval(updateInterval);
        
        updateInterval = setInterval(() => {
            if (!isLoading) {
                console.log('🔄 Автоматическое обновление данных...');
                loadData();
            }
        }, CONFIG.UPDATE.interval);
        
        console.log(`⏰ Автообновление настроено: каждые ${CONFIG.UPDATE.interval/1000} секунд`);
    }
}

// ========== ДЕМО-ДАННЫЕ ==========

function showDemoData() {
    console.log('🔄 Показываю демо-данные...');
    
    allPoints = [
        {
            id: 'demo_1',
            name: 'Пример точки 1',
            region: 'Москва',
            address: 'ул. Примерная, 1',
            status: 'Выполнено',
            manager: 'Иванов И.И.',
            project: 'Демо проект',
            sheet: 'Москва',
            lat: 55.7558,
            lng: 37.6173,
            isMock: false
        },
        {
            id: 'demo_2',
            name: 'Пример точки 2',
            region: 'Санкт-Петербург',
            address: 'ул. Тестовая, 2',
            status: 'В очереди',
            manager: 'Петров П.П.',
            project: 'Демо проект',
            sheet: 'СПб',
            lat: 59.9343,
            lng: 30.3351,
            isMock: false
        }
    ];
    
    availableSheets = [
        { id: '1', title: 'Москва' },
        { id: '2', title: 'СПб' }
    ];
    
    updateSheetsFilter(availableSheets);
    updateFilters();
    updateStatistics();
    updateStatusStatistics();
    updateLegend();
    updateLastUpdateTime();
    showPointsOnMap();
    
    updateStatus('Демо-данные загружены', 'warning');
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

function getRandomCoordinate(address, region, sheetName) {
    // Базовая координата по умолчанию
    let baseLat = 55.7558;
    let baseLng = 37.6173;
    
    // Пытаемся определить регион
    if (region) {
        const regionLower = region.toLowerCase();
        
        // Москва и область
        if (regionLower.includes('москва')) {
            baseLat = 55.7558; baseLng = 37.6173;
        }
        // Санкт-Петербург
        else if (regionLower.includes('петербург') || regionLower.includes('спб')) {
            baseLat = 59.9343; baseLng = 30.3351;
        }
        // Другие крупные города
        else if (regionLower.includes('новосибирск')) {
            baseLat = 55.0084; baseLng = 82.9357;
        }
        else if (regionLower.includes('екатеринбург')) {
            baseLat = 56.8389; baseLng = 60.6057;
        }
        else if (regionLower.includes('казань')) {
            baseLat = 55.7961; baseLng = 49.1064;
        }
        else if (regionLower.includes('нижний')) {
            baseLat = 56.3269; baseLng = 44.0065;
        }
        else if (regionLower.includes('краснодар')) {
            baseLat = 45.0355; baseLng = 38.9753;
        }
    }
    
    // Добавляем случайное смещение
    const lat = baseLat + (Math.random() - 0.5) * 0.2;
    const lng = baseLng + (Math.random() - 0.5) * 0.4;
    
    return { lat, lng };
}

// ========== ГЛОБАЛЬНЫЕ ФУНКЦИИ ==========

window.loadData = loadData;
window.clearFilters = clearFilters;
window.applyFilters = applyFilters;
window.searchPoints = searchPoints;
window.searchPointsSidebar = searchPointsSidebar;
window.closeModal = closeModal;
window.centerMap = centerMapOnFilteredPoints;
window.centerMapOnFilteredPoints = centerMapOnFilteredPoints;
window.updateLegend = updateLegend;
window.updateFilterCounts = updateFilterCounts;
window.loadAvailableSheets = loadAvailableSheets;
window.getSelectedSheets = getSelectedSheets;
window.selectAllSheets = selectAllSheets;

// Функция для быстрого фильтра по статусу
window.filterByStatus = function(status) {
    const statusSelect = document.getElementById('filter-status');
    if (!statusSelect) return;
    
    // Сбрасываем все выборы
    Array.from(statusSelect.options).forEach(opt => opt.selected = false);
    
    // Выбираем нужный статус
    Array.from(statusSelect.options).forEach(opt => {
        if (opt.value === status) opt.selected = true;
    });
    
    applyFilters();
    showNotification(`Фильтр по статусу: ${status}`, 'success');
};

// Добавляем CSS для загрузчика
document.addEventListener('DOMContentLoaded', function() {
    const style = document.createElement('style');
    style.textContent = `
        .loader {
            border: 4px solid rgba(255,255,255,0.1);
            border-radius: 50%;
            border-top: 4px solid #3498db;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
        }
        
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        
        .custom-marker:hover {
            transform: scale(1.2);
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
            z-index: 1000;
        }
        
        .legend-item:hover {
            background: rgba(255,255,255,0.3) !important;
            transform: translateX(5px);
        }
    `;
    document.head.appendChild(style);
});
