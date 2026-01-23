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
let autonomousGeocoder;
let isInitialLoad = true;
let pointsQueue = [];
let processedPointsCount = 0;
let displayedPointsCount = 0;

// ========== ИНИЦИАЛИЗАЦИЯ ПРИ ЗАГРУЗКЕ ==========
document.addEventListener('DOMContentLoaded', function() {
    initMap();
    initAutonomousGeocoder();
    loadData();
    setupAutoUpdate();
});

// ========== ИНИЦИАЛИЗАЦИЯ АВТОНОМНОГО ГЕОКОДЕРА ==========
function initAutonomousGeocoder() {
    autonomousGeocoder = new AutonomousGeocoder();
    console.log('🚀 Автономный геокодер инициализирован');
}

// ========== ИНИЦИАЛИЗАЦИЯ КАРТЫ ==========
function initMap() {
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
            
            // Определяем цвет кластера
            let color = CONFIG.STATUS_COLORS.default;
            const statuses = markers.map(m => m.options.status);
            
            if (statuses.includes('Закрыта') || statuses.includes('Отправлен ФО, не принят')) {
                color = CONFIG.STATUS_COLORS['Закрыта'] || '#e74c3c';
            } else if (statuses.includes('На паузе')) {
                color = CONFIG.STATUS_COLORS['На паузе'] || '#f39c12';
            } else if (statuses.includes('сдан') || statuses.includes('Сдан') || statuses.includes('Активная')) {
                color = CONFIG.STATUS_COLORS['сдан'] || '#2ecc71';
            }
            
            return L.divIcon({
                html: `<div style="background:${color}; color:white; width:40px; height:40px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:bold; border:3px solid white; box-shadow:0 2px 5px rgba(0,0,0,0.3);">${count}</div>`,
                className: 'custom-cluster',
                iconSize: [40, 40]
            });
        }
    }).addTo(map);
}

// ========== ЗАГРУЗКА ДАННЫХ С ПОЭТАПНЫМ ОТОБРАЖЕНИЕМ ==========
async function loadData() {
    try {
        updateStatus('Загрузка данных...');
        showModal('Загрузка', 'Подключение к Google Таблице...');
        
        // 1. Загружаем данные
        const data = await loadDataAsCSV();
        
        if (!data || data.length === 0) {
            throw new Error('Не удалось загрузить данные');
        }
        
        // 2. Обрабатываем структуру данных
        const rawPoints = processData(data);
        
        // 3. Сразу показываем точки без координат (серые)
        showPointsImmediately(rawPoints);
        
        // 4. Запускаем фоновое геокодирование с постепенным обновлением
        startProgressiveGeocoding(rawPoints);
        
        // 5. Прячем модальное окно через 2 секунды
        setTimeout(() => {
            closeModal();
            updateStatus(`Загружаю координаты... (0/${rawPoints.length})`);
        }, 2000);
        
        showNotification('Данные загружены, ищу координаты...', 'info');
        
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        updateStatus('Ошибка загрузки');
        showNotification('Ошибка загрузки данных. Пробуем еще раз...', 'error');
        
        // Пробуем альтернативный метод
        setTimeout(tryAlternativeLoad, 5000);
    }
}

// ========== ПОСТЕПЕННОЕ ГЕОКОДИРОВАНИЕ ==========
async function startProgressiveGeocoding(points) {
    console.log(`🔄 Начинаю постепенное геокодирование для ${points.length} точек`);
    
    allPoints = points;
    processedPointsCount = 0;
    displayedPointsCount = 0;
    
    // Создаем копию для обработки
    pointsQueue = [...points];
    
    // Запускаем обработку порциями
    processGeocodingBatch();
}

