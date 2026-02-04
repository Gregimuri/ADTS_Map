// ========== ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ==========
let map;
let markerCluster;
let allPoints = [];
let activeFilters = {
    projects: [],
    regions: [],
    statuses: [],
    managers: []
};

let updateInterval;
let markersMap = new Map();
let isLoading = false;
let lastUpdateTime = null;
let updateTimerInterval = null;

// Цветовая схема статусов ADTS - ОБНОВЛЕНО
const ADTS_STATUS_COLORS = {
    'Выполнен': '#2ecc71',      // Зеленый
    'Есть проблемы': '#e74c3c', // Красный
    'В очереди': '#3498db',     // Синий
    'Первичный': '#f1c40f',     // Желтый
    'Финальный': '#9b59b6',     // Фиолетовый
    'Доработка': '#95a5a6'      // Серый
};

// ========== ИНИЦИАЛИЗАЦИЯ ==========

function initApp() {
    console.log('Инициализация приложения ADTS...');
    initMap();
    setupEventListeners();
    loadData(); // Сразу загружаем данные
    setupAutoUpdate();
    startUpdateTimer();
}

function setupEventListeners() {
    // Поиск
    document.getElementById('search')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchPoints();
    });
    
    document.getElementById('search-sidebar')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchPointsSidebar();
    });
    
    // Кнопка поиска в сайдбаре
    const sidebarSearchBtn = document.querySelector('.search-sidebar button');
    if (sidebarSearchBtn) {
        sidebarSearchBtn.addEventListener('click', searchPointsSidebar);
    }
    
    // Фильтры
    ['filter-project', 'filter-region', 'filter-status', 'filter-manager'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => {
            updateFilterCounts();
            updateLegend();
        });
    });
}

document.addEventListener('DOMContentLoaded', initApp);

// ========== КАРТА ==========

function initMap() {
    console.log('Инициализация карты...');
    
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
        
        console.log('Карта инициализирована');
        
    } catch (error) {
        console.error('Ошибка инициализации карты:', error);
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
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, duration);
    }
}

// ========== ТАЙМЕРЫ ==========

function startUpdateTimer() {
    if (updateTimerInterval) {
        clearInterval(updateTimerInterval);
    }
    
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
    
    if (statusLower.includes('выполнен') || statusLower.includes('сдан') || statusLower.includes('готов') || statusLower.includes('завершен')) 
        return 'Выполнен';
    if (statusLower.includes('есть пробл') || statusLower.includes('проблем') || statusLower.includes('ошибк') || statusLower.includes('неисправность')) 
        return 'Есть проблемы';
    if (statusLower.includes('в очеред') || statusLower.includes('очеред') || statusLower.includes('в работе') || statusLower.includes('план') || statusLower.includes('запланирован')) 
        return 'В очереди';
    if (statusLower.includes('первичн') || statusLower.includes('начальн') || statusLower.includes('подготовк')) 
        return 'Первичный';
    if (statusLower.includes('финальн') || statusLower.includes('завершен') || statusLower.includes('окончат')) 
        return 'Финальный';
    if (statusLower.includes('доработк') || statusLower.includes('реконструкц') || statusLower.includes('передел') || statusLower.includes('ремонт')) 
        return 'Доработка';
    
    return status;
}

function getStatusIcon(status) {
    const normalized = normalizeADTSStatus(status);
    
    switch(normalized) {
        case 'Выполнен': return '<i class="fas fa-check-circle"></i>';
        case 'Есть проблемы': return '<i class="fas fa-exclamation-circle"></i>';
        case 'В очереди': return '<i class="fas fa-clock"></i>';
        case 'Первичный': return '<i class="fas fa-hammer"></i>';
        case 'Финальный': return '<i class="fas fa-check-double"></i>';
        case 'Доработка': return '<i class="fas fa-tools"></i>';
        default: return '<i class="fas fa-map-marker-alt"></i>';
    }
}

