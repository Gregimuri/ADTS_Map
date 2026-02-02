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
    console.log('Инициализация приложения ADTS...');
    initMap();
    showDemoData();
    loadData();
    setupAutoUpdate();
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
            maxZoom: 18
        }).addTo(map);
        
        markerCluster = L.markerClusterGroup({
            maxClusterRadius: 40,
            iconCreateFunction: function(cluster) {
                const count = cluster.getChildCount();
                const markers = cluster.getAllChildMarkers();
                
                let color = dynamicStatusColors.default;
                const statuses = markers.map(m => m.options.status);
                
                // Находим цвет для кластера на основе статусов точек
                // Приоритет: красный > желтый > синий > фиолетовый > зеленый > серый
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
                
                return L.divIcon({
                    html: `<div style="background:${color}; color:white; width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; border:3px solid white; box-shadow:0 2px 5px rgba(0,0,0,0.3);">${count}</div>`,
                    className: 'custom-cluster',
                    iconSize: [40, 40]
                });
            }
        }).addTo(map);
        
        console.log('Карта успешно инициализирована');
    } catch (error) {
        console.error('Ошибка инициализации карты:', error);
        showNotification('Ошибка загрузки карты', 'error');
    }
}

// ========== УТИЛИТЫ ==========

function updateStatus(message) {
    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.innerHTML = `<i class="fas fa-circle" style="color: #2ecc71;"></i> ${message}`;
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
    document.querySelectorAll('.notification').forEach(el => el.remove());
    
    const notification = document.createElement('div');
    notification.className = 'notification';
    
    let icon = 'info-circle';
    if (type === 'success') icon = 'check-circle';
    else if (type === 'error') icon = 'exclamation-circle';
    else if (type === 'warning') icon = 'exclamation-triangle';
    
    notification.innerHTML = `
        <div style="
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            background: ${type === 'success' ? '#2ecc71' : 
                         type === 'error' ? '#e74c3c' : 
                         type === 'warning' ? '#f39c12' : '#3498db'};
            color: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 3000;
            display: flex;
            align-items: center;
            gap: 10px;
            animation: slideIn 0.3s ease;
            max-width: 400px;
        ">
            <i class="fas fa-${icon}"></i>
            <span>${message}</span>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentElement) {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                if (notification.parentElement) notification.remove();
            }, 300);
        }
    }, duration);
}

// ========== НОРМАЛИЗАЦИЯ СТАТУСОВ ADTS ==========

function normalizeADTSStatus(status) {
    if (!status) return 'Не указан';
    
    const statusLower = status.toLowerCase().trim();
    
    // Нормализация для статусов ADTS
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
    return ADTS_STATUS_COLORS[normalizedStatus] || dynamicStatusColors.default;
}

// ========== ЗАГРУЗКА ДАННЫХ ==========

async function loadData() {
    if (isLoading) return;
    
    isLoading = true;
    
    try {
        updateStatus('Загрузка данных...');
        showModal('Загрузка', 'Подключение к Google Таблице...');
        
        console.log('Начинаю загрузку данных ADTS...');
        const data = await loadDataAsCSV();
        
        if (!data || data.length === 0) {
            throw new Error('Не удалось загрузить данные');
        }
        
        console.log(`Данные загружены: ${data.length} строк, ${data[0]?.length || 0} столбцов`);
        
        allPoints = processData(data);
        console.log(`Обработано точек: ${allPoints.length}`);
        
        // Определяем динамические настройки на основе данных
        determineDynamicSettings(allPoints);
        
        // Показываем несколько точек для отладки
        if (allPoints.length > 0) {
            console.log('Примеры обработанных точек ADTS:');
            allPoints.slice(0, 5).forEach((point, i) => {
                console.log(`${i+1}. Название: "${point.name}" | Регион: "${point.region}" | Статус: "${point.status}" | Нормализованный: "${normalizeADTSStatus(point.status)}"`);
            });
        }
        
        allPoints = await addCoordinatesFast(allPoints);
        console.log(`Координаты добавлены: ${allPoints.length}`);
        
        updateFilters();
        updateStatistics();
        updateStatusStatistics();
        updateLegend();
        showPointsOnMap();
        
        closeModal();
        updateStatus(`Загружено: ${allPoints.length} точек ADTS`);
        showNotification('Данные успешно загружены', 'success');
        
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        updateStatus('Ошибка загрузки');
        showNotification('Ошибка загрузки данных. Используются демо-данные.', 'error');
        
        if (allPoints.length === 0) {
            showDemoData();
        }
        
    } finally {
        isLoading = false;
    }
}

async function loadDataAsCSV() {
    const url = `https://docs.google.com/spreadsheets/d/${CONFIG.SPREADSHEET_ID}/export?format=csv&id=${CONFIG.SPREADSHEET_ID}`;
    
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

// ========== ОБРАБОТКА ДАННЫХ ==========

function determineDynamicSettings(points) {
    console.log('Определение динамических настроек для ADTS...');
    
    // Собираем все уникальные статусы из данных
    const uniqueStatuses = new Set();
    points.forEach(point => {
        if (point.status && point.status.trim() !== '') {
            // Нормализуем статус для ADTS
            const normalizedStatus = normalizeADTSStatus(point.status);
            uniqueStatuses.add(normalizedStatus);
        }
    });
    
    console.log('Уникальные статусы ADTS:', Array.from(uniqueStatuses));
    
    // Создаем маппинг статусов
    dynamicStatusMapping = {};
    points.forEach(point => {
        if (point.status && point.status.trim() !== '') {
            const normalizedStatus = normalizeADTSStatus(point.status);
            dynamicStatusMapping[point.status] = normalizedStatus;
        }
    });
    
    // Генерируем цвета для статусов
    generateStatusColors(Array.from(uniqueStatuses));
}

function generateStatusColors(statuses) {
    console.log('Генерация цветов для статусов ADTS:', statuses);
    
    // Очищаем текущие цвета
    dynamicStatusColors = { 'default': '#95a5a6' };
    
    // Назначаем цвета из схемы ADTS
    statuses.forEach(status => {
        // Ищем точное совпадение в схеме ADTS
        if (ADTS_STATUS_COLORS[status]) {
            dynamicStatusColors[status] = ADTS_STATUS_COLORS[status];
            console.log(`✓ Назначен цвет ${ADTS_STATUS_COLORS[status]} для статуса "${status}"`);
        } else {
            // Ищем частичное совпадение
            let colorFound = false;
            for (const [key, color] of Object.entries(ADTS_STATUS_COLORS)) {
                if (status.toLowerCase().includes(key.toLowerCase()) || 
                    key.toLowerCase().includes(status.toLowerCase())) {
                    dynamicStatusColors[status] = color;
                    console.log(`≈ Назначен цвет ${color} для статуса "${status}" (похож на "${key}")`);
                    colorFound = true;
                    break;
                }
            }
            
            // Если не нашли, используем цвет по умолчанию
            if (!colorFound) {
                dynamicStatusColors[status] = dynamicStatusColors.default;
                console.log(`✗ Статус "${status}" не распознан, использован цвет по умолчанию`);
            }
        }
    });
    
    console.log('Финальные цвета статусов ADTS:', dynamicStatusColors);
}

function processData(rows) {
    console.log('Начинаю обработку данных ADTS...');
    
    if (!rows || rows.length < 2) {
        return [];
    }
    
    const points = [];
    const headers = rows[0].map(h => h.toString().trim());
    
    console.log('Заголовки столбцов:', headers);
    console.log('Количество столбцов:', headers.length);
    
    const colIndices = findColumnIndices(headers);
    console.log('Найденные индексы столбцов:', colIndices);
    
    const useSimpleApproach = headers.length < 3 || 
                              Object.values(colIndices).filter(idx => idx !== -1).length < 3;
    
    if (useSimpleApproach) {
        console.log('Использую простой подход к парсингу данных');
        return processDataSimple(rows);
    }
    
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        
        if (!row || row.length === 0) {
            continue;
        }
        
        const point = {
            id: `point_${i}_${Date.now()}`,
            sheetRow: i + 1,
            name: '',
            region: '',
            address: '',
            status: '',
            manager: '',
            contractor: '',
            project: '',
            originalAddress: '',
            originalStatus: ''
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
                point.name = 'Точка ADTS ' + i;
            }
        }
        
        if (point.name && (point.address || point.region || point.status)) {
            points.push(point);
        }
    }
    
    console.log(`Обработано точек ADTS: ${points.length}`);
    return points;
}