// ========== ОБРАБОТКА ПАКЕТА ТОЧЕК ==========
async function processGeocodingBatch() {
    if (pointsQueue.length === 0) {
        // Все точки обработаны
        updateStatus(`Готово! Обработано ${processedPointsCount} точек`);
        showNotification(`Все координаты найдены (${processedPointsCount} точек)`, 'success');
        
        // Обновляем фильтры и легенду
        updateFilters();
        updateLegend();
        
        return;
    }
    
    const BATCH_SIZE = 5;
    const batch = pointsQueue.splice(0, BATCH_SIZE);
    
    // Обрабатываем пакет параллельно
    const batchPromises = batch.map(async (point, index) => {
        try {
            // Геокодируем через автономный геокодер
            const result = await autonomousGeocoder.geocode(
                point.address || '', 
                point.region || '', 
                point.city || ''
            );
            
            if (result) {
                // Обновляем точку
                point.lat = result.lat;
                point.lng = result.lng;
                point.coordinates = `${result.lat},${result.lng}`;
                point.source = result.source;
                point.isMock = result.isApproximate || false;
                point.geocoded = true;
                point.processed = true;
                
                if (result.isApproximate) {
                    point.precision = 'low';
                    point.needsImprovement = true;
                } else {
                    point.precision = result.precision || 'medium';
                }
                
                // Обновляем маркер на карте
                updatePointOnMap(point);
                
                // Увеличиваем счетчик
                processedPointsCount++;
                displayedPointsCount++;
                
            } else {
                // Если не нашли, отмечаем как необработанную
                point.geocoded = false;
                point.processed = true;
                processedPointsCount++;
            }
            
            return point;
        } catch (error) {
            console.warn('Ошибка геокодирования точки:', point.name, error);
            point.processed = true;
            point.geocoded = false;
            processedPointsCount++;
            return point;
        }
    });
    
    // Ждем завершения пакета
    await Promise.allSettled(batchPromises);
    
    // Обновляем статистику
    updateStatistics();
    updateStatus(`Ищу координаты... (${processedPointsCount}/${allPoints.length})`);
    
    // Запускаем следующий пакет с задержкой
    setTimeout(processGeocodingBatch, 500);
}

// ========== НЕМЕДЛЕННОЕ ОТОБРАЖЕНИЕ ТОЧЕК ==========
function showPointsImmediately(points) {
    console.log(`🎯 Немедленно показываю ${points.length} точек`);
    
    // Очищаем карту
    markerCluster.clearLayers();
    
    // Создаем временные маркеры без координат
    points.forEach((point, index) => {
        // Если уже есть координаты - используем их
        if (point.lat && point.lng) {
            const marker = createMarker(point);
            markerCluster.addLayer(marker);
            displayedPointsCount++;
            point.displayed = true;
        } else {
            // Создаем временную точку с случайными координатами
            const tempPoint = {
                ...point,
                lat: getRandomCoordinate('lat', point.region),
                lng: getRandomCoordinate('lng', point.region),
                isMock: true,
                isTemporary: true,
                precision: 'very low',
                source: 'Temporary placement'
            };
            
            const marker = createMarker(tempPoint);
            markerCluster.addLayer(marker);
            displayedPointsCount++;
            point.tempMarker = marker;
            point.displayed = true;
        }
    });
    
    // Центрируем карту
    centerMapOnPoints(points);
    
    // Обновляем статистику
    updateStatistics();
    updateFilters();
    updateLegend();
}

// ========== ОБНОВЛЕНИЕ ТОЧКИ НА КАРТЕ ==========
function updatePointOnMap(point) {
    // Удаляем временный маркер если есть
    if (point.tempMarker) {
        markerCluster.removeLayer(point.tempMarker);
        point.tempMarker = null;
    }
    
    // Добавляем новый маркер с реальными координатами
    if (point.lat && point.lng) {
        const marker = createMarker(point);
        markerCluster.addLayer(marker);
        
        // Если это первая точка с реальными координатами, обновляем центрирование
        if (displayedPointsCount <= 10) {
            centerMapOnPoints(allPoints.filter(p => p.lat && p.lng));
        }
    }
}

// ========== ЦЕНТРИРОВАНИЕ КАРТЫ ==========
function centerMapOnPoints(points) {
    const pointsWithCoords = points.filter(p => p.lat && p.lng);
    
    if (pointsWithCoords.length === 0) {
        return;
    }
    
    if (pointsWithCoords.length === 1) {
        // Если одна точка - центрируем на ней
        map.setView([pointsWithCoords[0].lat, pointsWithCoords[0].lng], 12);
    } else {
        // Если несколько точек - подгоняем границы
        const bounds = L.latLngBounds(
            pointsWithCoords.map(p => [p.lat, p.lng])
        );
        
        if (bounds.isValid()) {
            map.fitBounds(bounds, { 
                padding: [50, 50], 
                maxZoom: 12,
                animate: true 
            });
        }
    }
}