function getStatusColor(status) {
    const normalized = normalizeADTSStatus(status);
    return ADTS_STATUS_COLORS[normalized] || '#95a5a6';
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
        console.log('Начинаю загрузку данных...');
        updateStatus('Загрузка данных...', 'loading');
        
        let allData = [];
        
        // Загружаем данные со всех указанных листов
        for (const sheetName of CONFIG.SHEETS_TO_LOAD) {
            try {
                console.log(`Загружаю лист: "${sheetName}"`);
                
                const sheetData = await loadSheetData(sheetName);
                
                if (!sheetData || sheetData.length === 0) {
                    console.warn(`Лист "${sheetName}" пуст или не содержит данных`);
                    continue;
                }
                
                console.log(`Лист "${sheetName}": ${sheetData.length} строк`);
                
                const processedPoints = processData(sheetData, sheetName);
                console.log(`Лист "${sheetName}" обработан: ${processedPoints.length} точек`);
                
                const pointsWithCoords = await addCoordinatesFast(processedPoints);
                allData = allData.concat(pointsWithCoords);
                
            } catch (sheetError) {
                console.error(`Ошибка обработки листа "${sheetName}":`, sheetError);
                showNotification(`Ошибка загрузки листа "${sheetName}"`, 'warning');
            }
        }
        
        if (allData.length === 0) {
            throw new Error('Не удалось загрузить данные ни с одного листа');
        }
        
        console.log(`Всего загружено: ${allData.length} точек`);
        
        allPoints = allData;
        
        updateFilters();
        updateStatistics();
        updateStatusStatistics();
        updateLegend();
        updateLastUpdateTime();
        showPointsOnMap();
        
        updateStatus(`Загружено: ${allData.length} точек`, 'success');
        showNotification(`Данные успешно загружены: ${allData.length} точек`, 'success', 3000);
        
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        updateStatus('Ошибка загрузки', 'error');
        showNotification('Не удалось загрузить данные', 'error');
        
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
        console.log(`Загружаю: ${url}`);
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        
        const csvText = await response.text();
        return parseCSV(csvText);
        
    } catch (error) {
        console.error(`Ошибка загрузки листа "${sheetName}":`, error);
        throw error;
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
    
    const columnIndices = detectColumnIndices(headers);
    
    console.log(`Столбцы для листа "${sheetName}":`, columnIndices);
    
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
                h.includes(possibleName.toLowerCase())
            );
            
            if (index !== -1) {
                indices[type] = index;
                console.log(`✓ Столбец "${type}" найден как "${headers[index]}"`);
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
        sheet: sheetName,
        name: getValue('name'),
        region: getValue('region'),
        address: getValue('address'),
        status: getValue('status'),
        manager: getValue('manager'),
        contractor: getValue('contractor'),
        project: getValue('project') || sheetName // Используем название листа как проект
    };
    
    // Нормализуем статус
    if (point.status) {
        point.originalStatus = point.status;
        point.status = normalizeADTSStatus(point.status);
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
            const coords = getRandomCoordinate(point.address, point.region, point.project);
            return {
                ...point,
                lat: coords.lat,
                lng: coords.lng,
                isMock: true
            };
        }
        return { ...point, isMock: false };
    });
}

// ========== ОТОБРАЖЕНИЕ ТОЧЕК ==========