function processDataSimple(rows) {
    console.log('Использую простой метод обработки данных ADTS...');
    
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
            id: `point_${i}_${Date.now()}`,
            sheetRow: i + 1,
            name: '',
            region: '',
            address: '',
            status: '',
            manager: '',
            contractor: '',
            project: '',
            isMock: true
        };
        
        if (row.length > nameIndex) point.name = cleanString(row[nameIndex]);
        if (regionIndex !== -1 && row.length > regionIndex) point.region = cleanString(row[regionIndex]);
        if (addressIndex !== -1 && row.length > addressIndex) point.address = cleanString(row[addressIndex]);
        if (statusIndex !== -1 && row.length > statusIndex) point.status = cleanString(row[statusIndex]);
        if (projectIndex !== -1 && row.length > projectIndex) point.project = cleanString(row[projectIndex]);
        
        if (row.length > 5) point.manager = cleanString(row[5]);
        if (row.length > 6) point.contractor = cleanString(row[6]);
        
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
                point.name = 'Точка ADTS ' + i;
            }
        }
        
        if (point.name) {
            points.push(point);
        }
    }
    
    console.log(`Обработано точек ADTS (простой метод): ${points.length}`);
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
        if (header.includes('название') || header.includes('имя') || header.includes('точка') || header.includes('тт')) {
            if (indices.name === -1) indices.name = index;
        }
        if (header.includes('регион') || header.includes('область') || header.includes('край') || header.includes('респ')) {
            if (indices.region === -1) indices.region = index;
        }
        if (header.includes('адрес') || header.includes('улица') || header.includes('местоположение') || header.includes('location')) {
            if (indices.address === -1) indices.address = index;
        }
        if (header.includes('статус') || header.includes('состояние')) {
            if (indices.status === -1) indices.status = index;
        }
        if (header.includes('менеджер') || header.includes('ответственный') || header.includes('фио')) {
            if (indices.manager === -1) indices.manager = index;
        }
        if (header.includes('подрядчик') || header.includes('исполнитель') || header.includes('контрагент')) {
            if (indices.contractor === -1) indices.contractor = index;
        }
        if (header.includes('проект')) {
            if (indices.project === -1) indices.project = index;
        }
    });
    
    let nextIndex = 0;
    Object.keys(indices).forEach(key => {
        if (indices[key] === -1) {
            while (Object.values(indices).includes(nextIndex) && nextIndex < headers.length) {
                nextIndex++;
            }
            if (nextIndex < headers.length) {
                indices[key] = nextIndex;
                nextIndex++;
            }
        }
    });
    
    return indices;
}