// ========== СОЗДАНИЕ МАРКЕРА ==========
function createMarker(point) {
    // Определяем цвет по статусу
    let color = CONFIG.STATUS_COLORS.default;
    const statusLower = (point.status || '').toLowerCase();
    
    if (statusLower.includes('сдан') || statusLower.includes('актив')) {
        color = CONFIG.STATUS_COLORS['сдан'] || '#2ecc71';
    } else if (statusLower.includes('пауз') || statusLower.includes('отправлен')) {
        color = CONFIG.STATUS_COLORS['Отправлен ФО, не принят'] || '#f39c12';
    } else if (statusLower.includes('закрыт')) {
        color = CONFIG.STATUS_COLORS['Закрыта'] || '#e74c3c';
    } else if (statusLower.includes('план')) {
        color = CONFIG.STATUS_COLORS['План'] || '#3498db';
    }
    
    // Определяем иконку в зависимости от точности
    let markerIcon = '📌';
    let badgeColor = '';
    let opacity = 1;
    
    if (point.isTemporary) {
        markerIcon = '⏳';
        badgeColor = '#95a5a6';
        opacity = 0.7;
    } else if (point.isMock) {
        markerIcon = '📍';
        badgeColor = '#f39c12';
    } else if (point.precision === 'high') {
        markerIcon = '🎯';
        badgeColor = '#2ecc71';
    } else if (point.precision === 'medium') {
        markerIcon = '📍';
        badgeColor = '#3498db';
    } else if (point.precision === 'low') {
        markerIcon = '🌍';
        badgeColor = '#f39c12';
        opacity = 0.9;
    }
    
    const icon = L.divIcon({
        html: `
            <div style="
                background: ${color};
                width: 35px;
                height: 35px;
                border-radius: 50%;
                border: 3px solid white;
                box-shadow: 0 2px 5px rgba(0,0,0,0.3);
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: bold;
                font-size: 16px;
                position: relative;
                opacity: ${opacity};
                ${point.isTemporary ? 'animation: pulse 2s infinite;' : ''}
            ">
                ${markerIcon}
                ${badgeColor ? `
                    <div style="
                        position: absolute;
                        top: -5px;
                        right: -5px;
                        width: 12px;
                        height: 12px;
                        background: ${badgeColor};
                        border-radius: 50%;
                        border: 2px solid white;
                    "></div>
                ` : ''}
            </div>
        `,
        className: 'custom-marker',
        iconSize: [35, 35],
        iconAnchor: [17, 35]
    });
    
    const marker = L.marker([point.lat, point.lng], {
        icon: icon,
        title: point.name,
        status: point.status,
        precision: point.precision || 'unknown',
        isTemporary: point.isTemporary || false
    });
    
    // Всплывающее окно
    marker.bindPopup(createPopupContent(point));
    
    // Клик по маркеру
    marker.on('click', function() {
        showPointDetails(point);
    });
    
    return marker;
}