function showPointsOnMap() {
    markerCluster.clearLayers();
    markersMap.clear();
    
    const filteredPoints = filterPoints();
    console.log(`Показываю ${filteredPoints.length} точек на карте`);
    
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
    updateLegend();
    
    // Центрируем карту
    if (filteredPoints.length > 0) {
        centerMapOnFilteredPoints();
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
            
            ${point.project ? `
                <div style="margin-bottom: 10px;">
                    <div style="font-size: 12px; color: #7f8c8d;">Проект:</div>
                    <div style="color: #3498db; font-weight: bold;">${point.project}</div>
                </div>
            ` : ''}
            
            ${point.region ? `
                <div style="margin-bottom: 10px;">
                    <div style="font-size: 12px; color: #7f8c8d;">Регион:</div>
                    <div>${point.region}</div>
                </div>
            ` : ''}
            
            ${point.manager ? `
                <div style="margin-bottom: 10px;">
                    <div style="font-size: 12px; color: #7f8c8d;">Менеджер:</div>
                    <div>${point.manager}</div>
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
        managers: new Set()
    };
    
    allPoints.forEach(point => {
        if (point.project) filters.projects.add(point.project);
        if (point.region) filters.regions.add(point.region);
        if (point.status) filters.statuses.add(normalizeADTSStatus(point.status));
        if (point.manager) filters.managers.add(point.manager);
    });
    
    fillFilter('filter-project', Array.from(filters.projects).sort());
    fillFilter('filter-region', Array.from(filters.regions).sort());
    fillFilter('filter-status', Array.from(filters.statuses).sort());
    fillFilter('filter-manager', Array.from(filters.managers).sort());
    
    console.log('Фильтры обновлены');
    console.log('- Проектов:', filters.projects.size);
    console.log('- Регионов:', filters.regions.size);
    console.log('- Статусов:', filters.statuses.size);
    console.log('- Менеджеров:', filters.managers.size);
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
    console.log('Применяю фильтры...');
    
    activeFilters.projects = getSelectedValues('filter-project');
    activeFilters.regions = getSelectedValues('filter-region');
    activeFilters.statuses = getSelectedValues('filter-status');
    activeFilters.managers = getSelectedValues('filter-manager');
    
    console.log('Активные фильтры:', activeFilters);
    
    showPointsOnMap();
    showNotification('Фильтры применены', 'success');
}

function clearFilters() {
    console.log('Сбрасываю фильтры...');
    
    ['filter-project', 'filter-region', 'filter-status', 'filter-manager'].forEach(id => {
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
        managers: []
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
    
    console.log(`Поиск: "${query}"`);
    
    const results = allPoints.filter(point => {
        const searchFields = [
            point.name,
            point.address,
            point.region,
            point.manager,
            point.project,
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
    
    markerCluster.clearLayers();
    results.forEach(point => {
        if (point.lat && point.lng) {
            const marker = createMarker(point);
            markerCluster.addLayer(marker);
        }
    });
    
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
                    <span style="font-size: 14px; color: #3498db; font-weight: bold;">${point.project}</span>
                </p>
            ` : ''}
            
            ${point.manager ? `
                <p style="margin-bottom: 12px;">
                    <strong style="color: #3498db;">Менеджер:</strong><br>
                    <span style="font-size: 14px;">${point.manager}</span>
                </p>
            ` : ''}
            
            ${point.contractor ? `
                <p style="margin-bottom: 12px;">
                    <strong style="color: #3498db;">Подрядчик:</strong><br>
                    <span style="font-size: 14px;">${point.contractor}</span>
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
    
    // Обновляем основные счетчики
    const totalElement = document.getElementById('total-points');
    const shownElement = document.getElementById('shown-points');
    const accuracyElement = document.getElementById('accuracy-stats');
    const percentageElement = document.getElementById('shown-percentage');
    
    if (totalElement) totalElement.textContent = totalPoints.toLocaleString();
    if (shownElement) shownElement.textContent = shownPoints.toLocaleString();
    
    // Точные vs приблизительные координаты
    const exactPoints = filteredPoints.filter(p => !p.isMock).length;
    const approxPoints = filteredPoints.filter(p => p.isMock).length;
    
    if (accuracyElement) {
        accuracyElement.textContent = `${exactPoints}/${approxPoints}`;
    }
    
    // Процент показанных точек
    const percentage = totalPoints > 0 ? Math.round((shownPoints / totalPoints) * 100) : 0;
    if (percentageElement) {
        percentageElement.textContent = `${percentage}%`;
    }
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
        'Есть проблемы': 'count-problems',
        'В очереди': 'count-queue',
        'Первичный': 'count-primary',
        'Финальный': 'count-final',
        'Доработка': 'count-rework'
    };
    
    Object.keys(statusElements).forEach(status => {
        const elementId = statusElements[status];
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = (statusCounts[status] || 0).toLocaleString();
        }
    });
}

function updateFilterCounts() {
    const filters = [
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
        { name: 'Есть проблемы', color: '#e74c3c', icon: 'exclamation-circle' },
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
                console.log('Автоматическое обновление данных...');
                loadData();
            }
        }, CONFIG.UPDATE.interval);
    }
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

function getRandomCoordinate(address, region, project) {
    let baseLat = 55.7558; // Москва по умолчанию
    let baseLng = 37.6173;
    
    if (!region) {
        // Добавляем случайное смещение если регион не указан
        const lat = baseLat + (Math.random() - 0.5) * 10;
        const lng = baseLng + (Math.random() - 0.5) * 30;
        return { lat, lng };
    }
    
    const regionLower = region.toLowerCase().trim();
    
    // Крупные города
    if (regionLower.includes('москва')) {
        baseLat = 55.7558; baseLng = 37.6173;
    }
    else if (regionLower.includes('петербург') || regionLower.includes('спб')) {
        baseLat = 59.9343; baseLng = 30.3351;
    }
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
    else if (regionLower.includes('краснодар') || regionLower.includes('краснодарский')) {
        baseLat = 45.0355; baseLng = 38.9753;
    }
    else if (regionLower.includes('сочи')) {
        baseLat = 43.5855; baseLng = 39.7231;
    }
    
    // Регионы России
    else if (regionLower.includes('алтайский')) {
        baseLat = 52.5186; baseLng = 85.2042; // Барнаул
    }
    else if (regionLower.includes('архангельск')) {
        baseLat = 64.5393; baseLng = 40.5187;
    }
    else if (regionLower.includes('астрахан')) {
        baseLat = 46.3479; baseLng = 48.0336;
    }
    else if (regionLower.includes('белгород')) {
        baseLat = 50.5955; baseLng = 36.5872;
    }
    else if (regionLower.includes('брянск')) {
        baseLat = 53.2420; baseLng = 34.3653;
    }
    else if (regionLower.includes('владимир')) {
        baseLat = 56.1290; baseLng = 40.4066;
    }
    else if (regionLower.includes('волгоград')) {
        baseLat = 48.7071; baseLng = 44.5169;
    }
    else if (regionLower.includes('вологод')) {
        baseLat = 59.2205; baseLng = 39.8915;
    }
    else if (regionLower.includes('воронеж')) {
        baseLat = 51.6615; baseLng = 39.2003;
    }
    else if (regionLower.includes('иванов')) {
        baseLat = 56.9972; baseLng = 40.9714;
    }
    else if (regionLower.includes('иркутск')) {
        baseLat = 52.2864; baseLng = 104.2807;
    }
    else if (regionLower.includes('кабардин') || regionLower.includes('балкар')) {
        baseLat = 43.4853; baseLng = 43.6071; // Нальчик
    }
    else if (regionLower.includes('калуж')) {
        baseLat = 54.5138; baseLng = 36.2612;
    }
    else if (regionLower.includes('карачаево') || regionLower.includes('черкесск')) {
        baseLat = 44.0433; baseLng = 42.8643; // Черкесск
    }
    else if (regionLower.includes('карел')) {
        baseLat = 61.7850; baseLng = 34.3469; // Петрозаводск
    }
    else if (regionLower.includes('кемеров') || regionLower.includes('кузбасс')) {
        baseLat = 55.3547; baseLng = 86.0878; // Кемерово
    }
    else if (regionLower.includes('киров')) {
        baseLat = 58.6035; baseLng = 49.6680;
    }
    else if (regionLower.includes('коми')) {
        baseLat = 61.6688; baseLng = 50.8354; // Сыктывкар
    }
    else if (regionLower.includes('костром')) {
        baseLat = 57.7679; baseLng = 40.9269;
    }
    else if (regionLower.includes('красноярск')) {
        baseLat = 56.0153; baseLng = 92.8932;
    }
    else if (regionLower.includes('курган')) {
        baseLat = 55.4410; baseLng = 65.3411;
    }
    else if (regionLower.includes('курск')) {
        baseLat = 51.7304; baseLng = 36.1926;
    }
    else if (regionLower.includes('ленинград')) {
        baseLat = 59.9386; baseLng = 30.3141;
    }
    else if (regionLower.includes('липецк')) {
        baseLat = 52.6088; baseLng = 39.5992;
    }
    else if (regionLower.includes('московская') || regionLower.includes('подмосков')) {
        baseLat = 55.7539; baseLng = 37.6208;
    }
    else if (regionLower.includes('мурманск')) {
        baseLat = 68.9707; baseLng = 33.0749;
    }
    else if (regionLower.includes('нижегород') || regionLower.includes('нижний')) {
        baseLat = 56.3269; baseLng = 44.0065;
    }
    else if (regionLower.includes('новгород')) {
        baseLat = 58.5228; baseLng = 31.2699;
    }
    else if (regionLower.includes('новосибирск')) {
        baseLat = 55.0084; baseLng = 82.9357;
    }
    else if (regionLower.includes('омск')) {
        baseLat = 54.9893; baseLng = 73.3682;
    }
    else if (regionLower.includes('оренбург')) {
        baseLat = 51.7682; baseLng = 55.0974;
    }
    else if (regionLower.includes('орлов')) {
        baseLat = 52.9671; baseLng = 36.0696;
    }
    else if (regionLower.includes('пенз')) {
        baseLat = 53.1951; baseLng = 45.0183;
    }
    else if (regionLower.includes('перм')) {
        baseLat = 58.0105; baseLng = 56.2294;
    }
    else if (regionLower.includes('псков')) {
        baseLat = 57.8194; baseLng = 28.3318;
    }
    else if (regionLower.includes('адыг')) {
        baseLat = 44.6098; baseLng = 40.1005; // Майкоп
    }
    else if (regionLower.includes('башкортостан') || regionLower.includes('уфа')) {
        baseLat = 54.7351; baseLng = 55.9587;
    }
    else if (regionLower.includes('дагестан')) {
        baseLat = 42.9831; baseLng = 47.5047; // Махачкала
    }
    else if (regionLower.includes('марий') || regionLower.includes('йошкар')) {
        baseLat = 56.6344; baseLng = 47.8999;
    }
    else if (regionLower.includes('мордов')) {
        baseLat = 54.1874; baseLng = 45.1839; // Саранск
    }
    else if (regionLower.includes('татарстан') || regionLower.includes('казань')) {
        baseLat = 55.7961; baseLng = 49.1064;
    }
    else if (regionLower.includes('ростов')) {
        baseLat = 47.2224; baseLng = 39.7189; // Ростов-на-Дону
    }
    else if (regionLower.includes('рязан')) {
        baseLat = 54.6292; baseLng = 39.7369;
    }
    else if (regionLower.includes('самар')) {
        baseLat = 53.1951; baseLng = 50.1069;
    }
    else if (regionLower.includes('саратов')) {
        baseLat = 51.5331; baseLng = 46.0342;
    }
    else if (regionLower.includes('свердлов') || regionLower.includes('екатеринбург')) {
        baseLat = 56.8389; baseLng = 60.6057;
    }
    else if (regionLower.includes('северная') || regionLower.includes('осет')) {
        baseLat = 43.0246; baseLng = 44.6817; // Владикавказ
    }
    else if (regionLower.includes('смоленск')) {
        baseLat = 54.7826; baseLng = 32.0453;
    }
    else if (regionLower.includes('ставрополь')) {
        baseLat = 45.0433; baseLng = 41.9691;
    }
    else if (regionLower.includes('тамбов')) {
        baseLat = 52.7213; baseLng = 41.4523;
    }
    else if (regionLower.includes('твер')) {
        baseLat = 56.8587; baseLng = 35.9176;
    }
    else if (regionLower.includes('томск')) {
        baseLat = 56.4846; baseLng = 84.9476;
    }
    else if (regionLower.includes('тульск')) {
        baseLat = 54.1931; baseLng = 37.6173;
    }
    else if (regionLower.includes('тюмен')) {
        baseLat = 57.1522; baseLng = 65.5272;
    }
    else if (regionLower.includes('удмурт') || regionLower.includes('ижевск')) {
        baseLat = 56.8526; baseLng = 53.2115;
    }
    else if (regionLower.includes('ульяновск')) {
        baseLat = 54.3142; baseLng = 48.4031;
    }
    else if (regionLower.includes('хакас')) {
        baseLat = 53.7224; baseLng = 91.4426; // Абакан
    }
    else if (regionLower.includes('хмао') || regionLower.includes('ханты') || regionLower.includes('сургут')) {
        baseLat = 61.2541; baseLng = 73.3962; // Ханты-Мансийск
    }
    else if (regionLower.includes('челябинск')) {
        baseLat = 55.1599; baseLng = 61.4026;
    }
    else if (regionLower.includes('чуваш') || regionLower.includes('чебоксар')) {
        baseLat = 56.1463; baseLng = 47.2511;
    }
    else if (regionLower.includes('янао') || regionLower.includes('ямало')) {
        baseLat = 66.5299; baseLng = 66.6145; // Салехард
    }
    else if (regionLower.includes('ярослав')) {
        baseLat = 57.6261; baseLng = 39.8845;
    }
    else if (regionLower.includes('калмык')) {
        baseLat = 46.3078; baseLng = 44.2558; // Элиста
    }
    else if (regionLower.includes('сочи')) {
        baseLat = 43.5855; baseLng = 39.7231;
    }
    else if (regionLower.includes('крым') || regionLower.includes('севастополь')) {
        baseLat = 44.9521; baseLng = 34.1024; // Симферополь
    }
    
    // Добавляем случайное смещение в пределах региона
    const lat = baseLat + (Math.random() - 0.5) * 0.5;
    const lng = baseLng + (Math.random() - 0.5) * 0.8;
    
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
window.updateLegend = updateLegend;
window.updateFilterCounts = updateFilterCounts;

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