// ========== БЫСТРОЕ ДОБАВЛЕНИЕ КООРДИНАТ ==========

async function addCoordinatesFast(points) {
    console.log('⚡ Быстрое добавление координат для ADTS...');
    
    return points.map(point => {
        if (!point.lat || !point.lng) {
            const coords = getRandomCoordinate(point.address || '', point.region || '');
            return { 
                ...point, 
                lat: coords.lat, 
                lng: coords.lng, 
                isMock: true,
                geocodingSource: 'approximate'
            };
        }
        return point;
    });
}

// ========== ОТОБРАЖЕНИЕ ТОЧЕК ==========

function showPointsOnMap() {
    console.log('Показываю точки ADTS на карте...');
    
    markerCluster.clearLayers();
    markersMap.clear();
    
    const filteredPoints = filterPoints();
    console.log(`Фильтровано точек ADTS: ${filteredPoints.length}`);
    
    filteredPoints.forEach(point => {
        if (point.lat && point.lng) {
            const marker = createMarker(point);
            markerCluster.addLayer(marker);
            markersMap.set(point.id, marker);
        }
    });
    
    if (filteredPoints.length > 0 && filteredPoints.some(p => p.lat && p.lng)) {
        const bounds = L.latLngBounds(
            filteredPoints
                .filter(p => p.lat && p.lng)
                .map(p => [p.lat, p.lng])
        );
        
        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
        }
    }
    
    updateStatistics();
    updateStatusStatistics();
}

function createMarker(point) {
    const normalizedStatus = normalizeADTSStatus(point.status);
    const color = getStatusColor(point.status);
    const statusIcon = getStatusIcon(point.status);
    
    // Определяем класс маркера на основе статуса
    let markerClass = '';
    switch(normalizedStatus) {
        case 'Выполнен':
            markerClass = 'marker-completed';
            break;
        case 'Нет оборудования':
            markerClass = 'marker-no-equipment';
            break;
        case 'В очереди':
            markerClass = 'marker-queue';
            break;
        case 'Первичный':
            markerClass = 'marker-primary';
            break;
        case 'Финальный':
            markerClass = 'marker-final';
            break;
        case 'Доработка после монтажа':
            markerClass = 'marker-rework';
            break;
    }
    
    let accuracyIcon = '';
    if (point.isMock) {
        accuracyIcon = '<div style="position: absolute; top: -4px; right: -4px; width: 12px; height: 12px; background: #f39c12; border-radius: 50%; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.3);"></div>';
    }
    
    const icon = L.divIcon({
        html: `
            <div style="position: relative;">
                <div class="custom-marker ${markerClass}" style="
                    background: ${color};
                    width: 34px;
                    height: 34px;
                    border-radius: 50%;
                    border: 3px solid white;
                    box-shadow: 0 3px 8px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: ${['#f1c40f'].includes(color) ? '#2c3e50' : 'white'};
                    font-weight: bold;
                    font-size: 14px;
                    transition: all 0.3s;
                    cursor: pointer;
                ">
                    ${statusIcon}
                </div>
                ${accuracyIcon}
            </div>
        `,
        className: 'adts-marker',
        iconSize: [34, 34],
        iconAnchor: [17, 34]
    });
    
    const marker = L.marker([point.lat, point.lng], {
        icon: icon,
        title: `${point.name} - ${normalizedStatus}`,
        status: normalizedStatus,
        pointId: point.id,
        isMock: point.isMock || false
    });
    
    marker.bindPopup(createPopupContent(point));
    marker.on('click', function() {
        showPointDetails(point);
        // Подсвечиваем маркер при клике
        this.setIcon(createHighlightedMarker(point));
        setTimeout(() => {
            this.setIcon(icon);
        }, 2000);
    });
    
    marker.on('mouseover', function() {
        this.openPopup();
    });
    
    marker.on('mouseout', function() {
        this.closePopup();
    });
    
    return marker;
}

function createHighlightedMarker(point) {
    const color = getStatusColor(point.status);
    const statusIcon = getStatusIcon(point.status);
    
    return L.divIcon({
        html: `
            <div style="position: relative;">
                <div style="
                    background: ${color};
                    width: 42px;
                    height: 42px;
                    border-radius: 50%;
                    border: 4px solid white;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: ${['#f1c40f'].includes(color) ? '#2c3e50' : 'white'};
                    font-weight: bold;
                    font-size: 16px;
                    animation: pulse 1s infinite;
                ">
                    ${statusIcon}
                </div>
                <div style="position: absolute; top: -6px; right: -6px; width: 16px; height: 16px; background: #f39c12; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>
            </div>
        `,
        className: 'adts-marker-highlighted',
        iconSize: [42, 42],
        iconAnchor: [21, 42]
    });
}

