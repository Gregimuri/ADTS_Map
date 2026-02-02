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
        
        console.log(`Данные загружены: ${data.length} строк`);
        allPoints = processData(data);
        console.log(`Обработано точек: ${allPoints.length}`);
        
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

function processData(rows) {
    console.log('Начинаю обработку данных...');
    
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
        
        Object.keys(colIndices).forEach(key => {
            const index = colIndices[key];
            if (index !== -1 && index < row.length && row[index]) {
                const value = row[index].toString().trim();
                if (value) point[key] = value;
            }
        });
        
        // Сохраняем оригинальный адрес
        point.originalAddress = point.address || '';
        
        if (point.status && CONFIG.STATUS_MAPPING) {
            point.originalStatus = point.status;
            point.status = CONFIG.STATUS_MAPPING[point.status] || point.status;
        }
        
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
        
        if (point.name || point.address || point.region) {
            points.push(point);
        }
    }
    
    console.log(`Обработано точек: ${points.length}`);
    return points;
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
    
    const exactMatches = {
        'название тт': 'name',
        'регион': 'region', 
        'адрес': 'address',
        'статус тт': 'status',
        'статус': 'status',
        'менеджер фио': 'manager',
        'менеджер': 'manager',
        'подрядчик фио': 'contractor',
        'подрядчик': 'contractor'
    };
    
    headersLower.forEach((header, index) => {
        if (exactMatches[header]) {
            const field = exactMatches[header];
            if (indices[field] === -1) {
                indices[field] = index;
            }
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
    console.log('⚡ Быстрое добавление координат...');
    
    return points.map(point => {
        if (!point.lat || !point.lng) {
            const coords = getRandomCoordinate(point.address, point.region);
            return { ...point, ...coords, isMock: true };
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
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px;">
                ${point.region ? `
                    <div>
                        <strong>Регион:</strong><br>
                        ${point.region}
                    </div>
                ` : ''}
                
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
            
            ${point.lat && point.lng ? `
                <p style="margin: 0;">
                    <strong>Координаты:</strong> ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}
                </p>
            ` : ''}
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 13px;">
            ${point.region ? `
                <div>
                    <strong>Регион:</strong><br>
                    ${point.region}
                </div>
            ` : ''}
            
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
    const regionCoords = {
        'Москва': { lat: 55.7558, lng: 37.6173, radius: 0.03 },
        'Московская': { lat: 55.7558, lng: 37.6173, radius: 0.2 },
        'Санкт-Петербург': { lat: 59.9343, lng: 30.3351, radius: 0.03 },
        'Ленинградская': { lat: 59.9343, lng: 30.3351, radius: 0.2 },
        'Алтайский': { lat: 53.3481, lng: 83.7794, radius: 0.3 },
        'Краснодарский': { lat: 45.0355, lng: 38.9753, radius: 0.2 },
        'Свердловская': { lat: 56.8389, lng: 60.6057, radius: 0.2 },
        'Ростовская': { lat: 47.2224, lng: 39.7189, radius: 0.2 },
        'Татарстан': { lat: 55.7961, lng: 49.1064, radius: 0.2 },
        'Челябинская': { lat: 55.1644, lng: 61.4368, radius: 0.2 },
        'Архангельская': { lat: 64.5393, lng: 40.5187, radius: 0.5 },
        'Астраханская': { lat: 46.3479, lng: 48.0336, radius: 0.3 },
        'Белгородская': { lat: 50.5952, lng: 36.5872, radius: 0.2 },
        'Брянская': { lat: 53.2434, lng: 34.3642, radius: 0.2 },
        'Владимирская': { lat: 56.1290, lng: 40.4070, radius: 0.2 },
        'default': { lat: 55.7558, lng: 37.6173, radius: 2.0 }
    };
    
    let baseLat = 55.7558;
    let baseLng = 37.6173;
    let radius = 2.0;
    
    const searchText = (region || address || '').toLowerCase();
    
    for (const [key, coords] of Object.entries(regionCoords)) {
        if (searchText.includes(key.toLowerCase())) {
            baseLat = coords.lat;
            baseLng = coords.lng;
            radius = coords.radius;
            console.log(`📍 Приблизительные координаты для региона ${key}`);
            break;
        }
    }
    
    // Добавляем случайное смещение в пределах региона
    const randomLat = baseLat + (Math.random() - 0.5) * radius;
    const randomLng = baseLng + (Math.random() - 0.5) * radius * 2;
    
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
