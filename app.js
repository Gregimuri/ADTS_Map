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
        
        // Улучшенная кластеризация с цветами статусов
        markerCluster = L.markerClusterGroup({
            maxClusterRadius: 40,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: true,
            zoomToBoundsOnClick: true,
            chunkedLoading: true,
            chunkInterval: 100,
            iconCreateFunction: function(cluster) {
                const count = cluster.getChildCount();
                const markers = cluster.getAllChildMarkers();
                
                // Анализируем статусы в кластере
                const statusCounts = {};
                markers.forEach(marker => {
                    const status = marker.options.status || 'Не указан';
                    statusCounts[status] = (statusCounts[status] || 0) + 1;
                });
                
                // Находим доминирующий статус
                let dominantStatus = 'Не указан';
                let maxCount = 0;
                Object.entries(statusCounts).forEach(([status, count]) => {
                    if (count > maxCount) {
                        maxCount = count;
                        dominantStatus = status;
                    }
                });
                
                // Получаем цвет для доминирующего статуса
                let color = getStatusColor(dominantStatus);
                
                // Размер кластера в зависимости от количества точек
                let size = 40;
                if (count > 10) size = 50;
                if (count > 50) size = 60;
                if (count > 100) size = 70;
                
                return L.divIcon({
                    html: `
                        <div style="
                            background: ${color};
                            width: ${size}px;
                            height: ${size}px;
                            border-radius: 50%;
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            justify-content: center;
                            color: white;
                            font-weight: bold;
                            border: 3px solid white;
                            box-shadow: 0 3px 10px rgba(0,0,0,0.3);
                            position: relative;
                            overflow: hidden;
                        ">
                            <div style="font-size: ${count > 99 ? '16px' : '18px'}; line-height: 1;">
                                ${count}
                            </div>
                            <div style="font-size: 9px; opacity: 0.9; margin-top: 2px;">
                                ${dominantStatus.substring(0, 10)}${dominantStatus.length > 10 ? '...' : ''}
                            </div>
                            <!-- Индикатор смешанного статуса -->
                            ${Object.keys(statusCounts).length > 1 ? 
                                `<div style="position: absolute; bottom: 2px; width: 80%; height: 3px; background: linear-gradient(90deg, ${Object.keys(statusCounts).slice(0, 3).map(s => getStatusColor(s)).join(', ')}); border-radius: 2px;"></div>` 
                                : ''}
                        </div>
                    `,
                    className: 'custom-cluster',
                    iconSize: [size, size],
                    iconAnchor: [size/2, size/2]
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
    
    // Используем более умный подход для ADTS данных
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        
        if (!row || row.length === 0) {
            continue;
        }
        
        // Проверяем, что строка содержит хотя бы какие-то данные
        const hasData = row.some(cell => cell && cell.toString().trim() !== '');
        if (!hasData) {
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
        
        // ВАЖНО: Исправляем обработку строк типа "2,,Выполнен,Майшева София,Гаптуллазянов Раушан"
        // Ищем название в первом значимом столбце
        for (let j = 0; j < Math.min(row.length, 6); j++) {
            const cell = row[j] ? row[j].toString().trim() : '';
            
            if (cell && cell !== '') {
                // Если ячейка содержит только цифры - это может быть индекс, пропускаем
                if (/^\d+$/.test(cell)) {
                    continue;
                }
                
                // Определяем тип данных по содержанию
                if (!point.name && cell.length > 2 && !cell.includes(',')) {
                    // Название обычно короткое и без запятых
                    point.name = cell;
                } 
                else if (!point.address && (cell.includes('ул.') || cell.includes('д.') || cell.includes('г.') || cell.includes('с.'))) {
                    // Адрес содержит указатели
                    point.address = cell;
                }
                else if (!point.region && (cell.includes('область') || cell.includes('край') || cell.includes('обл.') || 
                         cell.includes('Москва') || cell.includes('Санкт-Петербург'))) {
                    // Регион
                    point.region = cell;
                }
                else if (!point.status && (cell.includes('Выполнен') || cell.includes('Очередь') || 
                         cell.includes('Первичный') || cell.includes('Финальный') || 
                         cell.includes('Нет оборудования') || cell.includes('Доработка'))) {
                    // Статус
                    point.status = cell;
                    point.originalStatus = cell;
                }
                else if (!point.manager && cell.includes(' ') && /[А-Яа-я]+\s+[А-Яа-я]/.test(cell)) {
                    // ФИО менеджера
                    point.manager = cell;
                }
                else if (!point.contractor && cell.includes(' ') && /[А-Яа-я]+\s+[А-Яа-я]/.test(cell) && !point.manager) {
                    // ФИО подрядчика (если менеджера еще нет, это может быть менеджер)
                    if (!point.manager) {
                        point.manager = cell;
                    } else {
                        point.contractor = cell;
                    }
                }
                else if (!point.project && (cell.includes('ADTS') || cell.includes('Проект') || cell.includes('проект'))) {
                    // Проект
                    point.project = cell;
                }
            }
        }
        
        // Если не удалось определить название, создаем из других данных
        if (!point.name || point.name.trim() === '') {
            if (point.address) {
                // Берем первую часть адреса до запятой
                const addressParts = point.address.split(',');
                if (addressParts[0]) {
                    point.name = addressParts[0].trim();
                    // Убираем возможные префиксы
                    point.name = point.name.replace(/^(г\.|с\.|ул\.|д\.)\s*/i, '');
                }
            } else if (point.region) {
                point.name = point.region.split(',')[0].trim() + ' - ADTS';
            } else {
                point.name = `Точка ADTS ${i}`;
            }
        }
        
        // Убираем лишние символы и пробелы
        point.name = cleanString(point.name);
        point.region = cleanString(point.region);
        point.address = cleanString(point.address);
        point.status = cleanString(point.status);
        point.manager = cleanString(point.manager);
        point.contractor = cleanString(point.contractor);
        point.project = cleanString(point.project);
        
        // Обработка специфичного случая с неправильными данными
        if (point.address && point.address.includes(',,')) {
            const parts = point.address.split(',,');
            if (parts.length >= 3) {
                point.address = parts[0] || '';
                if (!point.status && parts[1]) point.status = parts[1];
                if (!point.manager && parts[2]) point.manager = parts[2];
                if (!point.contractor && parts[3]) point.contractor = parts[3];
            }
        }
        
        // Нормализуем статус для ADTS
        if (point.status) {
            point.originalStatus = point.status;
            point.status = normalizeADTSStatus(point.status);
        }
        
        // Фильтруем явно некорректные данные
        if (point.name && point.name !== 'undefined' && point.name !== 'null') {
            // Проверяем, что это реальные данные, а не заголовки или мусор
            const isInvalid = point.name.includes('Заголовок') || 
                             point.name.includes('Название') || 
                             point.name.length < 2 ||
                             /^[^А-Яа-я]*$/.test(point.name); // Только не-кириллические символы
            
            if (!isInvalid) {
                points.push(point);
            }
        }
    }
    
    console.log(`Обработано точек ADTS: ${points.length}`);
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
        .replace(/^\d+,/, '') // Убираем цифры в начале с запятой
        .replace(/^[,\s]+/, '') // Убираем запятые и пробелы в начале
        .replace(/[,\s]+$/, '') // Убираем запятые и пробелы в конце
        .trim();
}

// ========== БЫСТРОЕ ДОБАВЛЕНИЕ КООРДИНАТ ==========

async function addCoordinatesFast(points) {
    console.log('⚡ Быстрое добавление координат для ADTS...');
    
    return points.map(point => {
        if (!point.lat || !point.lng) {
            // Используем название как основу для координат
            const locationName = point.name || point.address || point.region || '';
            const coords = getRandomCoordinate(locationName, point.region || '');
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
    
    // Создаем маркеры для каждой точки
    filteredPoints.forEach(point => {
        if (point.lat && point.lng && !isNaN(point.lat) && !isNaN(point.lng)) {
            const marker = createMarker(point);
            if (marker) {
                markerCluster.addLayer(marker);
                markersMap.set(point.id, marker);
            }
        }
    });
    
    // Если есть точки, центрируем карту
    if (filteredPoints.length > 0 && filteredPoints.some(p => p.lat && p.lng)) {
        const validPoints = filteredPoints.filter(p => p.lat && p.lng && !isNaN(p.lat) && !isNaN(p.lng));
        
        if (validPoints.length > 0) {
            const bounds = L.latLngBounds(
                validPoints.map(p => [p.lat, p.lng])
            );
            
            if (bounds.isValid()) {
                // Если одна точка - увеличиваем зум
                if (validPoints.length === 1) {
                    map.setView([validPoints[0].lat, validPoints[0].lng], 14);
                } else {
                    map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
                }
            }
        }
    }
    
    updateStatistics();
    updateStatusStatistics();
}

function createMarker(point) {
    try {
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
            accuracyIcon = '<div style="position: absolute; top: -4px; right: -4px; width: 10px; height: 10px; background: #f39c12; border-radius: 50%; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.3);"></div>';
        }
        
        const icon = L.divIcon({
            html: `
                <div style="position: relative;">
                    <div class="custom-marker ${markerClass}" style="
                        background: ${color};
                        width: 30px;
                        height: 30px;
                        border-radius: 50%;
                        border: 2px solid white;
                        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: ${['#f1c40f'].includes(color) ? '#2c3e50' : 'white'};
                        font-weight: bold;
                        font-size: 12px;
                        transition: all 0.2s;
                        cursor: pointer;
                    ">
                        ${statusIcon}
                    </div>
                    ${accuracyIcon}
                </div>
            `,
            className: 'adts-marker',
            iconSize: [30, 30],
            iconAnchor: [15, 30]
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
        });
        
        return marker;
    } catch (error) {
        console.error('Ошибка создания маркера:', error, point);
        return null;
    }
}

function createPopupContent(point) {
    try {
        const normalizedStatus = normalizeADTSStatus(point.status);
        const color = getStatusColor(point.status);
        const statusIcon = getStatusIcon(point.status);
        
        // Форматируем адрес
        let displayAddress = point.address || '';
        if (displayAddress) {
            // Убираем почтовый индекс и лишние символы
            displayAddress = displayAddress.replace(/^\d{6},?\s*/, '');
            displayAddress = displayAddress.replace(/,,/g, ', ');
            displayAddress = displayAddress.trim();
        }
        
        let accuracyInfo = '';
        if (point.isMock) {
            accuracyInfo = `
                <div style="margin-top: 10px; padding: 6px 10px; background: #f39c12; color: white; border-radius: 4px; font-size: 11px; display: flex; align-items: center; gap: 6px;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 12px;"></i>
                    <span>Приблизительные координаты</span>
                </div>
            `;
        }
        
        return `
            <div style="min-width: 250px; max-width: 300px; font-size: 13px;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 2px solid ${color};">
                    <div style="width: 32px; height: 32px; border-radius: 50%; background: ${color}; display: flex; align-items: center; justify-content: center; color: white; font-size: 14px;">
                        ${statusIcon}
                    </div>
                    <div>
                        <div style="font-weight: 600; color: #2c3e50;">${point.name || 'Без названия'}</div>
                        <div style="font-size: 11px; color: ${color}; font-weight: 500;">${normalizedStatus}</div>
                    </div>
                </div>
                
                ${displayAddress ? `
                    <div style="margin-bottom: 8px;">
                        <div style="color: #7f8c8d; font-size: 11px; margin-bottom: 2px;">Адрес:</div>
                        <div>${displayAddress}</div>
                    </div>
                ` : ''}
                
                ${point.region ? `
                    <div style="margin-bottom: 8px;">
                        <div style="color: #7f8c8d; font-size: 11px; margin-bottom: 2px;">Регион:</div>
                        <div>${point.region}</div>
                    </div>
                ` : ''}
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px;">
                    ${point.manager ? `
                        <div>
                            <div style="color: #7f8c8d; font-size: 11px; margin-bottom: 2px;">Менеджер:</div>
                            <div style="font-size: 12px;">${point.manager}</div>
                        </div>
                    ` : ''}
                    
                    ${point.contractor ? `
                        <div>
                            <div style="color: #7f8c8d; font-size: 11px; margin-bottom: 2px;">Подрядчик:</div>
                            <div style="font-size: 12px;">${point.contractor}</div>
                        </div>
                    ` : ''}
                </div>
                
                ${accuracyInfo}
            </div>
        `;
    } catch (error) {
        console.error('Ошибка создания попапа:', error);
        return `<div>Ошибка отображения информации о точке</div>`;
    }
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
        if (normalizedStatus && normalizedStatus.trim() !== '' && normalizedStatus !== 'Не указан') {
            filters.statuses.add(normalizedStatus);
        }
        
        if (point.manager && point.manager.trim() !== '') filters.managers.add(point.manager);
    });
    
    // Сортируем фильтры для удобства
    fillFilter('filter-project', Array.from(filters.projects).sort());
    fillFilter('filter-region', Array.from(filters.regions).sort());
    fillFilter('filter-status', Array.from(filters.statuses).sort());
    fillFilter('filter-manager', Array.from(filters.managers).sort());
    
    console.log('Доступные фильтры ADTS:');
    console.log('- Статусы:', Array.from(filters.statuses));
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
                opt.style.fontWeight = '500';
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
        // Проверяем фильтр по проекту
        if (activeFilters.projects.length > 0) {
            if (!point.project || !activeFilters.projects.includes(point.project)) {
                return false;
            }
        }
        
        // Проверяем фильтр по региону
        if (activeFilters.regions.length > 0) {
            if (!point.region || !activeFilters.regions.includes(point.region)) {
                return false;
            }
        }
        
        // Проверяем фильтр по статусу (используем нормализованный статус)
        if (activeFilters.statuses.length > 0) {
            const normalizedStatus = normalizeADTSStatus(point.status);
            if (!normalizedStatus || !activeFilters.statuses.includes(normalizedStatus)) {
                return false;
            }
        }
        
        // Проверяем фильтр по менеджеру
        if (activeFilters.managers.length > 0) {
            if (!point.manager || !activeFilters.managers.includes(point.manager)) {
                return false;
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
            if (marker) {
                markerCluster.addLayer(marker);
            }
        }
    });
    
    if (results.length > 0 && results.some(p => p.lat && p.lng)) {
        const validResults = results.filter(p => p.lat && p.lng && !isNaN(p.lat) && !isNaN(p.lng));
        
        if (validResults.length > 0) {
            const bounds = L.latLngBounds(
                validResults.map(p => [p.lat, p.lng])
            );
            
            if (bounds.isValid()) {
                map.fitBounds(bounds, { padding: [50, 50] });
            }
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
        <div style="margin-bottom: 15px;">
            <h5 style="color: white; margin-bottom: 8px; font-size: 16px;">${point.name || 'Без названия'}</h5>
            <div style="background: ${color}; color: ${['#f1c40f'].includes(color) ? '#2c3e50' : 'white'}; padding: 4px 10px; border-radius: 4px; display: inline-flex; align-items: center; gap: 6px; font-size: 12px;">
                ${statusIcon} ${normalizedStatus}
            </div>
        </div>
        
        <div style="background: rgba(255,255,255,0.1); padding: 12px; border-radius: 6px; margin-bottom: 15px;">
            ${point.address ? `
                <div style="margin-bottom: 10px;">
                    <div style="color: #3498db; font-size: 12px; margin-bottom: 3px;">
                        <i class="fas fa-map-marker-alt"></i> Адрес:
                    </div>
                    <div style="font-size: 13px;">${point.address}</div>
                </div>
            ` : ''}
            
            ${point.region ? `
                <div style="margin-bottom: 10px;">
                    <div style="color: #3498db; font-size: 12px; margin-bottom: 3px;">
                        <i class="fas fa-globe"></i> Регион:
                    </div>
                    <div style="font-size: 13px;">${point.region}</div>
                </div>
            ` : ''}
            
            ${point.lat && point.lng ? `
                <div style="font-size: 11px; color: #95a5a6;">
                    Координаты: ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}
                </div>
            ` : ''}
        </div>
        
        ${point.manager || point.contractor ? `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 13px; margin-bottom: 15px;">
                ${point.manager ? `
                    <div>
                        <div style="color: #3498db; font-size: 12px; margin-bottom: 3px;">Менеджер:</div>
                        <div>${point.manager}</div>
                    </div>
                ` : ''}
                
                ${point.contractor ? `
                    <div>
                        <div style="color: #3498db; font-size: 12px; margin-bottom: 3px;">Подрядчик:</div>
                        <div>${point.contractor}</div>
                    </div>
                ` : ''}
            </div>
        ` : ''}
        
        ${point.isMock ? `
            <div style="padding: 8px; background: #f39c12; color: white; border-radius: 4px; font-size: 11px; display: flex; align-items: center; gap: 8px;">
                <i class="fas fa-exclamation-triangle"></i>
                <span>Приблизительные координаты</span>
            </div>
        ` : ''}
    `;
    
    infoSection.style.display = 'block';
}

// ========== СТАТИСТИКА ==========

function updateStatistics() {
    const filteredPoints = filterPoints();
    const shownPoints = filteredPoints.filter(p => p.lat && p.lng && !isNaN(p.lat) && !isNaN(p.lng)).length;
    const exactPoints = filteredPoints.filter(p => p.lat && p.lng && !p.isMock).length;
    const approximatePoints = filteredPoints.filter(p => p.isMock).length;
    
    const totalPointsElement = document.getElementById('total-points');
    const shownPointsElement = document.getElementById('shown-points');
    const accuracyElement = document.getElementById('accuracy-stats');
    
    if (totalPointsElement) totalPointsElement.textContent = allPoints.length;
    if (shownPointsElement) shownPointsElement.textContent = shownPoints;
    if (accuracyElement) accuracyElement.textContent = exactPoints > 0 ? `${exactPoints}` : '-';
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
                // Динамически изменяем размер индикатора
                const count = statusCounts[status];
                const maxCount = Math.max(...Object.values(statusCounts));
                if (maxCount > 0) {
                    const size = 10 + (count / maxCount) * 8;
                    const indicator = element.parentElement?.querySelector('.status-indicator');
                    if (indicator) {
                        indicator.style.width = `${size}px`;
                        indicator.style.height = `${size}px`;
                    }
                }
            }
        }
    });
}

function updateLegend() {
    const container = document.getElementById('legend');
    if (!container) return;
    
    const filteredPoints = filterPoints();
    const totalFiltered = filteredPoints.length;
    const totalAll = allPoints.length;
    
    let legendHTML = `
        <h5 style="color: #2c3e50; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
            <i class="fas fa-layer-group"></i> Кластеризация ADTS
        </h5>
        <div style="font-size: 12px; color: #7f8c8d; margin-bottom: 15px; line-height: 1.4;">
            Кластеры окрашиваются в цвет преобладающего статуса в группе точек.
            Цвета статусов:
        </div>
    `;
    
    const statuses = [
        { name: 'Выполнен', color: '#2ecc71', icon: 'check-circle' },
        { name: 'Нет оборудования', color: '#e74c3c', icon: 'times-circle' },
        { name: 'В очереди', color: '#3498db', icon: 'clock' },
        { name: 'Первичный', color: '#f1c40f', icon: 'hammer' },
        { name: 'Финальный', color: '#9b59b6', icon: 'check-double' },
        { name: 'Доработка после монтажа', color: '#95a5a6', icon: 'tools' }
    ];
    
    statuses.forEach(status => {
        const count = allPoints.filter(p => normalizeADTSStatus(p.status) === status.name).length;
        const filteredCount = filteredPoints.filter(p => normalizeADTSStatus(p.status) === status.name).length;
        
        legendHTML += `
            <div style="
                display: flex;
                align-items: center;
                justify-content: space-between;
                margin-bottom: 8px;
                padding: 6px 8px;
                background: ${status.color}10;
                border-radius: 4px;
                border-left: 3px solid ${status.color};
            ">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="
                        width: 14px;
                        height: 14px;
                        border-radius: 50%;
                        background: ${status.color};
                        border: 2px solid white;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: ${status.color === '#f1c40f' ? '#2c3e50' : 'white'};
                        font-size: 7px;
                    ">
                        <i class="fas fa-${status.icon}"></i>
                    </div>
                    <span style="font-size: 12px; color: #2c3e50;">${status.name}</span>
                </div>
                <div style="font-size: 11px; color: #7f8c8d;">
                    ${filteredCount}/${count}
                </div>
            </div>
        `;
    });
    
    legendHTML += `
        <div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid #eee; font-size: 11px; color: #7f8c8d;">
            <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span>Показано:</span>
                <span style="font-weight: 600; color: #2c3e50;">${totalFiltered}</span>
            </div>
            <div style="display: flex; justify-content: space-between;">
                <span>Всего точек:</span>
                <span style="font-weight: 600; color: #2c3e50;">${totalAll}</span>
            </div>
        </div>
        <div style="margin-top: 10px; font-size: 10px; color: #95a5a6; text-align: center;">
            <i class="fas fa-info-circle"></i> Нажмите на кластер для детализации
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
            name: 'Магазин №101',
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
            name: 'Супермаркет №202',
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
            name: 'Гипермаркет №303',
            region: 'Алтайский край',
            address: 'Алтайский край, Мамонтово (с), ул. Партизанская, 158',
            status: 'В очереди на монтаж',
            manager: 'Казак Светлана',
            contractor: 'Дмитриев Александр',
            project: 'ADTS Сибирь',
            lat: 53.3481,
            lng: 83.7794,
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

function getRandomCoordinate(locationName, region = '') {
    // Упрощенная версия для демо
    let baseLat = 55.7558;
    let baseLng = 37.6173;
    
    // Простая эвристика для разных регионов
    if (region) {
        const regionLower = region.toLowerCase();
        if (regionLower.includes('алтай')) {
            baseLat = 52.5186;
            baseLng = 85.1019;
        } else if (regionLower.includes('краснодар')) {
            baseLat = 45.0355;
            baseLng = 38.9753;
        } else if (regionLower.includes('новосибирск')) {
            baseLat = 55.0084;
            baseLng = 82.9357;
        } else if (regionLower.includes('казань') || regionLower.includes('татарстан')) {
            baseLat = 55.7961;
            baseLng = 49.1064;
        }
    }
    
    // Добавляем небольшое случайное смещение
    const randomLat = baseLat + (Math.random() - 0.5) * 0.5;
    const randomLng = baseLng + (Math.random() - 0.5) * 1.0;
    
    return {
        lat: randomLat,
        lng: randomLng,
        source: 'approximate',
        isExact: false,
        isMock: true
    };
}

// ========== ЭКСПОРТ ФУНКЦИЙ ==========

window.loadData = loadData;
window.clearFilters = clearFilters;
window.applyFilters = applyFilters;
window.searchPoints = searchPoints;
window.closeModal = closeModal;

// Функция для быстрого фильтра по статусу (оставляем для совместимости)
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
};