function createPopupContent(point) {
    const normalizedStatus = normalizeADTSStatus(point.status);
    const color = getStatusColor(point.status);
    const statusIcon = getStatusIcon(point.status);
    
    let displayAddress = point.address || '';
    if (displayAddress) {
        displayAddress = displayAddress.replace(/^\d{6},?\s*/, '');
        displayAddress = displayAddress.replace(/"/g, '');
        displayAddress = displayAddress.trim();
    }
    
    let accuracyInfo = '';
    if (point.isMock) {
        accuracyInfo = `
            <div style="margin-top: 10px; padding: 8px; background: #f39c12; color: white; border-radius: 6px; font-size: 12px; display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-exclamation-triangle"></i>
                <span>Приблизительные координаты</span>
            </div>
        `;
    }
    
    const statusInfo = normalizedStatus === 'Не указан' ? 
        `<span style="color: #95a5a6;">Не указан</span>` :
        `<span style="color: ${color}; font-weight: 600; background: ${color}20; padding: 2px 8px; border-radius: 4px; display: inline-flex; align-items: center; gap: 5px;">
            ${statusIcon} ${normalizedStatus}
        </span>`;
    
    return `
        <div style="min-width: 280px; max-width: 350px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
            <h4 style="margin: 0 0 12px 0; color: #2c3e50; border-bottom: 3px solid ${color}; padding-bottom: 8px; display: flex; align-items: center; justify-content: space-between;">
                <span>${point.name || 'Без названия'}</span>
                <span style="font-size: 12px; color: #7f8c8d;">ADTS</span>
            </h4>
            
            <div style="margin-bottom: 15px;">
                <div style="font-size: 12px; color: #7f8c8d; margin-bottom: 5px;">Статус:</div>
                <div style="font-size: 14px;">${statusInfo}</div>
            </div>
            
            ${displayAddress ? `
                <div style="margin-bottom: 12px;">
                    <div style="font-size: 12px; color: #7f8c8d; margin-bottom: 5px;">
                        <i class="fas fa-map-marker-alt"></i> Адрес:
                    </div>
                    <div style="font-size: 14px; line-height: 1.4;">${displayAddress}</div>
                </div>
            ` : ''}
            
            ${point.region ? `
                <div style="margin-bottom: 12px;">
                    <div style="font-size: 12px; color: #7f8c8d; margin-bottom: 5px;">
                        <i class="fas fa-globe"></i> Регион:
                    </div>
                    <div style="font-size: 14px;">${point.region}</div>
                </div>
            ` : ''}
            
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 15px;">
                ${point.project ? `
                    <div>
                        <div style="font-size: 12px; color: #7f8c8d; margin-bottom: 3px;">Проект:</div>
                        <div style="font-size: 13px; font-weight: 500;">${point.project}</div>
                    </div>
                ` : ''}
                
                ${point.manager ? `
                    <div>
                        <div style="font-size: 12px; color: #7f8c8d; margin-bottom: 3px;">Менеджер:</div>
                        <div style="font-size: 13px;">${point.manager}</div>
                    </div>
                ` : ''}
                
                ${point.contractor ? `
                    <div>
                        <div style="font-size: 12px; color: #7f8c8d; margin-bottom: 3px;">Подрядчик:</div>
                        <div style="font-size: 13px;">${point.contractor}</div>
                    </div>
                ` : ''}
            </div>
            
            ${point.lat && point.lng ? `
                <div style="margin-top: 15px; padding: 8px; background: #f8f9fa; border-radius: 4px; font-size: 11px; color: #6c757d;">
                    <div style="display: flex; justify-content: space-between;">
                        <span><i class="fas fa-crosshairs"></i> Координаты:</span>
                        <span>${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}</span>
                    </div>
                </div>
            ` : ''}
            
            ${accuracyInfo}
        </div>
    `;
}

// ========== ФИЛЬТРАЦИЯ ==========

function updateFilters() {
    console.log('Обновляю фильтры ADTS...');
    
    const filters = {
        projects: new Set(),
        regions: new Set(),
        statuses: new Set(),
        managers: new Set()
    };
    
    allPoints.forEach(point => {
        if (point.project && point.project.trim() !== '') filters.projects.add(point.project);
        if (point.region && point.region.trim() !== '') filters.regions.add(point.region);
        
        // Используем нормализованный статус для фильтров
        const normalizedStatus = normalizeADTSStatus(point.status);
        if (normalizedStatus && normalizedStatus.trim() !== '') filters.statuses.add(normalizedStatus);
        
        if (point.manager && point.manager.trim() !== '') filters.managers.add(point.manager);
    });
    
    // Сортируем фильтры для удобства
    fillFilter('filter-project', Array.from(filters.projects).sort());
    fillFilter('filter-region', Array.from(filters.regions).sort());
    fillFilter('filter-status', Array.from(filters.statuses).sort());
    fillFilter('filter-manager', Array.from(filters.managers).sort());
    
    console.log('Доступные фильтры ADTS:');
    console.log('- Проекты:', Array.from(filters.projects));
    console.log('- Регионы:', Array.from(filters.regions));
    console.log('- Статусы:', Array.from(filters.statuses));
    console.log('- Менеджеры:', Array.from(filters.managers));
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
            
            // Для фильтра статусов добавляем цвет
            if (selectId === 'filter-status') {
                const color = getStatusColor(option);
                opt.dataset.color = color;
                opt.style.color = color;
                opt.style.fontWeight = '600';
                
                // Добавляем иконку статуса
                const icon = getStatusIcon(option);
                opt.textContent = ` ${option}`;
                opt.innerHTML = `${icon} ${option}`;
            }
            
            if (selected.includes(option)) {
                opt.selected = true;
            }
            
            select.appendChild(opt);
        }
    });
}