// ========== ВСПЛЫВАЮЩЕЕ ОКНО ==========
function createPopupContent(point) {
    const color = CONFIG.STATUS_COLORS[point.status] || 
                  (point.status && point.status.toLowerCase().includes('сдан') ? CONFIG.STATUS_COLORS['сдан'] : CONFIG.STATUS_COLORS.default);
    
    // Определяем иконку точности
    let precisionIcon = '🎯';
    let precisionText = 'Высокая';
    let precisionColor = '#2ecc71';
    
    if (point.isTemporary) {
        precisionIcon = '⏳';
        precisionText = 'Идет поиск координат...';
        precisionColor = '#95a5a6';
    } else if (point.isMock) {
        precisionIcon = '📍';
        precisionText = 'Приблизительная';
        precisionColor = '#f39c12';
    } else if (point.precision === 'medium') {
        precisionIcon = '📍';
        precisionText = 'Средняя';
        precisionColor = '#3498db';
    } else if (point.precision === 'low') {
        precisionIcon = '🌍';
        precisionText = 'Низкая';
        precisionColor = '#f39c12';
    }
    
    return `
        <div style="min-width: 250px; max-width: 300px;">
            <h4 style="margin: 0 0 10px 0; color: #2c3e50; border-bottom: 2px solid ${color}; padding-bottom: 5px;">
                ${point.name || 'Без названия'}
            </h4>
            
            <div style="margin-bottom: 10px; font-size: 12px; color: #7f8c8d;">
                <strong>Статус:</strong> 
                <span style="color: ${color}; font-weight: 500;">${point.status || 'Не указан'}</span>
            </div>
            
            <div style="margin-bottom: 10px; font-size: 12px;">
                <strong>Точность координат:</strong> 
                <span style="color: ${precisionColor}; font-weight: 500;">
                    ${precisionIcon} ${precisionText}
                </span>
                ${point.source ? `<br><small>Источник: ${point.source}</small>` : ''}
            </div>
            
            ${point.address ? `
                <div style="margin-bottom: 10px;">
                    <strong>📍 Адрес:</strong><br>
                    <span style="font-size: 14px;">${point.address}</span>
                </div>
            ` : ''}
            
            ${point.lat && point.lng ? `
                <div style="margin-bottom: 10px;">
                    <strong>🌍 Координаты:</strong><br>
                    <span style="font-size: 13px; font-family: monospace;">
                        ${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}
                    </span>
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
            </div>
            
            ${point.isTemporary ? `
                <div style="margin-top: 10px; padding: 8px; background: #3498db; color: white; border-radius: 4px; font-size: 11px;">
                    <i class="fas fa-sync-alt fa-spin"></i> Идет поиск точных координат...
                </div>
            ` : point.isMock ? `
                <div style="margin-top: 10px; padding: 8px; background: #f39c12; color: white; border-radius: 4px; font-size: 11px;">
                    <i class="fas fa-map-marker-alt"></i> Приблизительные координаты
                    ${point.needsImprovement ? '<br><small>Будет уточнено в фоновом режиме</small>' : ''}
                </div>
            ` : ''}
        </div>
    `;
}

// ========== ОБНОВЛЕННАЯ СТАТИСТИКА ==========
function updateStatistics() {
    const totalPoints = allPoints.length;
    const displayedPoints = allPoints.filter(p => p.displayed).length;
    const processedPoints = allPoints.filter(p => p.processed).length;
    const geocodedPoints = allPoints.filter(p => p.geocoded).length;
    const mockPoints = allPoints.filter(p => p.isMock && !p.isTemporary).length;
    const exactPoints = geocodedPoints - mockPoints;
    
    document.getElementById('total-points').textContent = totalPoints;
    document.getElementById('shown-points').textContent = displayedPoints;
    
    // Обновляем дополнительные счетчики если они есть
    const exactPointsEl = document.getElementById('exact-points');
    const approxPointsEl = document.getElementById('approx-points');
    
    if (exactPointsEl) exactPointsEl.textContent = exactPoints;
    if (approxPointsEl) approxPointsEl.textContent = mockPoints;
    
    // Обновляем статус
    const statusEl = document.getElementById('status');
    if (statusEl) {
        if (processedPoints < totalPoints) {
            statusEl.innerHTML = `<i class="fas fa-sync-alt fa-spin"></i> ` +
                                `Ищу координаты: ${processedPoints}/${totalPoints}`;
        } else {
            const stats = [];
            if (exactPoints > 0) stats.push(`${exactPoints} точно`);
            if (mockPoints > 0) stats.push(`${mockPoints} приблизительно`);
            
            if (stats.length > 0) {
                statusEl.innerHTML = `<i class="fas fa-check-circle" style="color: #2ecc71;"></i> ` +
                                   `Готово! ${stats.join(', ')}`;
            } else {
                statusEl.innerHTML = `<i class="fas fa-check-circle" style="color: #2ecc71;"></i> ` +
                                   `Загружено: ${totalPoints} точек`;
            }
        }
    }
}

// ========== ОБНОВЛЕННЫЕ ФУНКЦИИ ФИЛЬТРАЦИИ ==========
function applyFilters() {
    // Получаем выбранные значения
    activeFilters.projects = getSelectedValues('filter-project');
    activeFilters.regions = getSelectedValues('filter-region');
    activeFilters.statuses = getSelectedValues('filter-status');
    activeFilters.managers = getSelectedValues('filter-manager');
    
    // Получаем фильтр по точности
    const precisionFilter = document.getElementById('filter-precision');
    if (precisionFilter) {
        activeFilters.precision = precisionFilter.value;
    }
    
    // Обновляем отображение точек
    updatePointsDisplay();
    
    showNotification('Фильтры применены', 'success');
}

function updatePointsDisplay() {
    // Фильтруем точки
    const filteredPoints = filterPoints();
    
    // Очищаем карту
    markerCluster.clearLayers();
    displayedPointsCount = 0;
    
    // Добавляем отфильтрованные точки
    filteredPoints.forEach(point => {
        if (point.displayed && point.lat && point.lng) {
            const marker = createMarker(point);
            markerCluster.addLayer(marker);
            displayedPointsCount++;
        }
    });
    
    // Центрируем карту на видимых точках
    const visiblePoints = filteredPoints.filter(p => p.displayed && p.lat && p.lng);
    centerMapOnPoints(visiblePoints);
    
    updateStatistics();
}

function filterPoints() {
    return allPoints.filter(point => {
        // Проверяем каждый фильтр
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
        
        // Фильтр по точности
        if (activeFilters.precision) {
            if (activeFilters.precision === 'exact' && point.isMock) {
                return false;
            } else if (activeFilters.precision === 'approx' && !point.isMock) {
                return false;
            }
        }
        
        return true;
    });
}

// ========== ФУНКЦИЯ УЛУЧШЕНИЯ КООРДИНАТ ==========
async function improveGeocoding() {
    const pointsToImprove = allPoints.filter(p => 
        p.needsImprovement && p.address && !p.isImproving && p.processed
    );
    
    if (pointsToImprove.length === 0) {
        showNotification('Нет точек с приблизительными координатами для уточнения', 'info');
        return;
    }
    
    showModal('Автономное уточнение координат', 
        `Найдено ${pointsToImprove.length} точек для уточнения.\n` +
        `Уточняю координаты в фоновом режиме...`);
    
    let improvedCount = 0;
    
    for (let i = 0; i < pointsToImprove.length; i++) {
        const point = pointsToImprove[i];
        point.isImproving = true;
        
        updateModal('Автономное уточнение координат', 
            `Обрабатываю ${i+1} из ${pointsToImprove.length}...\n` +
            `(${improvedCount} улучшено)\n` +
            `Текущая: ${point.name}`);
        
        try {
            // Используем автономный геокодер для улучшения
            const result = await autonomousGeocoder.geocode(point.address, point.region);
            
            if (result && !result.isApproximate) {
                // Улучшаем точку
                point.lat = result.lat;
                point.lng = result.lng;
                point.coordinates = `${result.lat},${result.lng}`;
                point.source = result.source;
                point.isMock = false;
                point.precision = result.precision || 'high';
                point.needsImprovement = false;
                improvedCount++;
                
                // Обновляем маркер на карте
                updatePointOnMap(point);
            }
            
            // Задержка для API лимитов
            await sleep(1000);
            
        } catch (error) {
            console.warn('Не удалось уточнить:', point.name, error);
        }
        
        point.isImproving = false;
    }
    
    closeModal();
    updateStatistics();
    
    if (improvedCount > 0) {
        showNotification(`Уточнены координаты для ${improvedCount} точек`, 'success');
    } else {
        showNotification('Не удалось улучшить координаты. Попробуйте позже.', 'info');
    }
}

// ========== УТИЛИТЫ ==========
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomCoordinate(type, region) {
    // Базовые координаты по регионам
    const regionCoords = {
        'москва': { lat: 55.7558, lng: 37.6173 },
        'московская': { lat: 55.7539, lng: 37.6208 },
        'ленинградская': { lat: 59.9391, lng: 30.3159 },
        'санкт-петербург': { lat: 59.9343, lng: 30.3351 },
        'алтайский': { lat: 53.3606, lng: 83.7636 },
        'барнаул': { lat: 53.3606, lng: 83.7636 },
        'default': { lat: 55.7558, lng: 37.6173 }
    };
    
    let baseLat = 55.7558;
    let baseLng = 37.6173;
    
    // Ищем регион
    if (region) {
        const regionLower = region.toLowerCase();
        for (const [key, coords] of Object.entries(regionCoords)) {
            if (regionLower.includes(key.toLowerCase())) {
                baseLat = coords.lat;
                baseLng = coords.lng;
                break;
            }
        }
    }
    
    // Добавляем случайное смещение
    const offset = 2.0;
    if (type === 'lat') {
        return baseLat + (Math.random() - 0.5) * offset;
    } else {
        return baseLng + (Math.random() - 0.5) * offset * 2;
    }
}

// ========== ОСТАЛЬНЫЕ ФУНКЦИИ (без изменений) ==========

// ... (остальные функции из предыдущей версии остаются без изменений)

// ========== ЭКСПОРТ ФУНКЦИЙ ==========
window.loadData = loadData;
window.clearFilters = clearFilters;
window.applyFilters = applyFilters;
window.searchPoints = searchPoints;
window.closeModal = closeModal;
window.improveGeocoding = improveGeocoding;
