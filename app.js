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

// ========== ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ==========

function initApp() {
    console.log('Инициализация приложения...');
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
                
                let color = CONFIG.STATUS_COLORS.default;
                const statuses = markers.map(m => m.options.status);
                
                if (statuses.includes('Закрыта')) {
                    color = CONFIG.STATUS_COLORS['Закрыта'] || '#e74c3c';
                } else if (statuses.includes('На паузе')) {
                    color = CONFIG.STATUS_COLORS['На паузе'] || '#f39c12';
                } else if (statuses.includes('Активная')) {
                    color = CONFIG.STATUS_COLORS['Активная'] || '#2ecc71';
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

// ========== ЗАГРУЗКА ДАННЫХ ==========

async function loadData() {
    if (isLoading) return;
    
    isLoading = true;
    
    try {
        updateStatus('Загрузка данных...');
        showModal('Загрузка', 'Подключение к Google Таблице...');
        
        console.log('Начинаю загрузку данных...');
        const data = await loadDataAsCSV();
        
        if (!data || data.length === 0) {
            throw new Error('Не удалось загрузить данные');
        }
        
        console.log(`Данные загружены: ${data.length} строк, ${data[0]?.length || 0} столбцов`);
        console.log('Первые 3 строки данных:', data.slice(0, 3));
        
        allPoints = processData(data);
        console.log(`Обработано точек: ${allPoints.length}`);
        
        // Показываем несколько точек для отладки
        if (allPoints.length > 0) {
            console.log('Примеры обработанных точек:');
            allPoints.slice(0, 5).forEach((point, i) => {
                console.log(`${i+1}. Название: "${point.name}" | Регион: "${point.region}" | Статус: "${point.status}" | Адрес: "${point.address?.substring(0, 50)}..."`);
            });
        }
        
        allPoints = await addCoordinatesFast(allPoints);
        console.log(`Координаты добавлены: ${allPoints.length}`);
        
        updateFilters();
        updateStatistics();
        updateLegend();
        showPointsOnMap();
        
        closeModal();
        updateStatus(`Загружено: ${allPoints.length} точек`);
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

function processData(rows) {
    console.log('Начинаю обработку данных...');
    
    if (!rows || rows.length < 2) {
        return [];
    }
    
    const points = [];
    const headers = rows[0].map(h => h.toString().trim());
    
    // Выводим заголовки для отладки
    console.log('Заголовки столбцов:', headers);
    console.log('Количество столбцов:', headers.length);
    
    // Пытаемся найти правильные индексы столбцов
    const colIndices = findColumnIndices(headers);
    console.log('Найденные индексы столбцов:', colIndices);
    
    // Если у нас мало столбцов или они не распознаны, используем простой подход
    const useSimpleApproach = headers.length < 3 || 
                              Object.values(colIndices).filter(idx => idx !== -1).length < 3;
    
    if (useSimpleApproach) {
        console.log('Использую простой подход к парсингу данных');
        return processDataSimple(rows);
    }
    
    // Используем продвинутый подход с распознаванием столбцов
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
            originalAddress: '',
            originalStatus: ''
        };
        
        // Заполняем данные по найденным индексам
        Object.keys(colIndices).forEach(key => {
            const index = colIndices[key];
            if (index !== -1 && index < row.length) {
                const value = row[index].toString().trim();
                if (value && value !== 'undefined' && value !== 'null') {
                    point[key] = value;
                }
            }
        });
        
        // Очищаем данные
        point.name = cleanString(point.name);
        point.region = cleanString(point.region);
        point.address = cleanString(point.address);
        point.status = cleanString(point.status);
        point.manager = cleanString(point.manager);
        point.contractor = cleanString(point.contractor);
        
        // Сохраняем оригинальный адрес
        point.originalAddress = point.address || '';
        
        // Нормализуем статус
        if (point.status && CONFIG.STATUS_MAPPING) {
            point.originalStatus = point.status;
            point.status = CONFIG.STATUS_MAPPING[point.status] || point.status;
        }
        
        // Исправляем возможные ошибки в данных
        
        // Если адрес пустой, но есть данные в других полях
        if (!point.address && point.region && point.region.includes(',')) {
            // Возможно, адрес попал в поле региона
            point.address = point.region;
            point.region = '';
        }
        
        // Если статус содержит запятые и похож на объединенные данные
        if (point.status && point.status.includes(',') && point.status.length > 20) {
            const parts = point.status.split(',');
            if (parts.length >= 2) {
                point.status = parts[0].trim();
                if (!point.manager && parts[1]) {
                    point.manager = parts[1].trim();
                }
                if (!point.contractor && parts[2]) {
                    point.contractor = parts[2].trim();
                }
            }
        }
        
        // Если у точки нет имени, создаем его
        if (!point.name || point.name.trim() === '') {
            if (point.address) {
                const firstPart = point.address.split(',')[0];
                point.name = firstPart.trim().substring(0, 30) + (firstPart.length > 30 ? '...' : '');
            } else if (point.region) {
                point.name = point.region + ' - Точка ' + i;
            } else {
                point.name = 'Точка ' + i;
            }
        }
        
        // Добавляем точку, если есть минимальные данные
        if (point.name && (point.address || point.region || point.status)) {
            points.push(point);
        }
    }
    
    console.log(`Обработано точек (продвинутый метод): ${points.length}`);
    return points;
}

function processDataSimple(rows) {
    console.log('Использую простой метод обработки данных...');
    
    const points = [];
    const headers = rows[0] || [];
    
    // Определяем вероятный порядок столбцов на основе заголовков
    let nameIndex = 0;
    let regionIndex = -1;
    let addressIndex = -1;
    let statusIndex = -1;
    
    headers.forEach((header, index) => {
        const h = header.toLowerCase();
        if (h.includes('регион')) regionIndex = index;
        else if (h.includes('адрес')) addressIndex = index;
        else if (h.includes('статус')) statusIndex = index;
    });
    
    // Если не нашли явные заголовки, предполагаем порядок
    if (regionIndex === -1 && headers.length > 1) regionIndex = 1;
    if (addressIndex === -1 && headers.length > 2) addressIndex = 2;
    if (statusIndex === -1 && headers.length > 3) statusIndex = 3;
    
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
            isMock: true
        };
        
        // Заполняем данные по индексам
        if (row.length > nameIndex) point.name = cleanString(row[nameIndex]);
        if (regionIndex !== -1 && row.length > regionIndex) point.region = cleanString(row[regionIndex]);
        if (addressIndex !== -1 && row.length > addressIndex) point.address = cleanString(row[addressIndex]);
        if (statusIndex !== -1 && row.length > statusIndex) point.status = cleanString(row[statusIndex]);
        
        // Остальные поля (менеджер, подрядчик) - в следующих столбцах
        if (row.length > 4) point.manager = cleanString(row[4]);
        if (row.length > 5) point.contractor = cleanString(row[5]);
        
        // Нормализуем статус
        if (point.status && CONFIG.STATUS_MAPPING) {
            point.originalStatus = point.status;
            point.status = CONFIG.STATUS_MAPPING[point.status] || point.status;
        }
        
        // Если адрес содержит несколько частей через ",," - разбираем
        if (point.address && point.address.includes(',,')) {
            const parts = point.address.split(',,');
            point.address = parts[0] || '';
            if (!point.status && parts[1]) {
                point.status = parts[1];
                if (CONFIG.STATUS_MAPPING[point.status]) {
                    point.status = CONFIG.STATUS_MAPPING[point.status];
                }
            }
            if (!point.manager && parts[2]) point.manager = parts[2];
            if (!point.contractor && parts[3]) point.contractor = parts[3];
        }
        
        // Если нет имени, создаем
        if (!point.name || point.name.trim() === '') {
            if (point.address) {
                const firstPart = point.address.split(',')[0];
                point.name = firstPart.trim().substring(0, 30) + (firstPart.length > 30 ? '...' : '');
            } else if (point.region) {
                point.name = point.region + ' - Точка ' + i;
            } else {
                point.name = 'Точка ' + i;
            }
        }
        
        // Добавляем точку
        if (point.name) {
            points.push(point);
        }
    }
    
    console.log(`Обработано точек (простой метод): ${points.length}`);
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
        contractor: -1
    };
    
    const headersLower = headers.map(h => h.toString().toLowerCase().trim());
    
    // Поиск по ключевым словам
    headersLower.forEach((header, index) => {
        if (header.includes('название') || header.includes('имя') || header.includes('точка')) {
            if (indices.name === -1) indices.name = index;
        }
        if (header.includes('регион') || header.includes('область') || header.includes('край')) {
            if (indices.region === -1) indices.region = index;
        }
        if (header.includes('адрес') || header.includes('улица') || header.includes('местоположение')) {
            if (indices.address === -1) indices.address = index;
        }
        if (header.includes('статус')) {
            if (indices.status === -1) indices.status = index;
        }
        if (header.includes('менеджер') || header.includes('ответственный')) {
            if (indices.manager === -1) indices.manager = index;
        }
        if (header.includes('подрядчик') || header.includes('исполнитель')) {
            if (indices.contractor === -1) indices.contractor = index;
        }
    });
    
    // Если некоторые столбцы не найдены, используем порядок по умолчанию
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
    console.log('⚡ Быстрое добавление координат...');
    
    return points.map(point => {
        if (!point.lat || !point.lng) {
            // Используем регион из точки для генерации координат
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
    console.log('Показываю точки на карте...');
    
    markerCluster.clearLayers();
    markersMap.clear();
    
    const filteredPoints = filterPoints();
    console.log(`Фильтровано точек: ${filteredPoints.length}`);
    
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
}

function createMarker(point) {
    let color = CONFIG.STATUS_COLORS.default;
    const status = point.status || '';
    const statusLower = status.toLowerCase();
    
    if (status === 'Активная' || statusLower.includes('сдан') || statusLower.includes('актив')) {
        color = CONFIG.STATUS_COLORS['Активная'] || '#2ecc71';
    } else if (status === 'На паузе' || statusLower.includes('пауз') || statusLower.includes('отправлен')) {
        color = CONFIG.STATUS_COLORS['На паузе'] || '#f39c12';
    } else if (status === 'Закрыта' || statusLower.includes('закрыт')) {
        color = CONFIG.STATUS_COLORS['Закрыта'] || '#e74c3c';
    } else if (status === 'План' || statusLower.includes('план')) {
        color = CONFIG.STATUS_COLORS['План'] || '#3498db';
    }
    
    let accuracyIcon = '';
    if (point.isMock) {
        accuracyIcon = '<div style="position: absolute; top: -2px; right: -2px; width: 10px; height: 10px; background: #f39c12; border-radius: 50%; border: 2px solid white;"></div>';
    }
    
    const icon = L.divIcon({
        html: `
            <div style="position: relative;">
                <div style="
                    background: ${color};
                    width: 30px;
                    height: 30px;
                    border-radius: 50%;
                    border: 3px solid white;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-weight: bold;
                    font-size: 12px;
                ">
                    ${point.name ? point.name.charAt(0).toUpperCase() : 'Т'}
                </div>
                ${accuracyIcon}
            </div>
        `,
        className: 'custom-marker',
        iconSize: [30, 30],
        iconAnchor: [15, 30]
    });
    
    const marker = L.marker([point.lat, point.lng], {
        icon: icon,
        title: point.name,
        status: point.status,
        pointId: point.id,
        isMock: point.isMock || false
    });
    
    marker.bindPopup(createPopupContent(point));
    marker.on('click', function() {
        showPointDetails(point);
    });
    
    return marker;
}

function createPopupContent(point) {
    const color = CONFIG.STATUS_COLORS[point.status] || CONFIG.STATUS_COLORS.default;
    
    let displayAddress = point.address || '';
    if (displayAddress) {
        displayAddress = displayAddress.replace(/^\d{6},?\s*/, '');
        displayAddress = displayAddress.replace(/"/g, '');
        displayAddress = displayAddress.trim();
    }
    
    let accuracyInfo = '';
    if (point.isMock) {
        accuracyInfo = `
            <div style="margin-top: 10px; padding: 5px; background: #f39c12; color: white; border-radius: 3px; font-size: 11px;">
                <i class="fas fa-exclamation-triangle"></i> Приблизительные координаты
            </div>
        `;
    }
    
    return `
        <div style="min-width: 250px; max-width: 300px;">
            <h4 style="margin: 0 0 10px 0; color: #2c3e50; border-bottom: 2px solid ${color}; padding-bottom: 5px;">
                ${point.name || 'Без названия'}
            </h4>
            
            <div style="margin-bottom: 10px;">
                <strong>Статус:</strong> 
                <span style="color: ${color}; font-weight: 500;">${point.status || 'Не указан'}</span>
            </div>
            
            ${displayAddress ? `
                <div style="margin-bottom: 10px;">
                    <strong>📍 Адрес:</strong><br>
                    <span style="font-size: 14px;">${displayAddress}</span>
                </div>
            ` : ''}
            
            ${point.region ? `
                <div style="margin-bottom: 10px;">
                    <strong>Регион:</strong><br>
                    <span style="font-size: 14px;">${point.region}</span>
                </div>
            ` : ''}
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px;">
                ${point.manager ? `
                    <div>
                        <strong>Менеджер:</strong><br>
                        ${point.manager}
                    </div>
                ` : ''}
                
                ${point.contractor ? `
                    <div>
                        <strong>Подрядчик:</strong><br>
                        ${point.contractor}
                    </div>
                ` : ''}
            </div>
            
            ${point.lat && point.lng ? `
                <div style="margin-top: 10px; font-size: 11px; color: #7f8c8d;">
                    <strong>Координаты:</strong> ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}
                </div>
            ` : ''}
            
            ${accuracyInfo}
        </div>
    `;
}

// ========== ФИЛЬТРАЦИЯ ==========

function updateFilters() {
    console.log('Обновляю фильтры...');
    
    const filters = {
        projects: new Set(),
        regions: new Set(),
        statuses: new Set(),
        managers: new Set()
    };
    
    allPoints.forEach(point => {
        if (point.project) filters.projects.add(point.project);
        if (point.region) filters.regions.add(point.region);
        if (point.status) filters.statuses.add(point.status);
        if (point.manager) filters.managers.add(point.manager);
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
    console.log('Применяю фильтры...');
    
    activeFilters.projects = getSelectedValues('filter-project');
    activeFilters.regions = getSelectedValues('filter-region');
    activeFilters.statuses = getSelectedValues('filter-status');
    activeFilters.managers = getSelectedValues('filter-manager');
    
    showPointsOnMap();
    showNotification('Фильтры применены', 'success');
}

function clearFilters() {
    console.log('Сбрасываю фильтры...');
    
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
            { key: 'status', value: point.status, active: activeFilters.statuses },
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
    
    console.log(`Поиск: "${query}"`);
    
    const results = allPoints.filter(point => {
        return (
            (point.name && point.name.toLowerCase().includes(query)) ||
            (point.address && point.address.toLowerCase().includes(query)) ||
            (point.region && point.region.toLowerCase().includes(query)) ||
            (point.manager && point.manager.toLowerCase().includes(query))
        );
    });
    
    console.log(`Найдено результатов: ${results.length}`);
    
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

// ========== ИНФОРМАЦИЯ О ТОЧКЕ ==========

function showPointDetails(point) {
    const container = document.getElementById('point-details');
    const infoSection = document.getElementById('point-info');
    
    if (!container || !infoSection) return;
    
    let color = CONFIG.STATUS_COLORS.default;
    const status = point.status || '';
    
    if (status === 'Активная') {
        color = CONFIG.STATUS_COLORS['Активная'] || '#2ecc71';
    } else if (status === 'На паузе') {
        color = CONFIG.STATUS_COLORS['На паузе'] || '#f39c12';
    }
    
    container.innerHTML = `
        <div style="margin-bottom: 15px;">
            <h5 style="color: white; margin-bottom: 5px;">${point.name || 'Без названия'}</h5>
            ${point.status ? `
                <span style="background: ${color}; color: white; padding: 2px 8px; border-radius: 12px; font-size: 12px;">
                    ${point.status}
                </span>
            ` : ''}
        </div>
        
        <div style="background: rgba(255,255,255,0.1); padding: 10px; border-radius: 6px; margin-bottom: 15px;">
            ${point.address ? `
                <p style="margin-bottom: 8px;">
                    <strong>📍 Адрес:</strong><br>
                    <span style="font-size: 14px;">${point.address.substring(0, 100)}${point.address.length > 100 ? '...' : ''}</span>
                </p>
            ` : ''}
            
            ${point.region ? `
                <p style="margin-bottom: 8px;">
                    <strong>Регион:</strong><br>
                    <span style="font-size: 14px;">${point.region}</span>
                </p>
            ` : ''}
            
            ${point.lat && point.lng ? `
                <p style="margin: 0;">
                    <strong>Координаты:</strong> ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}
                </p>
            ` : ''}
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 13px;">
            ${point.manager ? `
                <div>
                    <strong>Менеджер:</strong><br>
                    ${point.manager}
                </div>
            ` : ''}
            
            ${point.contractor ? `
                <div>
                    <strong>Подрядчик:</strong><br>
                    ${point.contractor}
                </div>
            ` : ''}
        </div>
        
        ${point.isMock ? `
            <div style="margin-top: 15px; padding: 8px; background: #f39c12; color: white; border-radius: 6px; font-size: 12px;">
                <i class="fas fa-exclamation-triangle"></i> Приблизительные координаты
            </div>
        ` : ''}
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
    
    if (totalPointsElement) totalPointsElement.textContent = allPoints.length;
    if (shownPointsElement) shownPointsElement.textContent = shownPoints;
    if (accuracyElement) accuracyElement.textContent = `${exactPoints}/${approximatePoints}`;
}

function updateLegend() {
    const container = document.getElementById('legend');
    if (!container) return;
    
    let legendHTML = '';
    const statuses = new Set();
    
    allPoints.forEach(point => {
        if (point.status) statuses.add(point.status);
    });
    
    ['Активная', 'На паузе', 'Закрыта', 'План'].forEach(status => {
        if (!statuses.has(status)) statuses.add(status);
    });
    
    Array.from(statuses).sort().forEach(status => {
        let color = CONFIG.STATUS_COLORS[status] || CONFIG.STATUS_COLORS.default;
        
        legendHTML += `
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                <div style="width: 15px; height: 15px; border-radius: 50%; background: ${color}; border: 2px solid white;"></div>
                <span style="font-size: 12px;">${status}</span>
            </div>
        `;
    });
    
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
    console.log('Показываем демо-данные...');
    
    allPoints = [
        {
            id: 'demo_1',
            name: 'Магнит №123',
            region: 'Москва',
            address: 'ул. Тверская, д. 1',
            status: 'Активная',
            manager: 'Иванов И.И.',
            contractor: 'Иванов И.И.',
            lat: 55.7570,
            lng: 37.6145,
            isMock: false
        },
        {
            id: 'demo_2',
            name: 'Магнит №124',
            region: 'Московская обл.',
            address: 'г. Химки, ул. Ленина, 25',
            status: 'Активная',
            manager: 'Иванов И.И.',
            contractor: 'Иванов И.И.',
            lat: 55.8890,
            lng: 37.4450,
            isMock: false
        },
        {
            id: 'demo_3',
            name: 'Басенджи',
            region: 'Алтайский край',
            address: 'Алтайский край, Мамонтово (с), ул. Партизанская, 158',
            status: 'Активная',
            manager: 'Казак Светлана',
            contractor: 'Дмитриев Александр',
            lat: 53.3481 + (Math.random() - 0.5) * 0.5,
            lng: 83.7794 + (Math.random() - 0.5) * 1.0,
            isMock: true
        }
    ];
    
    updateFilters();
    updateStatistics();
    updateLegend();
    showPointsOnMap();
    
    updateStatus('Демо-данные загружены');
    showNotification('Используются демо-данные', 'warning');
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

function getRandomCoordinate(address, region = '') {
    // Базовая карта координат центров регионов
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
    
    // Радиусы для разных типов регионов (в градусах)
    const regionRadii = {
        'город': 0.05,        // Москва, СПб, города
        'край': 0.5,          // Края
        'область': 0.3,       // Области
        'республика': 0.4,    // Республики
        'ао': 1.0,            // Автономные округа
        'default': 0.3        // По умолчанию
    };
    
    let baseLat = 55.7558;
    let baseLng = 37.6173;
    let radius = 0.3;
    
    // Получаем регион из параметра
    const regionStr = (region || '').toString().trim();
    
    if (!regionStr) {
        console.log('⚠️ Регион не указан, использую центр России');
        radius = regionRadii.default;
    } else {
        let found = false;
        
        // Нормализуем регион для поиска
        const normalizedRegion = regionStr.toLowerCase();
        
        // Ищем точное совпадение
        for (const [key, coords] of Object.entries(regionCenters)) {
            if (normalizedRegion === key.toLowerCase()) {
                baseLat = coords.lat;
                baseLng = coords.lng;
                console.log(`✅ Найдено точное совпадение: ${key}`);
                found = true;
                break;
            }
        }
        
        // Если не нашли точного совпадения, ищем частичное
        if (!found) {
            for (const [key, coords] of Object.entries(regionCenters)) {
                const keyLower = key.toLowerCase();
                
                // Проверяем содержит ли регион ключевые слова
                if (normalizedRegion.includes(keyLower) || keyLower.includes(normalizedRegion)) {
                    baseLat = coords.lat;
                    baseLng = coords.lng;
                    console.log(`✅ Найдено частичное совпадение: ${key}`);
                    found = true;
                    break;
                }
                
                // Проверяем первые слова
                const regionFirstWord = normalizedRegion.split(' ')[0];
                const keyFirstWord = keyLower.split(' ')[0];
                
                if (regionFirstWord === keyFirstWord && regionFirstWord.length > 3) {
                    baseLat = coords.lat;
                    baseLng = coords.lng;
                    console.log(`✅ Найдено по первому слову: ${key}`);
                    found = true;
                    break;
                }
            }
        }
        
        // Определяем радиус на основе типа региона
        if (normalizedRegion.includes('москва') || 
            normalizedRegion.includes('санкт-петербург') ||
            normalizedRegion.includes('сочи') ||
            normalizedRegion.includes('новосибирск')) {
            radius = regionRadii.город;
        } else if (normalizedRegion.includes('край')) {
            radius = regionRadii.край;
        } else if (normalizedRegion.includes('обл') || 
                  normalizedRegion.includes('область')) {
            radius = regionRadii.область;
        } else if (normalizedRegion.includes('респ') || 
                  normalizedRegion.includes('республика')) {
            radius = regionRadii.республика;
        } else if (normalizedRegion.includes('хмао') || 
                  normalizedRegion.includes('янао') ||
                  normalizedRegion.includes('ао')) {
            radius = regionRadii.ао;
        } else {
            radius = regionRadii.default;
        }
        
        if (!found) {
            console.log(`⚠️ Регион "${regionStr}" не найден, использую центр России`);
        }
    }
    
    // Добавляем случайное смещение в пределах региона
    const randomLat = baseLat + (Math.random() - 0.5) * radius * 2;
    const randomLng = baseLng + (Math.random() - 0.5) * radius * 3;
    
    console.log(`📍 Координаты: ${randomLat.toFixed(6)}, ${randomLng.toFixed(6)} (радиус: ${radius})`);
    
    return {
        lat: randomLat,
        lng: randomLng,
        source: 'approximate',
        isExact: false,
        isMock: true,
        region: regionStr
    };
}

// ========== ЭКСПОРТ ФУНКЦИЙ ==========

window.loadData = loadData;
window.clearFilters = clearFilters;
window.applyFilters = applyFilters;
window.searchPoints = searchPoints;
window.closeModal = closeModal;