function applyFilters() {
    console.log('Применяю фильтры ADTS...');
    
    activeFilters.projects = getSelectedValues('filter-project');
    activeFilters.regions = getSelectedValues('filter-region');
    activeFilters.statuses = getSelectedValues('filter-status');
    activeFilters.managers = getSelectedValues('filter-manager');
    
    console.log('Активные фильтры:', activeFilters);
    
    showPointsOnMap();
    showNotification('Фильтры применены', 'success');
}

function clearFilters() {
    console.log('Сбрасываю фильтры ADTS...');
    
    ['filter-project', 'filter-region', 'filter-status', 'filter-manager'].forEach(id => {
        const select = document.getElementById(id);
        if (select) select.selectedIndex = 0;
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
    const filtered = allPoints.filter(point => {
        const filters = [
            { key: 'project', value: point.project, active: activeFilters.projects },
            { key: 'region', value: point.region, active: activeFilters.regions },
            { key: 'status', value: normalizeADTSStatus(point.status), active: activeFilters.statuses },
            { key: 'manager', value: point.manager, active: activeFilters.managers }
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
            map.fitBounds(bounds, { padding: [50, 50] });
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
    
    if (totalPointsElement) totalPointsElement.textContent = allPoints.length;
    if (shownPointsElement) shownPointsElement.textContent = shownPoints;
    if (accuracyElement) accuracyElement.textContent = `${exactPoints}/${approximatePoints}`;
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
            " onclick="filterByStatus('${status.name}')" title="Нажмите для фильтрации">
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
    
    legendHTML += `
        <div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee; font-size: 12px; color: #7f8c8d;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                <span>Показано:</span>
                <span style="font-weight: 600; color: #2c3e50;">${totalFiltered}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
                <span>Всего точек:</span>
                <span style="font-weight: 600; color: #2c3e50;">${totalAll}</span>
            </div>
        </div>
    `;
    
    container.innerHTML = legendHTML;
}

// ========== АВТООБНОВЛЕНИЕ ==========

function setupAutoUpdate() {
    if (CONFIG.UPDATE?.auto) {
        updateInterval = setInterval(loadData, CONFIG.UPDATE.interval);
        console.log('Автообновление настроено');
    }
}

// ========== ДЕМО-ДАННЫЕ ==========

function showDemoData() {
    console.log('Показываем демо-данные ADTS...');
    
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
            lat: 55.7570,
            lng: 37.6145,
            isMock: false
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
            lat: 55.8890,
            lng: 37.4450,
            isMock: false
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
            lat: 53.3481,
            lng: 83.7794,
            isMock: true
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
            lat: 45.0355,
            lng: 38.9753,
            isMock: true
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
            lat: 56.8389,
            lng: 60.6057,
            isMock: true
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
            lat: 55.0084,
            lng: 82.9357,
            isMock: true
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
            lat: 47.2224,
            lng: 39.7189,
            isMock: true
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
            lat: 55.7961,
            lng: 49.1064,
            isMock: true
        }
    ];
    
    // Определяем динамические настройки для демо-данных
    determineDynamicSettings(allPoints);
    
    updateFilters();
    updateStatistics();
    updateStatusStatistics();
    updateLegend();
    showPointsOnMap();
    
    updateStatus('Демо-данные ADTS загружены');
    showNotification('Используются демо-данные ADTS', 'warning');
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
        
        // Республики
        'Адыгея': { lat: 44.6098, lng: 40.1006 },
        'Республика Адыгея': { lat: 44.6098, lng: 40.1006 },
        'Алтай': { lat: 50.2594, lng: 86.6593 },
        'Республика Алтай': { lat: 50.2594, lng: 86.6593 },
        'Башкортостан': { lat: 54.7351, lng: 55.9587 },
        'Республика Башкортостан': { lat: 54.7351, lng: 55.9587 },
        'Бурятия': { lat: 51.8235, lng: 107.5842 },
        'Республика Бурятия': { lat: 51.8235, lng: 107.5842 },
        'Дагестан': { lat: 42.9849, lng: 47.5047 },
        'Республика Дагестан': { lat: 42.9849, lng: 47.5047 },
        'Ингушетия': { lat: 43.1151, lng: 45.0060 },
        'Республика Ингушетия': { lat: 43.1151, lng: 45.0060 },
        'Кабардино-Балкария': { lat: 43.4847, lng: 43.6071 },
        'Республика Кабардино-Балкария': { lat: 43.4847, lng: 43.6071 },
        'Калмыкия': { lat: 46.3079, lng: 44.2700 },
        'Республика Калмыкия': { lat: 46.3079, lng: 44.2700 },
        'Карачаево-Черкесия': { lat: 43.9159, lng: 41.7740 },
        'Республика Карачаево-Черкесия': { lat: 43.9159, lng: 41.7740 },
        'Карелия': { lat: 61.7850, lng: 34.3468 },
        'Республика Карелия': { lat: 61.7850, lng: 34.3468 },
        'Коми': { lat: 61.6688, lng: 50.8354 },
        'Республика Коми': { lat: 61.6688, lng: 50.8354 },
        'Крым': { lat: 45.0433, lng: 34.6021 },
        'Республика Крым': { lat: 45.0433, lng: 34.6021 },
        'Марий Эл': { lat: 56.6380, lng: 47.8951 },
        'Республика Марий Эл': { lat: 56.6380, lng: 47.8951 },
        'Мордовия': { lat: 54.1874, lng: 45.1839 },
        'Республика Мордовия': { lat: 54.1874, lng: 45.1839 },
        'Саха': { lat: 62.0278, lng: 129.7325 },
        'Якутия': { lat: 62.0278, lng: 129.7325 },
        'Республика Саха': { lat: 62.0278, lng: 129.7325 },
        'Северная Осетия': { lat: 43.0241, lng: 44.6814 },
        'Республика Северная Осетия': { lat: 43.0241, lng: 44.6814 },
        'Татарстан': { lat: 55.7961, lng: 49.1064 },
        'Республика Татарстан': { lat: 55.7961, lng: 49.1064 },
        'Тыва': { lat: 51.7191, lng: 94.4378 },
        'Тува': { lat: 51.7191, lng: 94.4378 },
        'Республика Тыва': { lat: 51.7191, lng: 94.4378 },
        'Удмуртия': { lat: 57.0670, lng: 53.0270 },
        'Удмуртская Республика': { lat: 57.0670, lng: 53.0270 },
        'Хакасия': { lat: 53.7224, lng: 91.4435 },
        'Республика Хакасия': { lat: 53.7224, lng: 91.4435 },
        'Чечня': { lat: 43.3180, lng: 45.6903 },
        'Чеченская Республика': { lat: 43.3180, lng: 45.6903 },
        'Чувашия': { lat: 56.1439, lng: 47.2489 },
        'Чувашская Республика': { lat: 56.1439, lng: 47.2489 },
        
        // Края
        'Алтайский край': { lat: 52.5186, lng: 85.1019 },
        'Забайкальский край': { lat: 52.0333, lng: 113.5000 },
        'Камчатский край': { lat: 53.0370, lng: 158.6559 },
        'Краснодарский край': { lat: 45.0355, lng: 38.9753 },
        'Красноярский край': { lat: 56.0184, lng: 92.8672 },
        'Пермский край': { lat: 58.0105, lng: 56.2502 },
        'Приморский край': { lat: 43.1155, lng: 131.8855 },
        'Ставропольский край': { lat: 45.0433, lng: 41.9691 },
        'Хабаровский край': { lat: 48.4802, lng: 135.0719 },
        
        // Области
        'Амурская': { lat: 50.2907, lng: 127.5272 },
        'Архангельская': { lat: 64.5393, lng: 40.5187 },
        'Астраханская': { lat: 46.3479, lng: 48.0336 },
        'Белгородская': { lat: 50.5952, lng: 36.5872 },
        'Брянская': { lat: 53.2434, lng: 34.3642 },
        'Владимирская': { lat: 56.1290, lng: 40.4070 },
        'Волгоградская': { lat: 48.7080, lng: 44.5133 },
        'Вологодская': { lat: 59.2181, lng: 39.8886 },
        'Воронежская': { lat: 51.6755, lng: 39.2089 },
        'Ивановская': { lat: 57.0004, lng: 40.9739 },
        'Иркутская': { lat: 52.2896, lng: 104.2806 },
        'Калининградская': { lat: 54.7104, lng: 20.4522 },
        'Калужская': { lat: 54.5138, lng: 36.2612 },
        'Кемеровская': { lat: 55.3547, lng: 86.0873 },
        'Кировская': { lat: 58.6035, lng: 49.6680 },
        'Костромская': { lat: 58.5500, lng: 43.6833 },
        'Курганская': { lat: 55.4410, lng: 65.3411 },
        'Курская': { lat: 51.7370, lng: 36.1874 },
        'Липецкая': { lat: 52.6088, lng: 39.5992 },
        'Магаданская': { lat: 59.5682, lng: 150.8085 },
        'Мурманская': { lat: 68.9585, lng: 33.0827 },
        'Нижегородская': { lat: 56.3269, lng: 44.0065 },
        'Новгородская': { lat: 58.5228, lng: 31.2698 },
        'Новосибирская': { lat: 55.0084, lng: 82.9357 },
        'Омская': { lat: 54.9914, lng: 73.3715 },
        'Оренбургская': { lat: 51.7682, lng: 55.0974 },
        'Орловская': { lat: 52.9671, lng: 36.0696 },
        'Пензенская': { lat: 53.2007, lng: 45.0046 },
        'Псковская': { lat: 57.8194, lng: 28.3318 },
        'Ростовская': { lat: 47.2224, lng: 39.7189 },
        'Рязанская': { lat: 54.6269, lng: 39.6916 },
        'Самарская': { lat: 53.1959, lng: 50.1002 },
        'Саратовская': { lat: 51.5924, lng: 45.9608 },
        'Сахалинская': { lat: 46.9591, lng: 142.7380 },
        'Свердловская': { lat: 56.8389, lng: 60.6057 },
        'Смоленская': { lat: 54.7826, lng: 32.0453 },
        'Тамбовская': { lat: 52.7212, lng: 41.4523 },
        'Тверская': { lat: 56.8587, lng: 35.9176 },
        'Томская': { lat: 56.4846, lng: 84.9476 },
        'Тульская': { lat: 54.1920, lng: 37.6173 },
        'Тюменская': { lat: 57.1530, lng: 65.5343 },
        'Ульяновская': { lat: 54.3142, lng: 48.4031 },
        'Челябинская': { lat: 55.1644, lng: 61.4368 },
        'Ярославская': { lat: 57.6261, lng: 39.8845 },
        
        // Автономные области и округа
        'Еврейская': { lat: 48.7947, lng: 132.9211 },
        'Еврейская автономная область': { lat: 48.7947, lng: 132.9211 },
        'Ненецкий': { lat: 67.6381, lng: 53.0069 },
        'Ханты-Мансийский': { lat: 61.0032, lng: 69.0189 },
        'Чукотский': { lat: 65.9619, lng: -179.3715 },
        'Ямало-Ненецкий': { lat: 66.5299, lng: 66.6136 },
        
        // Крупные города
        'Екатеринбург': { lat: 56.8389, lng: 60.6057 },
        'Новосибирск': { lat: 55.0084, lng: 82.9357 },
        'Нижний Новгород': { lat: 56.3269, lng: 44.0065 },
        'Казань': { lat: 55.7961, lng: 49.1064 },
        'Челябинск': { lat: 55.1644, lng: 61.4368 },
        'Омск': { lat: 54.9914, lng: 73.3715 },
        'Самара': { lat: 53.1959, lng: 50.1002 },
        'Ростов-на-Дону': { lat: 47.2224, lng: 39.7189 },
        'Уфа': { lat: 54.7351, lng: 55.9587 },
        'Красноярск': { lat: 56.0184, lng: 92.8672 },
        'Воронеж': { lat: 51.6755, lng: 39.2089 },
        'Пермь': { lat: 58.0105, lng: 56.2502 },
        'Волгоград': { lat: 48.7080, lng: 44.5133 },
        'Краснодар': { lat: 45.0355, lng: 38.9753 },
        'Саратов': { lat: 51.5924, lng: 45.9608 },
        'Тюмень': { lat: 57.1530, lng: 65.5343 },
        'Тольятти': { lat: 53.5088, lng: 49.4191 },
        'Ижевск': { lat: 56.8526, lng: 53.2045 },
        'Барнаул': { lat: 53.3481, lng: 83.7794 },
        'Ульяновск': { lat: 54.3142, lng: 48.4031 },
        'Иркутск': { lat: 52.2896, lng: 104.2806 },
        'Хабаровск': { lat: 48.4802, lng: 135.0719 },
        'Ярославль': { lat: 57.6261, lng: 39.8845 },
        'Владивосток': { lat: 43.1155, lng: 131.8855 },
        'Махачкала': { lat: 42.9849, lng: 47.5047 },
        'Томск': { lat: 56.4846, lng: 84.9476 },
        'Оренбург': { lat: 51.7682, lng: 55.0974 },
        'Кемерово': { lat: 55.3547, lng: 86.0873 },
        'Новокузнецк': { lat: 53.7557, lng: 87.1099 },
        'Рязань': { lat: 54.6269, lng: 39.6916 },
        'Астрахань': { lat: 46.3479, lng: 48.0336 },
        'Пенза': { lat: 53.2007, lng: 45.0046 },
        'Липецк': { lat: 52.6088, lng: 39.5992 },
        'Тула': { lat: 54.1920, lng: 37.6173 },
        'Киров': { lat: 58.6035, lng: 49.6680 },
        'Чебоксары': { lat: 56.1439, lng: 47.2489 },
        'Калининград': { lat: 54.7104, lng: 20.4522 },
        'Брянск': { lat: 53.2434, lng: 34.3642 },
        'Курск': { lat: 51.7370, lng: 36.1874 },
        'Иваново': { lat: 57.0004, lng: 40.9739 },
        'Магнитогорск': { lat: 53.3833, lng: 59.0333 },
        'Тверь': { lat: 56.8587, lng: 35.9176 },
        'Ставрополь': { lat: 45.0433, lng: 41.9691 },
        'Сочи': { lat: 43.5855, lng: 39.7231 },
        'Грозный': { lat: 43.3180, lng: 45.6903 },
        'Владикавказ': { lat: 43.0241, lng: 44.6814 },
        'Мурманск': { lat: 68.9585, lng: 33.0827 },
        'Смоленск': { lat: 54.7826, lng: 32.0453 },
        'Калуга': { lat: 54.5138, lng: 36.2612 },
        'Чита': { lat: 52.0333, lng: 113.5000 },
        'Орёл': { lat: 52.9671, lng: 36.0696 },
        'Вологда': { lat: 59.2181, lng: 39.8886 },
        'Саранск': { lat: 54.1874, lng: 45.1839 },
        'Якутск': { lat: 62.0278, lng: 129.7325 },
        'Кострома': { lat: 58.5500, lng: 43.6833 },
        'Петрозаводск': { lat: 61.7850, lng: 34.3468 },
        'Тамбов': { lat: 52.7212, lng: 41.4523 },
        'Нальчик': { lat: 43.4847, lng: 43.6071 },
        'Владимир': { lat: 56.1290, lng: 40.4070 },
        'Черкесск': { lat: 44.2233, lng: 42.0578 },
        'Архангельск': { lat: 64.5393, lng: 40.5187 },
        'Сыктывкар': { lat: 61.6688, lng: 50.8354 },
        'Курган': { lat: 55.4410, lng: 65.3411 },
        'Симферополь': { lat: 45.0433, lng: 34.6021 },
        'Йошкар-Ола': { lat: 56.6380, lng: 47.8951 },
        'Севастополь': { lat: 44.6166, lng: 33.5254 },
        'Белгород': { lat: 50.5952, lng: 36.5872 },
        'Нарьян-Мар': { lat: 67.6381, lng: 53.0069 },
        'Ханты-Мансийск': { lat: 61.0032, lng: 69.0189 },
        'Анадырь': { lat: 64.7342, lng: 177.5103 },
        'Салехард': { lat: 66.5299, lng: 66.6136 },
        'Биробиджан': { lat: 48.7947, lng: 132.9211 },
        'Магадан': { lat: 59.5682, lng: 150.8085 },
        'Петропавловск-Камчатский': { lat: 53.0370, lng: 158.6559 },
        'Южно-Сахалинск': { lat: 46.9591, lng: 142.7380 },
        
        // По умолчанию - центр России
        'default': { lat: 55.7558, lng: 37.6173 }
    };
    
    let baseLat = 55.7558;
    let baseLng = 37.6173;
    let radius = 0.5; // Увеличиваем радиус для большего разнообразия
    
    if (region) {
        const regionStr = region.toString().trim().toLowerCase();
        let found = false;
        
        // Ищем точное совпадение
        for (const [key, coords] of Object.entries(regionCenters)) {
            if (regionStr === key.toLowerCase()) {
                baseLat = coords.lat;
                baseLng = coords.lng;
                found = true;
                break;
            }
        }
        
        // Ищем частичное совпадение, если точное не найдено
        if (!found) {
            for (const [key, coords] of Object.entries(regionCenters)) {
                if (regionStr.includes(key.toLowerCase()) || key.toLowerCase().includes(regionStr)) {
                    baseLat = coords.lat;
                    baseLng = coords.lng;
                    found = true;
                    break;
                }
            }
        }
        
        // Если регион не найден, пробуем разобрать адрес
        if (!found && address) {
            const addressStr = address.toString().toLowerCase();
            for (const [key, coords] of Object.entries(regionCenters)) {
                if (addressStr.includes(key.toLowerCase())) {
                    baseLat = coords.lat;
                    baseLng = coords.lng;
                    found = true;
                    break;
                }
            }
        }
    }
    
    // Для отдаленных регионов уменьшаем радиус
    if (region && (region.includes('Камчат') || region.includes('Сахалин') || 
                   region.includes('Магадан') || region.includes('Чукот') ||
                   region.includes('Якутия') || region.includes('Саха'))) {
        radius = 0.8;
    }
    
    // Генерируем случайные координаты в пределах радиуса
    const randomLat = baseLat + (Math.random() - 0.5) * radius * 2;
    const randomLng = baseLng + (Math.random() - 0.5) * radius * 4; // Учитываем разницу в долготе
    
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

// Функция для быстрого фильтра по статусу
window.filterByStatus = function(status) {
    const statusSelect = document.getElementById('filter-status');
    if (!statusSelect) return;
    
    // Сбрасываем все выборы
    Array.from(statusSelect.options).forEach(option => {
        option.selected = false;
    });
    
    // Выбираем указанный статус
    Array.from(statusSelect.options).forEach(option => {
        if (option.value === status) {
            option.selected = true;
        }
    });
    
    applyFilters();
    showNotification(`Применен фильтр: ${status}`, 'success');
};

// Инициализация дополнительных обработчиков
setTimeout(() => {
    // Добавляем стили для анимации пульсации
    const style = document.createElement('style');
    style.textContent = `
        @keyframes pulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.1); }
            100% { transform: scale(1); }
        }
        
        .custom-marker:hover {
            animation: pulse 0.5s infinite;
            transform: scale(1.1);
            z-index: 1000 !important;
        }
        
        .legend-item:hover {
            transform: translateX(5px);
            box-shadow: 0 3px 8px rgba(0,0,0,0.1);
        }
    `;
    document.head.appendChild(style);
    
    console.log('ADTS Карта успешно инициализирована');
}, 1000);


